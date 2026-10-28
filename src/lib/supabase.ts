import { createClient } from "@supabase/supabase-js";

// Valores públicos do projeto Supabase do TutorMic (a chave publishable pode ficar no
// navegador; quem protege os dados são as regras de RLS). As variáveis de ambiente
// permitem apontar para outro projeto, por exemplo em desenvolvimento.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "https://bfxcbcfuyrdpzcdgfwlp.supabase.co";
const anonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "sb_publishable_FJqn4mQaJD8cFQRnGdOMoA_9LO9Yjs1";

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
