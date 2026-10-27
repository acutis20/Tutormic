// Transcreve os segmentos de uma aula com o Whisper.
//
// Cada chamada processa os segmentos pendentes dentro de um orçamento de tempo e devolve
// quantos faltam; o app chama de novo até terminar. Assim uma aula de 2 h não estoura o
// limite de tempo da Edge Function, e o processamento pode ser retomado se algo falhar.
import { authorizeLesson, corsHeaders, env, failLesson, json } from "../_shared/supabase.ts";
import { chunkForReview, joinTranscript, offsetSegments, type TimedText } from "../_shared/text.ts";

const TIME_BUDGET_MS = 100_000;

interface SegmentRow {
  idx: number;
  storage_path: string;
  mime_type: string;
  offset_s: number;
  transcript: TimedText[] | null;
}

async function whisper(audio: Blob, filename: string): Promise<TimedText[]> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-1");
  form.append("language", "pt");
  form.append("response_format", "verbose_json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.segments ?? []).map((s: TimedText) => ({ start: s.start, end: s.end, text: s.text }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { lessonId } = await req.json().catch(() => ({}));
  const auth = await authorizeLesson(req, lessonId);
  if (auth instanceof Response) return auth;
  const { admin, lesson } = auth;

  if (!["recorded", "transcribing", "failed"].includes(lesson.status)) {
    return json({ stage: lesson.status, remaining: 0 });
  }

  try {
    await admin.from("lessons").update({ status: "transcribing", error: null }).eq("id", lesson.id);

    const { data: rows, error } = await admin
      .from("lesson_segments")
      .select("idx, storage_path, mime_type, offset_s, transcript")
      .eq("lesson_id", lesson.id)
      .order("idx");
    if (error) throw error;
    const segments = (rows ?? []) as SegmentRow[];
    if (segments.length === 0) throw new Error("Nenhum áudio foi gravado nesta aula.");

    const started = Date.now();
    for (const seg of segments) {
      if (seg.transcript) continue;
      if (Date.now() - started > TIME_BUDGET_MS) break;

      const { data: audio, error: dlError } = await admin.storage.from("lesson-audio").download(seg.storage_path);
      if (dlError || !audio) throw dlError ?? new Error(`Áudio ausente: ${seg.storage_path}`);

      const filename = seg.storage_path.split("/").pop()!;
      const timed = offsetSegments(await whisper(audio, filename), seg.offset_s);
      const { error: upError } = await admin
        .from("lesson_segments")
        .update({ transcript: timed })
        .eq("lesson_id", lesson.id)
        .eq("idx", seg.idx);
      if (upError) throw upError;
      seg.transcript = timed;
    }

    const remaining = segments.filter((s) => !s.transcript).length;
    if (remaining > 0) return json({ stage: "transcribing", remaining });

    // Tudo transcrito: monta a transcrição completa e prepara os blocos de revisão.
    const all = segments.flatMap((s) => s.transcript ?? []);
    const { error: tError } = await admin
      .from("transcripts")
      .upsert({ lesson_id: lesson.id, raw_text: joinTranscript(all), segments: all });
    if (tError) throw tError;

    // Se for uma retomada após falha na revisão, mantém os blocos já revisados.
    const { count: existing } = await admin
      .from("review_chunks")
      .select("idx", { count: "exact", head: true })
      .eq("lesson_id", lesson.id);
    if (!existing) {
      const chunks = chunkForReview(all);
      if (chunks.length === 0) throw new Error("Não foi possível reconhecer fala no áudio gravado.");
      const { error: cError } = await admin
        .from("review_chunks")
        .insert(chunks.map((source_text, idx) => ({ lesson_id: lesson.id, idx, source_text })));
      if (cError) throw cError;
    }

    await admin.from("lessons").update({ status: "reviewing" }).eq("id", lesson.id);
    return json({ stage: "reviewing", remaining: 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failLesson(admin, lesson.id, message);
    return json({ error: message }, 500);
  }
});
