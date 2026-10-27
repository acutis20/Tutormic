-- TutorMic: esquema inicial
--
-- Regra central de privacidade: transcrição bruta, correções e feedback (transcripts,
-- lesson_reviews) só são visíveis para a professora dona da aula. Alunos só podem ler
-- published_lessons, que é preenchida apenas pela função publish_lesson com o texto que
-- a professora aprovou.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- perfis
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  role text not null default 'teacher' check (role in ('teacher', 'student')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case when new.raw_user_meta_data ->> 'role' = 'student' then 'student' else 'teacher' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- O papel (professora/aluno) não pode ser trocado pelo próprio usuário.
create or replace function public.prevent_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role <> old.role then
    raise exception 'role cannot be changed';
  end if;
  return new;
end;
$$;

create trigger profiles_role_locked
  before update on public.profiles
  for each row execute function public.prevent_role_change();

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;

-- ---------------------------------------------------------------- turmas
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index courses_teacher_idx on public.courses (teacher_id);

-- Para a futura área dos alunos.
create table public.enrollments (
  course_id uuid not null references public.courses (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (course_id, student_id)
);
create index enrollments_student_idx on public.enrollments (student_id);

-- ---------------------------------------------------------------- aulas
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses (id) on delete set null,
  teacher_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null,
  status text not null default 'live'
    check (status in ('live', 'recorded', 'transcribing', 'reviewing', 'ready', 'published', 'failed')),
  error text,
  show_feedback boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index lessons_teacher_idx on public.lessons (teacher_id, started_at desc);
create index lessons_course_idx on public.lessons (course_id);

create table public.lesson_segments (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  idx int not null,
  storage_path text not null,
  mime_type text not null,
  offset_s real not null,
  duration_s real not null,
  -- PRIVADO: trechos do Whisper deste segmento ([{start, end, text}], tempos já absolutos).
  transcript jsonb,
  created_at timestamptz not null default now(),
  primary key (lesson_id, idx)
);

-- PRIVADO: só a professora.
create table public.transcripts (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  raw_text text not null,
  segments jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- PRIVADO: só a professora. Nunca existe policy de leitura para alunos.
create table public.lesson_reviews (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  corrected_text text not null,
  final_text text not null,
  summary text not null default '',
  issues jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- PRIVADO: revisão por blocos (aulas longas são revisadas em partes).
create table public.review_chunks (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  idx int not null,
  source_text text not null,
  corrected_text text,
  summary text,
  issues jsonb,
  primary key (lesson_id, idx)
);

-- PÚBLICO para alunos matriculados: só o texto aprovado.
create table public.published_lessons (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  approved_text text not null,
  published_at timestamptz not null default now()
);
create index published_lessons_course_idx on public.published_lessons (course_id);

-- ---------------------------------------------------------------- RLS
-- Helpers security definer: evitam recursão entre as policies de courses e enrollments.
create or replace function public.owns_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.courses where id = p_course_id and teacher_id = auth.uid());
$$;

create or replace function public.is_enrolled(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.enrollments where course_id = p_course_id and student_id = auth.uid());
$$;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_segments enable row level security;
alter table public.transcripts enable row level security;
alter table public.lesson_reviews enable row level security;
alter table public.review_chunks enable row level security;
alter table public.published_lessons enable row level security;

create policy "own profile read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "own profile update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "teacher manages courses" on public.courses
  for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()) and (select public.is_teacher()));
create policy "student reads enrolled courses" on public.courses
  for select to authenticated
  using ((select public.is_enrolled(courses.id)));

create policy "teacher manages enrollments" on public.enrollments
  for all to authenticated
  using ((select public.owns_course(enrollments.course_id)))
  with check ((select public.owns_course(enrollments.course_id)));
create policy "student reads own enrollments" on public.enrollments
  for select to authenticated using (student_id = (select auth.uid()));

create policy "teacher manages lessons" on public.lessons
  for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()) and (select public.is_teacher()));

create policy "teacher manages segments" on public.lesson_segments
  for all to authenticated
  using (exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid())))
  with check (exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid())));

-- Transcrição: só leitura pela professora (quem grava é a Edge Function com service role).
create policy "teacher reads transcript" on public.transcripts
  for select to authenticated
  using (exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid())));

create policy "teacher reads review chunks" on public.review_chunks
  for select to authenticated
  using (exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid())));

-- Revisão: professora lê e edita o texto final / status das sugestões.
create policy "teacher reads review" on public.lesson_reviews
  for select to authenticated
  using (exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid())));
create policy "teacher edits review" on public.lesson_reviews
  for update to authenticated
  using (exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid())))
  with check (exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid())));

create policy "teacher reads own published" on public.published_lessons
  for select to authenticated using (teacher_id = (select auth.uid()));
create policy "student reads enrolled published" on public.published_lessons
  for select to authenticated
  using ((select public.is_enrolled(published_lessons.course_id)));

-- ---------------------------------------------------------------- publicar
-- Único caminho para published_lessons: copia só o texto aprovado. Correções e feedback
-- nunca são copiados.
create or replace function public.publish_lesson(p_lesson_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
begin
  select * into v_lesson from public.lessons where id = p_lesson_id and teacher_id = auth.uid();
  if not found then
    raise exception 'lesson not found';
  end if;
  if v_lesson.status not in ('ready', 'published') then
    raise exception 'lesson is not ready to publish';
  end if;
  if coalesce(trim(p_text), '') = '' then
    raise exception 'approved text is empty';
  end if;

  update public.lesson_reviews set final_text = p_text, updated_at = now() where lesson_id = p_lesson_id;

  insert into public.published_lessons (lesson_id, course_id, teacher_id, title, approved_text)
  values (v_lesson.id, v_lesson.course_id, v_lesson.teacher_id, v_lesson.title, p_text)
  on conflict (lesson_id) do update
    set approved_text = excluded.approved_text,
        title = excluded.title,
        course_id = excluded.course_id,
        published_at = now();

  update public.lessons set status = 'published' where id = p_lesson_id;
end;
$$;

revoke all on function public.publish_lesson(uuid, text) from public, anon;
grant execute on function public.publish_lesson(uuid, text) to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public)
values ('lesson-audio', 'lesson-audio', false)
on conflict (id) do nothing;

-- Caminho: {teacher_id}/{lesson_id}/seg-0001.webm
create policy "teacher uploads own audio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lesson-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "teacher reads own audio" on storage.objects
  for select to authenticated
  using (bucket_id = 'lesson-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "teacher updates own audio" on storage.objects
  for update to authenticated
  using (bucket_id = 'lesson-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "teacher deletes own audio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'lesson-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
