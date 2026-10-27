import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

export function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

export interface LessonRow {
  id: string;
  teacher_id: string;
  title: string;
  status: string;
}

/**
 * Confere o JWT de quem chamou e se a aula pertence a essa professora.
 * Devolve o cliente admin (service role) para o resto do trabalho.
 */
export async function authorizeLesson(
  req: Request,
  lessonId: unknown,
): Promise<{ admin: SupabaseClient; lesson: LessonRow } | Response> {
  if (typeof lessonId !== "string" || !lessonId) return json({ error: "lessonId obrigatório" }, 400);

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "não autenticado" }, 401);

  const admin = adminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "não autenticado" }, 401);

  const { data: lesson, error } = await admin
    .from("lessons")
    .select("id, teacher_id, title, status")
    .eq("id", lessonId)
    .eq("teacher_id", userData.user.id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!lesson) return json({ error: "aula não encontrada" }, 404);

  return { admin, lesson: lesson as LessonRow };
}

export async function failLesson(admin: SupabaseClient, lessonId: string, message: string): Promise<void> {
  await admin.from("lessons").update({ status: "failed", error: message.slice(0, 500) }).eq("id", lessonId);
}
