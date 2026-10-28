import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { uploadQueue } from "./lib/queue";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import LiveLesson from "./pages/LiveLesson";
import LessonReview from "./pages/LessonReview";
import Receiver from "./pages/Receiver";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void uploadQueue.process();
  }, [session]);

  if (!supabaseConfigured) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-2xl font-bold">TutorMic</h1>
        <p className="mt-4 text-slate-300">
          Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo{" "}
          <code>.env.local</code> (veja <code>.env.example</code>).
        </p>
      </main>
    );
  }

  if (session === undefined) return null;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/receptor" element={<Receiver />} />
        <Route path="/receptor/:code" element={<Receiver />} />
        {session ? (
          <>
            <Route path="/" element={<Dashboard />} />
            <Route path="/aula/:id/ao-vivo" element={<LiveLesson />} />
            <Route path="/aula/:id" element={<LessonReview />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <Route path="*" element={<Login />} />
        )}
      </Routes>
    </BrowserRouter>
  );
}
