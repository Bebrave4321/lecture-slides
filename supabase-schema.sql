create table if not exists public.lecture_slide_edits (
  subject_id text not null,
  subject_title text not null,
  lecture_id text not null,
  lecture_title text not null,
  slide_index integer not null,
  file_name text not null,
  explanation text not null,
  review text not null,
  terms jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (subject_id, lecture_id, slide_index)
);

alter table public.lecture_slide_edits enable row level security;

create policy "anon can read lecture slide edits"
on public.lecture_slide_edits
for select
to anon
using (true);

create policy "anon can write lecture slide edits"
on public.lecture_slide_edits
for all
to anon
using (true)
with check (true);
