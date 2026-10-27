// Revisa a transcrição com o Claude, bloco a bloco.
//
// Gera (1) o texto corrigido que poderá ir para os alunos depois que a professora aprovar e
// (2) a lista privada de problemas/feedback, que só a professora vê.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { authorizeLesson, corsHeaders, env, failLesson, json } from "../_shared/supabase.ts";
import { stripStamps } from "../_shared/text.ts";

const MODEL = "claude-opus-5-5";
const TIME_BUDGET_MS = 60_000;

const SYSTEM_PROMPT = `Você é revisor acadêmico de aulas universitárias em português do Brasil.
Você recebe um trecho da transcrição automática de uma aula falada. Cada linha começa com o
tempo [mm:ss] em que foi dita.

Produza:
1. corrected_text: o trecho reescrito como material de estudo para os alunos, em parágrafos.
   - Corrija erros de transcrição (palavras mal reconhecidas, termos técnicos, nomes próprios).
   - Remova vícios de fala, hesitações e repetições ("é...", "né", "tipo", frases recomeçadas),
     sem mudar o sentido nem o estilo da professora.
   - Se a professora disse algo factualmente errado (conceito, dado, fórmula, nome), escreva a
     versão correta no texto.
   - Não acrescente conteúdo que não foi dado em aula. Não inclua as marcações de tempo.
2. issues: um item para cada correção que mereça a atenção da professora:
   - type "conteudo": erro de conceito ou informação na fala;
   - type "fala": trecho confuso, ambíguo ou que pode ser explicado de forma mais clara;
   - type "transcricao": palavra ou termo que provavelmente foi mal reconhecido.
   Em "original" copie como foi dito/transcrito; em "replacement" copie EXATAMENTE o trecho
   correspondente como ficou em corrected_text (precisa aparecer literalmente lá); em
   "explanation" explique em uma ou duas frases, com tom respeitoso e construtivo; em
   "timestamp" use o tempo [mm:ss] da linha de origem. Não liste a simples remoção de vícios
   de fala.
3. summary: duas ou três frases de feedback geral para a professora sobre este trecho.

Esse feedback é privado e só a professora verá.`;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["corrected_text", "summary", "issues"],
  properties: {
    corrected_text: { type: "string" },
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "original", "replacement", "explanation", "timestamp"],
        properties: {
          type: { type: "string", enum: ["conteudo", "fala", "transcricao"] },
          original: { type: "string" },
          replacement: { type: "string" },
          explanation: { type: "string" },
          timestamp: { type: "string" },
        },
      },
    },
  },
} as const;

interface ReviewIssue {
  type: "conteudo" | "fala" | "transcricao";
  original: string;
  replacement: string;
  explanation: string;
  timestamp: string;
}

interface ChunkReview {
  corrected_text: string;
  summary: string;
  issues: ReviewIssue[];
}

interface ChunkRow {
  idx: number;
  source_text: string;
  corrected_text: string | null;
  summary: string | null;
  issues: ReviewIssue[] | null;
}

const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });

async function reviewChunk(title: string, chunk: ChunkRow, total: number): Promise<ChunkReview> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: REVIEW_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Aula: "${title}"\nTrecho ${chunk.idx + 1} de ${total}.\n\n<transcricao>\n${chunk.source_text}\n</transcricao>`,
      },
    ],
  } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

  if (response.stop_reason === "refusal") throw new Error("A revisão automática recusou este trecho.");
  if (response.stop_reason === "max_tokens") throw new Error("Revisão truncada (trecho longo demais).");

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Resposta da revisão sem texto.");
  const parsed = JSON.parse(text.text) as ChunkReview;

  const corrected = stripStamps(parsed.corrected_text);
  return {
    corrected_text: corrected,
    summary: parsed.summary.trim(),
    // Só mantém sugestões que dá para localizar no texto (necessário para aceitar/rejeitar).
    issues: parsed.issues.filter((i) => i.replacement && corrected.includes(i.replacement)),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { lessonId } = await req.json().catch(() => ({}));
  const auth = await authorizeLesson(req, lessonId);
  if (auth instanceof Response) return auth;
  const { admin, lesson } = auth;

  if (!["reviewing", "failed"].includes(lesson.status)) {
    return json({ stage: lesson.status, remaining: 0 });
  }

  try {
    const { data: rows, error } = await admin
      .from("review_chunks")
      .select("idx, source_text, corrected_text, summary, issues")
      .eq("lesson_id", lesson.id)
      .order("idx");
    if (error) throw error;
    const chunks = (rows ?? []) as ChunkRow[];
    if (chunks.length === 0) return json({ stage: "transcribing", remaining: 1 });

    await admin.from("lessons").update({ status: "reviewing", error: null }).eq("id", lesson.id);

    const started = Date.now();
    for (const chunk of chunks) {
      if (chunk.corrected_text !== null) continue;
      if (Date.now() - started > TIME_BUDGET_MS) break;

      const review = await reviewChunk(lesson.title, chunk, chunks.length);
      const { error: upError } = await admin
        .from("review_chunks")
        .update(review)
        .eq("lesson_id", lesson.id)
        .eq("idx", chunk.idx);
      if (upError) throw upError;
      Object.assign(chunk, review);
    }

    const remaining = chunks.filter((c) => c.corrected_text === null).length;
    if (remaining > 0) return json({ stage: "reviewing", remaining });

    const corrected = chunks.map((c) => c.corrected_text).join("\n\n");
    const issues = chunks.flatMap((c) => c.issues ?? []).map((issue, i) => ({ id: i, status: "pending", ...issue }));
    const summary = chunks
      .map((c) => c.summary)
      .filter(Boolean)
      .join("\n\n");

    const { error: rError } = await admin.from("lesson_reviews").upsert({
      lesson_id: lesson.id,
      corrected_text: corrected,
      final_text: corrected,
      summary,
      issues,
      updated_at: new Date().toISOString(),
    });
    if (rError) throw rError;

    await admin.from("lessons").update({ status: "ready" }).eq("id", lesson.id);
    return json({ stage: "ready", remaining: 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failLesson(admin, lesson.id, message);
    return json({ error: message }, 500);
  }
});
