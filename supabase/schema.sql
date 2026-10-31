begin;

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
  display_name text not null default '',
  color text not null default 'violet',
  created_at timestamptz not null default now(),
  primary key (calendar_id, user_id)
);

alter table public.calendar_members
  add column if not exists display_name text not null default '',
  add column if not exists color text not null default 'violet';

update public.calendar_members as member
set display_name = coalesce(
  nullif(btrim(left(split_part(account.email, '@', 1), 40)), ''),
  'Membro'
)
from auth.users as account
where account.id = member.user_id
  and btrim(member.display_name) = '';

do $$
begin
  alter table public.calendar_members
    add constraint calendar_members_display_name_check
    check (char_length(btrim(display_name)) between 1 and 40);
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.calendar_members
    add constraint calendar_members_color_check
    check (color in ('violet', 'blue', 'coral', 'green', 'amber', 'pink'));
exception
  when duplicate_object then null;
end;
$$;

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
  assignee_id uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_item_valid_time check (ends_at >= starts_at)
);

alter table public.calendar_items
  add column if not exists assignee_id uuid references auth.users(id) on delete set null;

create index if not exists calendar_items_calendar_starts_idx
  on public.calendar_items (calendar_id, starts_at);
create index if not exists calendar_items_calendar_assignee_starts_idx
  on public.calendar_items (calendar_id, assignee_id, starts_at);
create index if not exists calendar_members_user_idx
  on public.calendar_members (user_id);

create or replace function public.is_current_user_calendar_member(p_calendar_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.calendar_members as member
    where member.calendar_id = p_calendar_id
      and member.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_current_user_calendar_member(uuid) from public;
grant execute on function public.is_current_user_calendar_member(uuid) to authenticated;

create or replace function public.add_calendar_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.calendar_members (calendar_id, user_id, role, display_name)
  select
    new.id,
    new.created_by,
    'owner',
    coalesce(nullif(btrim(left(split_part(account.email, '@', 1), 40)), ''), 'Membro')
  from auth.users as account
  where account.id = new.created_by
  on conflict (calendar_id, user_id) do nothing;
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
set search_path = ''
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

  insert into public.calendar_members (calendar_id, user_id, role, display_name)
  select
    found_calendar_id,
    account.id,
    'member',
    coalesce(nullif(btrim(left(split_part(account.email, '@', 1), 40)), ''), 'Membro')
  from auth.users as account
  where account.id = (select auth.uid())
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
revoke all on table public.calendar_members from authenticated;
grant select on table public.calendar_members to authenticated;
grant update (display_name, color) on table public.calendar_members to authenticated;
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
drop policy if exists "Members can read membership profiles" on public.calendar_members;
create policy "Members can read membership profiles"
on public.calendar_members for select to authenticated
using (public.is_current_user_calendar_member(calendar_id));

drop policy if exists "Users can update their own membership profile" on public.calendar_members;
create policy "Users can update their own membership profile"
on public.calendar_members for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and public.is_current_user_calendar_member(calendar_id)
);

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

do $$
begin
  alter publication supabase_realtime add table public.calendar_members;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

-- Existing members retain their editing rights; newly invited members start as viewers.
alter table public.calendar_members add column if not exists can_edit boolean not null default true;
alter table public.calendar_members alter column can_edit set default false;
alter table public.calendar_items add column if not exists visibility text not null default 'everyone';
alter table public.calendar_items add column if not exists visible_to uuid[] not null default '{}';

do $$
begin
  alter table public.calendar_items add constraint calendar_items_visibility_check
    check (visibility in ('everyone', 'selected'));
exception when duplicate_object then null;
end;
$$;

create or replace function public.can_edit_calendar(p_calendar_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.calendar_members
    where calendar_id = p_calendar_id and user_id = (select auth.uid())
      and (role = 'owner' or can_edit)
  );
$$;

