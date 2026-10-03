-- 识拉丁：Supabase 数据库
-- 在 Supabase Dashboard -> SQL Editor 一次性运行。

create extension if not exists pgcrypto;

create table if not exists public.learning_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  latin text not null,
  seen integer not null default 0,
  known integer not null default 0,
  unknown integer not null default 0,
  quiz_right integer not null default 0,
  quiz_wrong integer not null default 0,
  status text not null default 'new',
  streak integer not null default 0,
  srs_level integer not null default 0,
  due_at timestamptz not null default now(),
  last_studied timestamptz,
  wrong_cells jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, latin)
);

create table if not exists public.user_words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  latin text not null,
  syll text,
  pos text,
  meaning text,
  ex_la text,
  ex_zh text,
  morph jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, latin)
);

alter table public.learning_records enable row level security;
alter table public.user_words enable row level security;

drop policy if exists "records own rows" on public.learning_records;
create policy "records own rows" on public.learning_records
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "words own rows" on public.user_words;
create policy "words own rows" on public.user_words
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists learning_records_due_idx
on public.learning_records(user_id, due_at);

create index if not exists user_words_user_idx
on public.user_words(user_id);
