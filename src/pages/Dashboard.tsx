import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createCourse, createLesson, listCourses, listLessons, type Course, type Lesson } from "../lib/api";
import { supabase } from "../lib/supabase";
import StatusBadge from "../components/StatusBadge";

const NEW_COURSE = "__new__";

export default function Dashboard() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listCourses(), listLessons()])
      .then(([c, l]) => {
        setCourses(c);
        setLessons(l);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function openLesson(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let cid: string | null = courseId || null;
      if (courseId === NEW_COURSE) cid = newCourse.trim() ? (await createCourse(newCourse.trim())).id : null;
      const lesson = await createLesson(title.trim() || `Aula de ${new Date().toLocaleDateString("pt-BR")}`, cid);
      navigate(`/aula/${lesson.id}/ao-vivo`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="flex items-center justify-between py-2">
        <h1 className="text-2xl font-bold">🎙️ TutorMic</h1>
        <button className="text-sm text-slate-400 underline" onClick={() => supabase.auth.signOut()}>
          Sair
        </button>
      </header>

      <form onSubmit={openLesson} className="mt-4 space-y-3 rounded-2xl bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Abrir aula</h2>
        <input
          className="w-full rounded-lg bg-slate-800 p-3"
          placeholder="Tema da aula (ex.: Sistema cardiovascular)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select className="w-full rounded-lg bg-slate-800 p-3" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">Sem turma</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW_COURSE}>+ Nova turma…</option>
        </select>
        {courseId === NEW_COURSE && (
          <input
            className="w-full rounded-lg bg-slate-800 p-3"
            placeholder="Nome da turma"
            value={newCourse}
            onChange={(e) => setNewCourse(e.target.value)}
          />
        )}
        <button disabled={busy} className="w-full rounded-xl bg-sky-500 p-4 text-lg font-bold text-slate-950 disabled:opacity-50">
          Abrir aula e ligar microfone
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      <h2 className="mt-8 mb-2 text-lg font-semibold">Minhas aulas</h2>
      {lessons.length === 0 && <p className="text-slate-500">Nenhuma aula ainda.</p>}
      <ul className="space-y-2">
        {lessons.map((l) => (
          <li key={l.id}>
            <Link
              to={l.status === "live" ? `/aula/${l.id}/ao-vivo` : `/aula/${l.id}`}
              className="flex items-center justify-between gap-3 rounded-xl bg-slate-900 p-4 hover:bg-slate-800"
            >
              <span>
                <span className="block font-medium">{l.title}</span>
                <span className="text-xs text-slate-500">{new Date(l.started_at).toLocaleString("pt-BR")}</span>
              </span>
              <StatusBadge status={l.status} />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
