create extension if not exists pgcrypto;

create table if not exists public.calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default upper(encode(gen_random_bytes(6), 'hex')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_members (
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (calendar_id, user_id)
);

create table if not exists public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  item_type text not null check (item_type in ('event', 'task', 'lesson')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  completed boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_item_valid_time check (ends_at >= starts_at)
);

create index if not exists calendar_items_calendar_starts_idx
  on public.calendar_items (calendar_id, starts_at);
create index if not exists calendar_members_user_idx
  on public.calendar_members (user_id);

create or replace function public.add_calendar_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.calendar_members (calendar_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

drop trigger if exists add_calendar_creator on public.calendars;
create trigger add_calendar_creator
after insert on public.calendars
for each row execute function public.add_calendar_creator_as_member();

create or replace function public.join_calendar_with_code(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_calendar_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Devi accedere per unirti a un calendario.';
  end if;

  select id into found_calendar_id
  from public.calendars
  where invite_code = upper(trim(p_invite_code));

  if found_calendar_id is null then
    raise exception 'Codice invito non valido.';
  end if;

  insert into public.calendar_members (calendar_id, user_id, role)
  values (found_calendar_id, auth.uid(), 'member')
  on conflict (calendar_id, user_id) do nothing;

  return found_calendar_id;
end;
$$;

revoke all on function public.join_calendar_with_code(text) from public;
grant execute on function public.join_calendar_with_code(text) to authenticated;

alter table public.calendars enable row level security;
alter table public.calendar_members enable row level security;
alter table public.calendar_items enable row level security;

revoke all on table public.calendars, public.calendar_members, public.calendar_items from anon;
grant select, insert on table public.calendars to authenticated;
grant select on table public.calendar_members to authenticated;
grant select, insert, update, delete on table public.calendar_items to authenticated;

drop policy if exists "Members can read their calendars" on public.calendars;
create policy "Members can read their calendars"
on public.calendars for select to authenticated
using (
  exists (
    select 1 from public.calendar_members
    where calendar_members.calendar_id = calendars.id
      and calendar_members.user_id = (select auth.uid())
  )
);

drop policy if exists "Authenticated users can create calendars" on public.calendars;
create policy "Authenticated users can create calendars"
on public.calendars for insert to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists "Users can read their own memberships" on public.calendar_members;
create policy "Users can read their own memberships"
on public.calendar_members for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Members can read calendar items" on public.calendar_items;
create policy "Members can read calendar items"
on public.calendar_items for select to authenticated
using (
  exists (
    select 1 from public.calendar_members
    where calendar_members.calendar_id = calendar_items.calendar_id
      and calendar_members.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can create calendar items" on public.calendar_items;
create policy "Members can create calendar items"
on public.calendar_items for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.calendar_members
    where calendar_members.calendar_id = calendar_items.calendar_id
      and calendar_members.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can update calendar items" on public.calendar_items;
create policy "Members can update calendar items"
on public.calendar_items for update to authenticated
using (
  exists (
    select 1 from public.calendar_members
    where calendar_members.calendar_id = calendar_items.calendar_id
      and calendar_members.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.calendar_members
    where calendar_members.calendar_id = calendar_items.calendar_id
      and calendar_members.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can delete calendar items" on public.calendar_items;
create policy "Members can delete calendar items"
on public.calendar_items for delete to authenticated
using (
  exists (
    select 1 from public.calendar_members
    where calendar_members.calendar_id = calendar_items.calendar_id
      and calendar_members.user_id = (select auth.uid())
  )
);

do $$
begin
  alter publication supabase_realtime add table public.calendar_items;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
