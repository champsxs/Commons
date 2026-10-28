-- Registry: users, teams, datasets, fields, links, pages.
-- Dataset tables themselves live in the `data` schema and are created by the registry service.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$ begin
  create role commons_user nologin;
exception when duplicate_object then null; end $$;

create schema if not exists commons;
create schema if not exists data;

grant usage on schema data to commons_user;
grant usage on schema commons to commons_user;

create table commons.users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text not null,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table commons.teams (
  id    uuid primary key default gen_random_uuid(),
  slug  text not null unique,
  name  text not null
);

create table commons.team_members (
  team_id uuid not null references commons.teams(id) on delete cascade,
  user_id uuid not null references commons.users(id) on delete cascade,
  primary key (team_id, user_id)
);

create table commons.datasets (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z][a-z0-9_]{1,50}$'),
  name         text not null,
  description  text not null default '',
  owner_id     uuid not null references commons.users(id),
  team_id      uuid references commons.teams(id),
  visibility   text not null default 'private' check (visibility in ('private', 'shared', 'company')),
  referenceable boolean not null default true,
  key_field    text,
  type_name    text not null unique,
  license      text,
  source       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table commons.dataset_fields (
  id           uuid primary key default gen_random_uuid(),
  dataset_id   uuid not null references commons.datasets(id) on delete cascade,
  name         text not null check (name ~ '^[a-z][a-z0-9_]{0,50}$'),
  label        text not null,
  type         text not null check (type in ('text', 'integer', 'number', 'boolean', 'date', 'timestamp', 'json', 'reference')),
  required     boolean not null default false,
  is_unique    boolean not null default false,
  description  text not null default '',
  position     int not null default 0,
  deprecated   boolean not null default false,
  unique (dataset_id, name)
);

create table commons.dataset_links (
  id            uuid primary key default gen_random_uuid(),
  from_dataset  uuid not null references commons.datasets(id) on delete cascade,
  from_field    text not null,
  to_dataset    uuid not null references commons.datasets(id),
  to_field      text not null,                    -- the unique key users match on when ingesting
  kind          text not null default 'hard' check (kind in ('hard', 'soft')),
  on_delete     text not null default 'restrict' check (on_delete in ('restrict', 'set_null')),
  unresolved    text not null default 'reject' check (unresolved in ('reject', 'skip', 'null')),
  created_at    timestamptz not null default now(),
  unique (from_dataset, from_field)
);

-- Explicit sharing for visibility = 'shared'
create table commons.dataset_shares (
  dataset_id  uuid not null references commons.datasets(id) on delete cascade,
  team_id     uuid references commons.teams(id) on delete cascade,
  user_id     uuid references commons.users(id) on delete cascade,
  can_edit    boolean not null default false,
  check ((team_id is null) <> (user_id is null))
);
create unique index on commons.dataset_shares (dataset_id, coalesce(team_id, user_id));

create table commons.ingest_runs (
  id            uuid primary key default gen_random_uuid(),
  dataset_id    uuid not null references commons.datasets(id) on delete cascade,
  user_id       uuid not null references commons.users(id),
  filename      text,
  mode          text not null,
  status        text not null,
  rows_total    int not null default 0,
  rows_inserted int not null default 0,
  rows_skipped  int not null default 0,
  report        jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create table commons.api_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references commons.users(id) on delete cascade,
  name        text not null,
  token_hash  text not null unique,
  scopes      text[] not null default '{data:read,pages:write}',
  expires_at  timestamptz,
  last_used_at timestamptz,
  created_at  timestamptz not null default now()
);