create or replace function public.can_view_calendar_item(
  p_calendar_id uuid, p_created_by uuid, p_visibility text, p_visible_to uuid[]
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_current_user_calendar_member(p_calendar_id)
    and (p_visibility = 'everyone' or p_created_by = (select auth.uid())
      or (select auth.uid()) = any(p_visible_to));
$$;

revoke all on function public.can_edit_calendar(uuid) from public;
revoke all on function public.can_view_calendar_item(uuid, uuid, text, uuid[]) from public;
grant execute on function public.can_edit_calendar(uuid) to authenticated;
grant execute on function public.can_view_calendar_item(uuid, uuid, text, uuid[]) to authenticated;

create or replace function public.check_calendar_item_access()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.calendar_id <> old.calendar_id or new.created_by <> old.created_by) then
    raise exception 'Il calendario e il creatore non possono essere modificati.';
  end if;
  if exists (
    select 1 from unnest(new.visible_to) as recipient(user_id)
    where recipient.user_id is null or not exists (
      select 1 from public.calendar_members
      where calendar_id = new.calendar_id and user_id = recipient.user_id
    )
  ) then
    raise exception 'La visibilità può includere solo membri del calendario.';
  end if;
  return new;
end;
$$;

drop trigger if exists check_calendar_item_access on public.calendar_items;
create trigger check_calendar_item_access before insert or update on public.calendar_items
for each row execute function public.check_calendar_item_access();

drop policy if exists "Members can read calendar items" on public.calendar_items;
create policy "Members can read calendar items" on public.calendar_items for select to authenticated
using (public.can_view_calendar_item(calendar_id, created_by, visibility, visible_to));

drop policy if exists "Members can create calendar items" on public.calendar_items;
create policy "Members can create calendar items" on public.calendar_items for insert to authenticated
with check (created_by = (select auth.uid()) and public.can_edit_calendar(calendar_id));

drop policy if exists "Members can update calendar items" on public.calendar_items;
create policy "Members can update calendar items" on public.calendar_items for update to authenticated
using (public.can_edit_calendar(calendar_id) and public.can_view_calendar_item(calendar_id, created_by, visibility, visible_to))
with check (public.can_edit_calendar(calendar_id) and public.can_view_calendar_item(calendar_id, created_by, visibility, visible_to));

drop policy if exists "Members can delete calendar items" on public.calendar_items;
create policy "Members can delete calendar items" on public.calendar_items for delete to authenticated
using (public.can_edit_calendar(calendar_id) and public.can_view_calendar_item(calendar_id, created_by, visibility, visible_to));

revoke select on public.calendars from authenticated;
grant select (id, name, created_by, created_at) on public.calendars to authenticated;

create or replace function public.get_calendar_invite_code(p_calendar_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare result text;
begin
  select c.invite_code into result from public.calendars c
  join public.calendar_members m on m.calendar_id = c.id
  where c.id = p_calendar_id and m.user_id = (select auth.uid()) and m.role = 'owner';
  if result is null then raise exception 'Solo il proprietario può accedere al codice.'; end if;
  return result;
end;
$$;

create or replace function public.manage_calendar_member(p_calendar_id uuid, p_user_id uuid, p_can_edit boolean, p_remove boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.calendar_members where calendar_id = p_calendar_id
    and user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Solo il proprietario può gestire i membri.';
  end if;
  if not exists (select 1 from public.calendar_members where calendar_id = p_calendar_id
    and user_id = p_user_id and role = 'member') then
    raise exception 'Membro non trovato o non modificabile.';
  end if;
  if p_remove then
    update public.calendar_items set visible_to = array_remove(visible_to, p_user_id)
      where calendar_id = p_calendar_id and p_user_id = any(visible_to);
    delete from public.calendar_members where calendar_id = p_calendar_id and user_id = p_user_id;
    update public.calendars set invite_code = upper(replace(gen_random_uuid()::text, '-', '')) where id = p_calendar_id;
  else
    update public.calendar_members set can_edit = p_can_edit where calendar_id = p_calendar_id and user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.get_calendar_invite_code(uuid) from public;
revoke all on function public.manage_calendar_member(uuid, uuid, boolean, boolean) from public;
grant execute on function public.get_calendar_invite_code(uuid) to authenticated;
grant execute on function public.manage_calendar_member(uuid, uuid, boolean, boolean) to authenticated;

create table if not exists public.watch_sessions (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (id, calendar_id)
);

create table if not exists public.watch_participants (
  session_id uuid not null,
  calendar_id uuid not null,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id),
  foreign key (session_id, calendar_id) references public.watch_sessions(id, calendar_id) on delete cascade,
  foreign key (calendar_id, user_id) references public.calendar_members(calendar_id, user_id) on delete cascade
);

create table if not exists public.watch_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  calendar_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  category text not null check (category in ('film', 'serie', 'gioco', 'altro')),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, id),
  foreign key (session_id, calendar_id) references public.watch_sessions(id, calendar_id) on delete cascade
);

