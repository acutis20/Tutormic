import { supabase } from "./supabase";
import { extensionFor } from "../audio/recorder";
import type { QueuedSegment } from "../audio/uploadQueue";

export type LessonStatus = "live" | "recorded" | "transcribing" | "reviewing" | "ready" | "published" | "failed";

export interface Course {
  id: string;
  name: string;
}

export interface Lesson {
  id: string;
  course_id: string | null;
  title: string;
  status: LessonStatus;
  error: string | null;
  show_feedback: boolean;
  started_at: string;
  ended_at: string | null;
}

export type IssueType = "conteudo" | "fala" | "transcricao";
export type IssueStatus = "pending" | "accepted" | "rejected";

export interface ReviewIssue {
  id: number;
  type: IssueType;
  status: IssueStatus;
  original: string;
  replacement: string;
  explanation: string;
  timestamp: string;
}

export interface LessonReview {
  lesson_id: string;
  corrected_text: string;
  final_text: string;
  summary: string;
  issues: ReviewIssue[];
}

const LESSON_COLUMNS = "id, course_id, title, status, error, show_feedback, started_at, ended_at";

async function userId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sessão expirada. Entre novamente.");
  return data.user.id;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function one<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  const data = check(res);
  if (data == null) throw new Error("Registro não encontrado.");
  return data;
}

export async function listCourses(): Promise<Course[]> {
  return check(await supabase.from("courses").select("id, name").order("name")) ?? [];
}

export async function createCourse(name: string): Promise<Course> {
  return one(await supabase.from("courses").insert({ name }).select("id, name").single());
}

export async function listLessons(): Promise<Lesson[]> {
  return check(await supabase.from("lessons").select(LESSON_COLUMNS).order("started_at", { ascending: false })) ?? [];
}

export async function getLesson(id: string): Promise<Lesson> {
  return one(await supabase.from("lessons").select(LESSON_COLUMNS).eq("id", id).single());
}

export async function createLesson(title: string, courseId: string | null): Promise<Lesson> {
  return one(
    await supabase.from("lessons").insert({ title, course_id: courseId, status: "live" }).select(LESSON_COLUMNS).single(),
  );
}

export async function updateLesson(id: string, patch: Partial<Pick<Lesson, "status" | "show_feedback" | "ended_at" | "title">>) {
  check(await supabase.from("lessons").update(patch).eq("id", id));
}

/** Uploader usado pela fila: envia o segmento ao Storage e registra em lesson_segments. */
export async function uploadSegment(item: QueuedSegment): Promise<void> {
  const uid = await userId();
  const path = `${uid}/${item.lessonId}/seg-${String(item.idx).padStart(4, "0")}.${extensionFor(item.mimeType)}`;
  const { error } = await supabase.storage
    .from("lesson-audio")
    .upload(path, item.blob, { contentType: item.mimeType.split(";")[0], upsert: true });
  if (error) throw new Error(error.message);

  check(
    await supabase.from("lesson_segments").upsert({
      lesson_id: item.lessonId,
      idx: item.idx,
      storage_path: path,
      mime_type: item.mimeType,
      offset_s: item.offsetS,
      duration_s: item.durationS,
    }),
  );
}

/** Onde continuar a gravação se a aula for reaberta (considera também o que ainda está na fila). */
export async function getRecordingResume(
  lessonId: string,
  queued: Pick<QueuedSegment, "idx" | "offsetS" | "durationS">[],
): Promise<{ nextIdx: number; offsetS: number }> {
  const rows =
    check(await supabase.from("lesson_segments").select("idx, offset_s, duration_s").eq("lesson_id", lessonId)) ?? [];
  const all = [...rows.map((r) => ({ idx: r.idx, offsetS: r.offset_s, durationS: r.duration_s })), ...queued];
  if (all.length === 0) return { nextIdx: 0, offsetS: 0 };
  return {
    nextIdx: Math.max(...all.map((s) => s.idx)) + 1,
    offsetS: Math.max(...all.map((s) => s.offsetS + s.durationS)),
  };
}

export async function getReview(lessonId: string): Promise<LessonReview | null> {
  return check(
    await supabase
      .from("lesson_reviews")
      .select("lesson_id, corrected_text, final_text, summary, issues")
      .eq("lesson_id", lessonId)
      .maybeSingle(),
  );
}

export async function saveReview(lessonId: string, patch: Pick<LessonReview, "final_text" | "issues">) {
  check(
    await supabase
      .from("lesson_reviews")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("lesson_id", lessonId),
  );
}

export async function getTranscript(lessonId: string): Promise<string | null> {
  const data = check(await supabase.from("transcripts").select("raw_text").eq("lesson_id", lessonId).maybeSingle());
  return data?.raw_text ?? null;
}

/** Publica só o texto aprovado (as correções e o feedback nunca são copiados). */
export async function publishLesson(lessonId: string, text: string): Promise<void> {
  check(await supabase.rpc("publish_lesson", { p_lesson_id: lessonId, p_text: text }));
}

export async function getAudioUrls(lessonId: string): Promise<string[]> {
  const rows = check(
    await supabase.from("lesson_segments").select("storage_path").eq("lesson_id", lessonId).order("idx"),
  ) ?? [];
  if (rows.length === 0) return [];
  const signed = one(
    await supabase.storage.from("lesson-audio").createSignedUrls(rows.map((r) => r.storage_path), 3600),
  );
  return signed.map((s) => s.signedUrl).filter((u): u is string => Boolean(u));
}

interface StepResult {
  stage?: LessonStatus;
  remaining?: number;
  error?: string;
}

async function invoke(fn: "transcribe-lesson" | "review-lesson", lessonId: string): Promise<StepResult> {
  const { data, error } = await supabase.functions.invoke<StepResult>(fn, { body: { lessonId } });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? error.message);
  }
  return data ?? {};
}

/**
 * Conduz o processamento: transcreve (em várias chamadas, se a aula for longa) e depois
 * revisa bloco a bloco. Pode ser chamado de novo para retomar de onde parou.
 */
export async function processLesson(
  lessonId: string,
  onProgress: (stage: LessonStatus, remaining: number) => void,
): Promise<void> {
  let step = await invoke("transcribe-lesson", lessonId);
  while (step.stage === "transcribing") {
    onProgress("transcribing", step.remaining ?? 0);
    step = await invoke("transcribe-lesson", lessonId);
  }

  onProgress("reviewing", 0);
  step = await invoke("review-lesson", lessonId);
  while (step.stage === "reviewing") {
    onProgress("reviewing", step.remaining ?? 0);
    step = await invoke("review-lesson", lessonId);
  }
  if (step.stage) onProgress(step.stage, 0);
}
