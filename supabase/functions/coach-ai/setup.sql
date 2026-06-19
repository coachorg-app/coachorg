-- Tabela de cache da Coach IA (insights gerados por Gemini)
-- Roda essa SQL no Supabase Dashboard → SQL Editor

create table if not exists coach_ai_cache (
  user_id uuid primary key references auth.users(id) on delete cascade,
  insights jsonb not null,
  created_at timestamptz not null default now()
);

alter table coach_ai_cache enable row level security;

-- Usuário pode ler/escrever só o cache dele
create policy "user reads own cache" on coach_ai_cache
  for select using (auth.uid() = user_id);

create policy "user writes own cache" on coach_ai_cache
  for insert with check (auth.uid() = user_id);

create policy "user updates own cache" on coach_ai_cache
  for update using (auth.uid() = user_id);
