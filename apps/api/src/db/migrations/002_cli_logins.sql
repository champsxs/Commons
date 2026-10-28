-- Browser sign-in for the CLI: the CLI starts a request, the person approves it in the web app,
-- and the CLI picks up a new API token once.
create table commons.cli_logins (
  id           uuid primary key default gen_random_uuid(),
  device_hash  text not null unique,        -- sha256 of the secret the CLI polls with
  user_code    text not null unique,        -- short code shown in both places, e.g. KQWX-7RTD
  client_name  text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'claimed')),
  user_id      uuid references commons.users(id) on delete cascade,
  token        text,                        -- plain token, kept only until the CLI claims it
  scopes       text[],
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