create table if not exists public.watch_votes (
  session_id uuid not null,
  item_id uuid not null,
  user_id uuid not null,
  liked boolean not null,
  rating smallint check (rating between 1 and 5),
  primary key (session_id, item_id, user_id),
  foreign key (session_id, item_id) references public.watch_items(session_id, id) on delete cascade,
  foreign key (session_id, user_id) references public.watch_participants(session_id, user_id) on delete cascade
);

do $$
begin
  alter table public.watch_items add constraint watch_items_tags_size_check
    check (length(array_to_string(tags, ',')) <= 410 and array_position(tags, null) is null);
exception when duplicate_object then null;
end;
$$;

alter table public.watch_sessions enable row level security;
alter table public.watch_participants enable row level security;
alter table public.watch_items enable row level security;
alter table public.watch_votes enable row level security;
revoke all on public.watch_sessions, public.watch_participants, public.watch_items, public.watch_votes from anon, authenticated;
grant select, insert on public.watch_sessions, public.watch_participants, public.watch_items, public.watch_votes to authenticated;
grant delete on public.watch_sessions, public.watch_participants, public.watch_items to authenticated;
grant update (liked, rating) on public.watch_votes to authenticated;

drop policy if exists "Members read watch sessions" on public.watch_sessions;
create policy "Members read watch sessions" on public.watch_sessions for select to authenticated
using (public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Editors create watch sessions" on public.watch_sessions;
create policy "Editors create watch sessions" on public.watch_sessions for insert to authenticated
with check (created_by = (select auth.uid()) and public.can_edit_calendar(calendar_id));
drop policy if exists "Editors delete watch sessions" on public.watch_sessions;
create policy "Editors delete watch sessions" on public.watch_sessions for delete to authenticated
using (public.can_edit_calendar(calendar_id));

drop policy if exists "Members read watch participants" on public.watch_participants;
create policy "Members read watch participants" on public.watch_participants for select to authenticated
using (public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Members join watch sessions" on public.watch_participants;
create policy "Members join watch sessions" on public.watch_participants for insert to authenticated
with check (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Participants leave watch sessions" on public.watch_participants;
create policy "Participants leave watch sessions" on public.watch_participants for delete to authenticated
using (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));

drop policy if exists "Members read watch items" on public.watch_items;
create policy "Members read watch items" on public.watch_items for select to authenticated
using (public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Editors create watch items" on public.watch_items;
create policy "Editors create watch items" on public.watch_items for insert to authenticated
with check (created_by = (select auth.uid()) and public.can_edit_calendar(calendar_id));
drop policy if exists "Editors delete watch items" on public.watch_items;
create policy "Editors delete watch items" on public.watch_items for delete to authenticated
using (public.can_edit_calendar(calendar_id));

drop policy if exists "Members read watch votes" on public.watch_votes;
create policy "Members read watch votes" on public.watch_votes for select to authenticated
using (exists (select 1 from public.watch_participants p
  where p.session_id = watch_votes.session_id and p.user_id = watch_votes.user_id
    and public.is_current_user_calendar_member(p.calendar_id)));
drop policy if exists "Participants vote" on public.watch_votes;
create policy "Participants vote" on public.watch_votes for insert to authenticated
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.watch_participants p
  where p.session_id = watch_votes.session_id and p.user_id = (select auth.uid())
    and public.is_current_user_calendar_member(p.calendar_id)
));
drop policy if exists "Participants update votes" on public.watch_votes;
create policy "Participants update votes" on public.watch_votes for update to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.watch_participants p
  where p.session_id = watch_votes.session_id and p.user_id = (select auth.uid())
    and public.is_current_user_calendar_member(p.calendar_id)
))
with check (user_id = (select auth.uid()));

