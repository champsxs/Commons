-- Departments: groups above teams. A department contains whole teams and/or individual people,
-- and a dataset or page can be opened to everyone in one department.

create table commons.departments (
  id    uuid primary key default gen_random_uuid(),
  slug  text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,60}$'),
  name  text not null
);

create table commons.department_teams (
  department_id uuid not null references commons.departments(id) on delete cascade,
  team_id       uuid not null references commons.teams(id) on delete cascade,
  primary key (department_id, team_id)
);

create table commons.department_members (
  department_id uuid not null references commons.departments(id) on delete cascade,
  user_id       uuid not null references commons.users(id) on delete cascade,
  primary key (department_id, user_id)
);

alter table commons.datasets add column department_id uuid references commons.departments(id);
alter table commons.pages add column department_id uuid references commons.departments(id);

alter table commons.datasets drop constraint datasets_visibility_check;
alter table commons.datasets add constraint datasets_visibility_check
  check (visibility in ('private', 'shared', 'department', 'company'));
alter table commons.datasets add constraint datasets_department_check
  check (visibility <> 'department' or department_id is not null);

alter table commons.pages drop constraint pages_visibility_check;
alter table commons.pages add constraint pages_visibility_check
  check (visibility in ('private', 'shared', 'department', 'company'));
alter table commons.pages add constraint pages_department_check
  check (visibility <> 'department' or department_id is not null);

-- A department can't be deleted while datasets or pages are opened to it
-- (the foreign keys above have no cascade).

/** True when the person is in the department directly or through one of its teams. */
create function commons.in_department(p_department uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = commons, pg_temp as $$
  select exists (select 1 from department_members where department_id = p_department and user_id = p_user)
      or exists (
        select 1 from department_teams dt join team_members m on m.team_id = dt.team_id
        where dt.department_id = p_department and m.user_id = p_user)
$$;

create or replace function commons.can_view_dataset(p_dataset uuid) returns boolean
language sql stable security definer set search_path = commons, pg_temp as $$
  select exists (
    select 1 from datasets d
    where d.id = p_dataset and (
      d.visibility = 'company'
      or d.owner_id = current_user_id()
      or exists (select 1 from users u where u.id = current_user_id() and u.is_admin)
      or exists (select 1 from team_members m where m.team_id = d.team_id and m.user_id = current_user_id())
      or (d.visibility = 'department' and in_department(d.department_id, current_user_id()))
      or (d.visibility = 'shared' and exists (
            select 1 from dataset_shares s
            left join team_members m on m.team_id = s.team_id and m.user_id = current_user_id()
            where s.dataset_id = d.id and (s.user_id = current_user_id() or m.user_id is not null)))
    )
  )
$$;

create or replace function commons.can_view_page(p_page uuid) returns boolean
language sql stable security definer set search_path = commons, pg_temp as $$
  select exists (
    select 1 from pages p
    where p.id = p_page and (
      p.visibility = 'company'
      or p.owner_id = current_user_id()
      or exists (select 1 from users u where u.id = current_user_id() and u.is_admin)
      or exists (select 1 from team_members m where m.team_id = p.team_id and m.user_id = current_user_id())
      or (p.visibility = 'department' and in_department(p.department_id, current_user_id()))
      or (p.visibility = 'shared' and exists (
            select 1 from page_shares s
            left join team_members m on m.team_id = s.team_id and m.user_id = current_user_id()
            where s.page_id = p.id and (s.user_id = current_user_id() or m.user_id is not null)))
    )
  )
$$;

grant execute on function commons.in_department(uuid, uuid) to commons_user;
