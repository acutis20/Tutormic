import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getAudioUrls,
  getLesson,
  getReview,
  getTranscript,
  processLesson,
  publishLesson,
  saveReview,
  updateLesson,
  type IssueStatus,
  type Lesson,
  type LessonReview as Review,
  type LessonStatus,
  type ReviewIssue,
} from "../lib/api";
import { applyIssueDecision, ISSUE_LABELS } from "../lib/issues";
import StatusBadge from "../components/StatusBadge";

const PROCESSING: LessonStatus[] = ["recorded", "transcribing", "reviewing", "failed"];

export default function LessonReview() {
  const { id: lessonId = "" } = useParams();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [text, setText] = useState("");
  const [issues, setIssues] = useState<ReviewIssue[]>([]);
  const [dirty, setDirty] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [audio, setAudio] = useState<string[]>([]);
  const [raw, setRaw] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const processingRef = useRef(false);

  const load = useCallback(async () => {
    const l = await getLesson(lessonId);
    setLesson(l);
    if (l.status === "ready" || l.status === "published") {
      const r = await getReview(lessonId);
      setReview(r);
      setText(r?.final_text ?? "");
      setIssues(r?.issues ?? []);
      setDirty(false);
    }
    return l;
  }, [lessonId]);

  const runProcessing = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setMessage(null);
    setProgress("Preparando…");
    try {
      await processLesson(lessonId, (stage, remaining) => {
        if (stage === "transcribing") setProgress(`Transcrevendo o áudio… (${remaining} parte(s) restantes)`);
        else if (stage === "reviewing")
          setProgress(remaining ? `Revisando a transcrição… (${remaining} bloco(s) restantes)` : "Revisando a transcrição…");
      });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      processingRef.current = false;
      setProgress(null);
      await load();
    }
  }, [lessonId, load]);

  useEffect(() => {
    load()
      .then((l) => {
        if (l.status === "recorded" || l.status === "transcribing" || l.status === "reviewing") void runProcessing();
      })
      .catch((e: Error) => setMessage(e.message));
    getAudioUrls(lessonId).then(setAudio).catch(() => setAudio([]));
  }, [lessonId, load, runProcessing]);

  async function toggleFeedback() {
    if (!lesson) return;
    const show = !lesson.show_feedback;
    setLesson({ ...lesson, show_feedback: show });
    await updateLesson(lesson.id, { show_feedback: show });
  }

  function decide(issue: ReviewIssue, next: IssueStatus) {
    const updated = applyIssueDecision(text, issue, next);
    if (updated === null) {
      setMessage("Não encontrei esse trecho no texto (talvez você já tenha editado). Ajuste manualmente.");
    } else {
      setText(updated);
    }
    setIssues(issues.map((i) => (i.id === issue.id ? { ...i, status: next } : i)));
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    try {
      await saveReview(lessonId, { final_text: text, issues });
      setDirty(false);
      setMessage("Salvo.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!confirm("Publicar este texto para os alunos? As correções e o feedback continuam privados.")) return;
    setBusy(true);
    try {
      await saveReview(lessonId, { final_text: text, issues });
      await publishLesson(lessonId, text);
      await load();
      setMessage("Aula publicada. Os alunos verão apenas o texto aprovado.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function showRaw() {
    setRaw((await getTranscript(lessonId)) ?? "");
  }

  if (!lesson) {
    return <main className="p-6 text-slate-400">{message ?? "Carregando…"}</main>;
  }

  const ready = lesson.status === "ready" || lesson.status === "published";

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 pb-24">
      <header className="flex items-center justify-between">
        <Link to="/" className="text-sm text-slate-400">
          ← Aulas
        </Link>
        <StatusBadge status={lesson.status} />
      </header>
      <h1 className="text-2xl font-bold">{lesson.title}</h1>

      {PROCESSING.includes(lesson.status) && (
        <section className="rounded-2xl bg-slate-900 p-4">
          {progress ? (
            <p className="animate-pulse text-amber-200">{progress}</p>
          ) : (
            <>
              <p className="text-slate-300">
                {lesson.status === "failed"
                  ? `O processamento parou: ${lesson.error ?? "erro desconhecido"}`
                  : "A gravação está pronta para ser transcrita e revisada."}
              </p>
              <button onClick={runProcessing} className="mt-3 rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950">
                {lesson.status === "failed" ? "Tentar de novo" : "Transcrever e revisar"}
              </button>
            </>
          )}
          <p className="mt-2 text-xs text-slate-500">Pode levar alguns minutos em aulas longas. Mantenha esta página aberta.</p>
        </section>
      )}

      {audio.length > 0 && (
        <details className="rounded-2xl bg-slate-900 p-4">
          <summary className="cursor-pointer font-semibold">Gravação ({audio.length} parte(s))</summary>
          <div className="mt-3 space-y-2">
            {audio.map((src, i) => (
              <audio key={src} controls preload="none" src={src} className="w-full" aria-label={`Parte ${i + 1}`} />
            ))}
          </div>
        </details>
      )}

      {ready && review && (
        <>
          <section className="rounded-2xl bg-slate-900 p-4">
            <label className="flex cursor-pointer items-center justify-between gap-4">
              <span>
                <span className="block font-semibold">Mostrar correções e feedback</span>
                <span className="text-sm text-slate-400">Só você vê isto. Nunca é enviado aos alunos.</span>
              </span>
              <input type="checkbox" className="h-6 w-6 accent-sky-500" checked={lesson.show_feedback} onChange={toggleFeedback} />
            </label>

            {lesson.show_feedback && (
              <div className="mt-4 space-y-4">
                {review.summary && (
                  <div className="whitespace-pre-line rounded-xl bg-slate-800 p-3 text-sm text-slate-200">{review.summary}</div>
                )}
                {issues.length === 0 && <p className="text-sm text-slate-400">Nenhuma correção relevante. 👏</p>}
                <ul className="space-y-3">
                  {issues.map((issue) => (
                    <li key={issue.id} className="rounded-xl bg-slate-800 p-3 text-sm">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>
                          {ISSUE_LABELS[issue.type]} · {issue.timestamp}
                        </span>
                        <span>{issue.status === "rejected" ? "mantido o original" : issue.status === "accepted" ? "aceita" : ""}</span>
                      </div>
                      <p className="mt-2">
                        <span className="text-red-300 line-through">{issue.original}</span> →{" "}
                        <span className="text-emerald-300">{issue.replacement}</span>
                      </p>
                      <p className="mt-1 text-slate-300">{issue.explanation}</p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => decide(issue, "accepted")}
                          className={`rounded-lg px-3 py-1 ${issue.status === "accepted" ? "bg-emerald-500 text-slate-950" : "bg-slate-700"}`}
                        >
                          Aceitar
                        </button>
                        <button
                          onClick={() => decide(issue, "rejected")}
                          className={`rounded-lg px-3 py-1 ${issue.status === "rejected" ? "bg-red-400 text-slate-950" : "bg-slate-700"}`}
                        >
                          Manter original
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-slate-900 p-4">
            <h2 className="font-semibold">Texto da aula para os alunos</h2>
            <p className="text-sm text-slate-400">Revise e edite à vontade. Só este texto é publicado.</p>
            <textarea
              className="mt-3 h-[50vh] w-full rounded-xl bg-slate-800 p-3 leading-relaxed"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setDirty(true);
              }}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={save} disabled={busy || !dirty} className="rounded-lg bg-slate-700 px-4 py-2 disabled:opacity-50">
                Salvar rascunho
              </button>
              <button onClick={publish} disabled={busy || !text.trim()} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">
                {lesson.status === "published" ? "Atualizar publicação" : "Aprovar e publicar"}
              </button>
            </div>
          </section>

          <details className="rounded-2xl bg-slate-900 p-4" onToggle={(e) => (e.currentTarget.open && raw === null ? void showRaw() : null)}>
            <summary className="cursor-pointer font-semibold">Transcrição original (privada)</summary>
            <p className="mt-3 whitespace-pre-line text-sm text-slate-400">{raw ?? "Carregando…"}</p>
          </details>
        </>
      )}

      {message && <p className="text-sm text-amber-200">{message}</p>}
    </main>
  );
}