do $$
declare table_name text;
begin
  foreach table_name in array array['watch_sessions', 'watch_participants', 'watch_items', 'watch_votes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception when duplicate_object or undefined_object then null;
    end;
  end loop;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('family-shared', 'family-shared', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

create or replace function public.shared_object_calendar_id(p_name text)
returns uuid language sql immutable set search_path = ''
as $$
  select case when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(p_name, '/', 2) <> '' and split_part(p_name, '/', 3) = ''
    then split_part(p_name, '/', 1)::uuid else null end;
$$;
revoke all on function public.shared_object_calendar_id(text) from public;
grant execute on function public.shared_object_calendar_id(text) to authenticated;

drop policy if exists "Members read shared files" on storage.objects;
create policy "Members read shared files" on storage.objects for select to authenticated
using (bucket_id = 'family-shared' and public.is_current_user_calendar_member(public.shared_object_calendar_id(name)));
drop policy if exists "Editors upload shared files" on storage.objects;
create policy "Editors upload shared files" on storage.objects for insert to authenticated
with check (bucket_id = 'family-shared' and public.can_edit_calendar(public.shared_object_calendar_id(name)));
drop policy if exists "Editors delete shared files" on storage.objects;
create policy "Editors delete shared files" on storage.objects for delete to authenticated
using (bucket_id = 'family-shared' and public.can_edit_calendar(public.shared_object_calendar_id(name)));

create table if not exists public.shared_playback (
  calendar_id uuid primary key references public.calendars(id) on delete cascade,
  object_path text not null,
  position_seconds double precision not null default 0,
  playing boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.shared_playback enable row level security;
revoke all on public.shared_playback from anon, authenticated;

create or replace function public.get_shared_playback(p_calendar_id uuid)
returns table (object_path text, position_seconds double precision, playing boolean, updated_at timestamptz, server_now timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_current_user_calendar_member(p_calendar_id) then
    raise exception 'Accesso allo spazio non autorizzato.';
  end if;
  return query select p.object_path, p.position_seconds, p.playing, p.updated_at, clock_timestamp()
    from public.shared_playback p where p.calendar_id = p_calendar_id;
end;
$$;

create or replace function public.set_shared_playback(p_calendar_id uuid, p_object_path text, p_position double precision, p_playing boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_edit_calendar(p_calendar_id) then raise exception 'Solo gli editor possono controllare la riproduzione.'; end if;
  if p_position is null or p_position < 0 or p_position > 604800
    or p_position::text in ('NaN', 'Infinity', '-Infinity') or p_playing is null
    or public.shared_object_calendar_id(p_object_path) is distinct from p_calendar_id
    or not exists (select 1 from storage.objects where bucket_id = 'family-shared' and name = p_object_path) then
    raise exception 'File o posizione di riproduzione non validi.';
  end if;
  insert into public.shared_playback (calendar_id, object_path, position_seconds, playing, updated_at)
  values (p_calendar_id, p_object_path, p_position, p_playing, clock_timestamp())
  on conflict (calendar_id) do update set object_path = excluded.object_path,
    position_seconds = excluded.position_seconds, playing = excluded.playing, updated_at = excluded.updated_at;
end;
$$;
create or replace function public.clear_shared_playback(p_calendar_id uuid, p_object_path text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_edit_calendar(p_calendar_id) then raise exception 'Solo gli editor possono controllare la riproduzione.'; end if;
  delete from public.shared_playback where calendar_id = p_calendar_id and object_path = p_object_path;
end;
$$;
revoke all on function public.get_shared_playback(uuid) from public;
revoke all on function public.set_shared_playback(uuid, text, double precision, boolean) from public;
revoke all on function public.clear_shared_playback(uuid, text) from public;
grant execute on function public.get_shared_playback(uuid) to authenticated;
grant execute on function public.set_shared_playback(uuid, text, double precision, boolean) to authenticated;
grant execute on function public.clear_shared_playback(uuid, text) to authenticated;

alter table public.calendars add column if not exists edit_invite_code text
  not null default upper(replace(gen_random_uuid()::text, '-', ''));
create unique index if not exists calendars_edit_invite_code_idx on public.calendars(edit_invite_code);

create or replace function public.join_calendar_with_code(p_invite_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare found_calendar_id uuid; grant_edit boolean;
begin
  if auth.uid() is null then raise exception 'Devi accedere per unirti a un calendario.'; end if;
  select id, edit_invite_code = upper(trim(p_invite_code)) into found_calendar_id, grant_edit
    from public.calendars
    where invite_code = upper(trim(p_invite_code)) or edit_invite_code = upper(trim(p_invite_code));
  if found_calendar_id is null then raise exception 'Codice invito non valido.'; end if;
  insert into public.calendar_members (calendar_id, user_id, role, display_name, can_edit)
    select found_calendar_id, account.id, 'member',
      coalesce(nullif(btrim(left(split_part(account.email, '@', 1), 40)), ''), 'Membro'), grant_edit
    from auth.users account where account.id = (select auth.uid())
  on conflict (calendar_id, user_id) do nothing;
  return found_calendar_id;
end;
$$;

create or replace function public.get_calendar_edit_invite_code(p_calendar_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare result text;
begin
  select c.edit_invite_code into result from public.calendars c
    join public.calendar_members m on m.calendar_id = c.id
    where c.id = p_calendar_id and m.user_id = (select auth.uid()) and m.role = 'owner';
  if result is null then raise exception 'Solo il proprietario può accedere al codice.'; end if;
  return result;
end;
$$;

create or replace function public.rotate_calendar_invites(p_calendar_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.calendar_members where calendar_id = p_calendar_id
    and user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Solo il proprietario può revocare gli inviti.';
  end if;
  update public.calendars set invite_code = upper(replace(gen_random_uuid()::text, '-', '')),
    edit_invite_code = upper(replace(gen_random_uuid()::text, '-', '')) where id = p_calendar_id;
end;
$$;

create or replace function public.manage_calendar_member(p_calendar_id uuid, p_user_id uuid, p_can_edit boolean, p_remove boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.calendar_members where calendar_id = p_calendar_id
    and user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Solo il proprietario può gestire i membri.';
  end if;
  if not exists (select 1 from public.calendar_members where calendar_id = p_calendar_id
    and user_id = p_user_id and role = 'member') then
    raise exception 'Membro non trovato o non modificabile.';
  end if;
  if p_remove then
    update public.calendar_items set visible_to = array_remove(visible_to, p_user_id)
      where calendar_id = p_calendar_id and p_user_id = any(visible_to);
    delete from public.calendar_members where calendar_id = p_calendar_id and user_id = p_user_id;
    perform public.rotate_calendar_invites(p_calendar_id);
  else
    update public.calendar_members set can_edit = p_can_edit where calendar_id = p_calendar_id and user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.get_calendar_edit_invite_code(uuid) from public;
revoke all on function public.rotate_calendar_invites(uuid) from public;
grant execute on function public.get_calendar_edit_invite_code(uuid), public.rotate_calendar_invites(uuid) to authenticated;

alter table public.watch_sessions add column if not exists status text not null default 'draft';
alter table public.watch_items add column if not exists tmdb_id bigint;
alter table public.watch_items add column if not exists poster_path text;
alter table public.watch_items add column if not exists release_date text;
revoke insert on public.watch_sessions from authenticated;
grant insert (id, calendar_id, name, created_by) on public.watch_sessions to authenticated;
do $$
begin
  alter table public.watch_sessions add constraint watch_sessions_status_check
    check (status in ('draft', 'voting', 'finished'));
exception when duplicate_object then null;
end;
$$;
do $$
begin
  alter table public.watch_items add constraint watch_items_poster_path_check
    check (poster_path is null or poster_path ~ '^/[A-Za-z0-9_.-]+$');
exception when duplicate_object then null;
end;
$$;
create unique index if not exists watch_items_tmdb_unique
  on public.watch_items(session_id, category, tmdb_id) where tmdb_id is not null;
update public.watch_sessions s set status = 'voting'
  where s.status = 'draft' and exists (select 1 from public.watch_votes v where v.session_id = s.id);

create or replace function public.guard_watch_round()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare round_status text; target_session uuid;
begin
  if tg_op = 'DELETE' then target_session := old.session_id; else target_session := new.session_id; end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  select status into round_status from public.watch_sessions where id = target_session for update;
  if round_status is null then raise exception 'Sessione non trovata.'; end if;
  if tg_table_name = 'watch_votes' then
    if round_status <> 'voting' then raise exception 'La sessione non è in votazione.'; end if;
  elsif round_status <> 'draft' then
    raise exception 'Partecipanti e titoli non possono cambiare dopo l’avvio.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists guard_watch_items on public.watch_items;
create trigger guard_watch_items before insert or delete on public.watch_items
for each row execute function public.guard_watch_round();
drop trigger if exists guard_watch_participants on public.watch_participants;
create trigger guard_watch_participants before insert or delete on public.watch_participants
for each row execute function public.guard_watch_round();
drop trigger if exists guard_watch_votes on public.watch_votes;
create trigger guard_watch_votes before insert or update on public.watch_votes
for each row execute function public.guard_watch_round();

create or replace function public.start_watch_round(p_session_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare round_row public.watch_sessions%rowtype;
begin
  select * into round_row from public.watch_sessions where id = p_session_id for update;
  if round_row.id is null or not public.can_edit_calendar(round_row.calendar_id) then
    raise exception 'Solo un editor dello spazio può avviare la sessione.';
  end if;
  if round_row.status <> 'draft' then raise exception 'La sessione è già stata avviata.'; end if;
  if (select count(*) from public.watch_participants where session_id = p_session_id) < 2 then
    raise exception 'Servono almeno due partecipanti.';
  end if;
  if not exists (select 1 from public.watch_items where session_id = p_session_id) then
    raise exception 'Aggiungi almeno un titolo.';
  end if;
  update public.watch_sessions set status = 'voting' where id = p_session_id;
end;
$$;

create or replace function public.finish_watch_round_if_complete(p_session_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare round_row public.watch_sessions%rowtype;
begin
  select * into round_row from public.watch_sessions where id = p_session_id for update;
  if round_row.id is null or not public.is_current_user_calendar_member(round_row.calendar_id) then
    raise exception 'Sessione non accessibile.';
  end if;
  if round_row.status = 'finished' then return true; end if;
  if round_row.status <> 'voting'
    or (select count(*) from public.watch_participants where session_id = p_session_id) < 2
    or not exists (select 1 from public.watch_items where session_id = p_session_id)
    or exists (
      select 1 from public.watch_participants p cross join public.watch_items i
      where p.session_id = p_session_id and i.session_id = p_session_id
        and not exists (select 1 from public.watch_votes v
          where v.session_id = p_session_id and v.user_id = p.user_id and v.item_id = i.id)
    ) then return false; end if;
  update public.watch_sessions set status = 'finished' where id = p_session_id;
  return true;
end;
$$;
revoke all on function public.start_watch_round(uuid), public.finish_watch_round_if_complete(uuid) from public;
grant execute on function public.start_watch_round(uuid), public.finish_watch_round_if_complete(uuid) to authenticated;

drop policy if exists "Members read watch votes" on public.watch_votes;
create policy "Members read watch votes" on public.watch_votes for select to authenticated
using (exists (
  select 1 from public.watch_sessions s where s.id = watch_votes.session_id
    and public.is_current_user_calendar_member(s.calendar_id)
    and (watch_votes.user_id = (select auth.uid()) or s.status = 'finished')
));

commit;
