import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { name, role: "teacher" } } });
    setBusy(false);
    if (error) setMessage(error.message);
    else if (mode === "signup" && !data.session) setMessage("Conta criada! Confirme pelo link enviado ao seu e-mail.");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <h1 className="text-3xl font-bold">🎙️ TutorMic</h1>
      <p className="mt-2 text-slate-400">Seu celular ou notebook vira o microfone da aula.</p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        {mode === "signup" && (
          <input
            className="w-full rounded-lg bg-slate-800 p-3"
            placeholder="Seu nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <input
          className="w-full rounded-lg bg-slate-800 p-3"
          type="email"
          placeholder="E-mail"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full rounded-lg bg-slate-800 p-3"
          type="password"
          placeholder="Senha"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button disabled={busy} className="w-full rounded-lg bg-sky-500 p-3 font-semibold text-slate-950 disabled:opacity-50">
          {busy ? "Aguarde…" : mode === "signin" ? "Entrar" : "Criar conta de professora"}
        </button>
      </form>

      {message && <p className="mt-4 text-sm text-amber-300">{message}</p>}

      <button
        className="mt-6 text-sm text-slate-400 underline"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
      >
        {mode === "signin" ? "Não tem conta? Cadastre-se" : "Já tenho conta"}
      </button>
    </main>
  );
}