create table commons.audit_log (
  id          bigserial primary key,
  user_id     uuid references commons.users(id),
  client      text,
  action      text not null,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- Pages as code
create table commons.pages (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,60}$'),
  title                 text not null,
  description           text not null default '',
  owner_id              uuid not null references commons.users(id),
  team_id               uuid references commons.teams(id),
  visibility            text not null default 'private' check (visibility in ('private', 'shared', 'company')),
  allow_writes          boolean not null default false,
  published_version_id  uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table commons.page_versions (
  id               uuid primary key default gen_random_uuid(),
  page_id          uuid not null references commons.pages(id) on delete cascade,
  version          int not null,
  source           jsonb not null,
  draft            boolean not null default false,
  status           text not null default 'building' check (status in ('building', 'ready', 'failed')),
  build_log        text not null default '',
  bundle_key       text,
  css_key          text,
  created_by       uuid not null references commons.users(id),
  client           text,
  agent_session_id uuid,
  message          text,
  created_at       timestamptz not null default now(),
  unique (page_id, version)
);

alter table commons.pages
  add foreign key (published_version_id) references commons.page_versions(id);

create table commons.page_dependencies (
  page_version_id uuid not null references commons.page_versions(id) on delete cascade,
  dataset_id      uuid not null references commons.datasets(id) on delete cascade,
  field           text not null,
  primary key (page_version_id, dataset_id, field)
);

create table commons.page_shares (
  page_id   uuid not null references commons.pages(id) on delete cascade,
  team_id   uuid references commons.teams(id) on delete cascade,
  user_id   uuid references commons.users(id) on delete cascade,
  check ((team_id is null) <> (user_id is null))
);

create table commons.agent_sessions (
  id          uuid primary key default gen_random_uuid(),
  page_id     uuid references commons.pages(id) on delete set null,
  user_id     uuid not null references commons.users(id),
  client      text,
  transcript  jsonb not null default '[]',
  status      text not null default 'running' check (status in ('running', 'done', 'failed', 'cancelled')),
  created_at  timestamptz not null default now()
);

-- Search
create index datasets_name_trgm on commons.datasets using gin ((name || ' ' || slug || ' ' || description) gin_trgm_ops);
create index fields_name_trgm on commons.dataset_fields using gin (name gin_trgm_ops);
create index pages_title_trgm on commons.pages using gin ((title || ' ' || slug || ' ' || description) gin_trgm_ops);

-- Access helpers. The current user is carried in the `commons.user_id` setting.
create function commons.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('commons.user_id', true), '')::uuid
$$;

create function commons.can_view_dataset(p_dataset uuid) returns boolean
language sql stable security definer set search_path = commons, pg_temp as $$
  select exists (
    select 1 from datasets d
    where d.id = p_dataset and (
      d.visibility = 'company'
      or d.owner_id = current_user_id()
      or exists (select 1 from users u where u.id = current_user_id() and u.is_admin)
      or exists (select 1 from team_members m where m.team_id = d.team_id and m.user_id = current_user_id())
      or (d.visibility = 'shared' and exists (
            select 1 from dataset_shares s
            left join team_members m on m.team_id = s.team_id and m.user_id = current_user_id()
            where s.dataset_id = d.id and (s.user_id = current_user_id() or m.user_id is not null)))
    )
  )
$$;

create function commons.can_edit_dataset(p_dataset uuid) returns boolean
language sql stable security definer set search_path = commons, pg_temp as $$
  select exists (
    select 1 from datasets d
    where d.id = p_dataset and (
      d.owner_id = current_user_id()
      or exists (select 1 from users u where u.id = current_user_id() and u.is_admin)
      or exists (select 1 from team_members m where m.team_id = d.team_id and m.user_id = current_user_id())
      or exists (
            select 1 from dataset_shares s
            left join team_members m on m.team_id = s.team_id and m.user_id = current_user_id()
            where s.dataset_id = d.id and s.can_edit and (s.user_id = current_user_id() or m.user_id is not null))
    )
  )
$$;

create function commons.can_view_page(p_page uuid) returns boolean
language sql stable security definer set search_path = commons, pg_temp as $$
  select exists (
    select 1 from pages p
    where p.id = p_page and (
      p.visibility = 'company'
      or p.owner_id = current_user_id()
      or exists (select 1 from users u where u.id = current_user_id() and u.is_admin)
      or exists (select 1 from team_members m where m.team_id = p.team_id and m.user_id = current_user_id())
      or (p.visibility = 'shared' and exists (
            select 1 from page_shares s
            left join team_members m on m.team_id = s.team_id and m.user_id = current_user_id()
            where s.page_id = p.id and (s.user_id = current_user_id() or m.user_id is not null)))
    )
  )
$$;

grant execute on function commons.current_user_id(), commons.can_view_dataset(uuid),
  commons.can_edit_dataset(uuid), commons.can_view_page(uuid) to commons_user;

-- Shared trigger for dataset tables
create function commons.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Row counts for listings: exact for small tables, the planner's estimate for large ones
create function commons.row_count(p_slug text) returns bigint
language plpgsql stable as $$
declare
  est bigint;
  n bigint;
begin
  select reltuples::bigint into est from pg_class where oid = to_regclass('data.' || quote_ident(p_slug));
  if est is null then return 0; end if;
  if est > 100000 then return est; end if;
  execute format('select count(*) from data.%I', p_slug) into n;
  return n;
end $$;
