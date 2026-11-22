create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  description text not null,
  topic text not null,
  sections jsonb not null check (jsonb_typeof(sections) = 'array'),
  publish_day date not null unique,
  is_published boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.blog_posts enable row level security;

grant select on public.blog_posts to anon, authenticated;

create policy "Public can read published blog posts"
  on public.blog_posts
  for select
  to anon, authenticated
  using (is_published);
