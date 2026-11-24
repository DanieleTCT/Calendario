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
alter table public.calendar_members add column if not exists style_border text not null default 'solid';
alter table public.calendar_members add column if not exists allow_style_editors boolean not null default true;
do $$
begin
  alter table public.calendar_members add constraint calendar_members_style_border_check
    check (style_border in ('solid', 'dashed', 'double'));
exception when duplicate_object then null;
end;
$$;
grant update (style_border, allow_style_editors) on public.calendar_members to authenticated;
alter table public.calendar_items add column if not exists visibility text not null default 'everyone';
alter table public.calendar_items add column if not exists visible_to uuid[] not null default '{}';
alter table public.calendar_items add column if not exists editable_by uuid[] not null default '{}';
alter table public.calendar_items add column if not exists tags text[] not null default '{}';
alter table public.calendar_items add column if not exists source_provider text;
alter table public.calendar_items add column if not exists source_uid text;

alter table public.calendar_items drop constraint if exists calendar_items_visibility_check;
alter table public.calendar_items add constraint calendar_items_visibility_check
  check (visibility in ('private', 'everyone', 'selected'));
do $$
begin
  alter table public.calendar_items add constraint calendar_items_tags_check
    check (cardinality(tags) <= 12 and array_position(tags, null) is null);
exception when duplicate_object then null;
end;
$$;

create table if not exists public.calendar_view_preferences (
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden_item_ids uuid[] not null default '{}',
  hidden_member_ids uuid[] not null default '{}',
  category_styles jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (calendar_id, user_id),
  check (cardinality(hidden_item_ids) <= 500),
  check (cardinality(hidden_member_ids) <= 100),
  check (jsonb_typeof(category_styles) = 'object' and octet_length(category_styles::text) <= 2048)
);

alter table public.calendar_view_preferences enable row level security;
revoke all on public.calendar_view_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.calendar_view_preferences to authenticated;

drop policy if exists "Users read their calendar view preferences" on public.calendar_view_preferences;
create policy "Users read their calendar view preferences" on public.calendar_view_preferences for select to authenticated
using (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Users create their calendar view preferences" on public.calendar_view_preferences;
create policy "Users create their calendar view preferences" on public.calendar_view_preferences for insert to authenticated
with check (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Users update their calendar view preferences" on public.calendar_view_preferences;
create policy "Users update their calendar view preferences" on public.calendar_view_preferences for update to authenticated
using (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id))
with check (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Users delete their calendar view preferences" on public.calendar_view_preferences;
create policy "Users delete their calendar view preferences" on public.calendar_view_preferences for delete to authenticated
using (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));

do $$
begin
  alter publication supabase_realtime add table public.calendar_view_preferences;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

do $$
begin
  alter table public.calendar_items add constraint calendar_items_schedule_source_check
    check (
      (source_provider is null and source_uid is null)
      or (
        source_provider is not null
        and source_provider in ('polito', 'unito')
        and source_uid is not null
        and char_length(source_uid) = 64
      )
    );
exception when duplicate_object then null;
end;
$$;

create unique index if not exists calendar_items_schedule_source_uid_idx
  on public.calendar_items (calendar_id, created_by, source_provider, source_uid)
  where source_provider is not null and source_uid is not null;

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
    and case
      when p_visibility = 'private' then p_created_by = (select auth.uid())
      when p_visibility = 'selected' then p_created_by = (select auth.uid())
        or (select auth.uid()) = any(p_visible_to)
      else p_visibility = 'everyone'
    end;
$$;

create or replace function public.can_edit_calendar_item(
  p_calendar_id uuid, p_created_by uuid, p_editable_by uuid[]
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_current_user_calendar_member(p_calendar_id)
    and (p_created_by = (select auth.uid()) or (select auth.uid()) = any(p_editable_by));
$$;

create or replace function public.can_edit_member_style(
  p_calendar_id uuid, p_user_id uuid, p_allow_style_editors boolean
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_allow_style_editors
    and p_user_id <> (select auth.uid())
    and public.can_edit_calendar(p_calendar_id);
$$;

revoke all on function public.can_edit_calendar(uuid) from public;
revoke all on function public.can_view_calendar_item(uuid, uuid, text, uuid[]) from public;
revoke all on function public.can_edit_calendar_item(uuid, uuid, uuid[]) from public;
revoke all on function public.can_edit_member_style(uuid, uuid, boolean) from public;
grant execute on function public.can_edit_calendar(uuid) to authenticated;
grant execute on function public.can_view_calendar_item(uuid, uuid, text, uuid[]) to authenticated;
grant execute on function public.can_edit_calendar_item(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.can_edit_member_style(uuid, uuid, boolean) to authenticated;

drop policy if exists "Users can update their own membership profile" on public.calendar_members;
drop policy if exists "Users update member profiles and permitted appearance" on public.calendar_members;
create policy "Users update member profiles and permitted appearance" on public.calendar_members for update to authenticated
using (
  (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id))
  or public.can_edit_member_style(calendar_id, user_id, allow_style_editors)
)
with check (
  (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id))
  or public.can_edit_member_style(calendar_id, user_id, allow_style_editors)
);

create or replace function public.check_calendar_member_style_access()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> (select auth.uid()) then
    if new.calendar_id is distinct from old.calendar_id or new.user_id is distinct from old.user_id
      or new.display_name is distinct from old.display_name
      or new.allow_style_editors is distinct from old.allow_style_editors then
      raise exception 'Non puoi modificare questo profilo o le sue autorizzazioni.';
    end if;
    if (new.color is distinct from old.color or new.style_border is distinct from old.style_border)
      and not public.can_edit_member_style(old.calendar_id, old.user_id, old.allow_style_editors) then
      raise exception 'Questo membro non consente agli editor di modificare il suo aspetto.';
    end if;
    if (new.role is distinct from old.role or new.can_edit is distinct from old.can_edit)
      and not exists (
        select 1 from public.calendar_members
        where calendar_id = old.calendar_id and user_id = (select auth.uid()) and role = 'owner'
      ) then
      raise exception 'Solo il proprietario può modificare i permessi di un membro.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists check_calendar_member_style_access on public.calendar_members;
create trigger check_calendar_member_style_access before update on public.calendar_members
for each row execute function public.check_calendar_member_style_access();

create or replace function public.check_calendar_item_access()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.calendar_id <> old.calendar_id or new.created_by <> old.created_by) then
    raise exception 'Il calendario e il creatore non possono essere modificati.';
  end if;
  if tg_op = 'UPDATE' and new.created_by <> (select auth.uid())
    and (new.visibility is distinct from old.visibility
      or new.visible_to is distinct from old.visible_to
      or new.editable_by is distinct from old.editable_by) then
    if new.visibility is distinct from old.visibility
      or not (new.visible_to <@ old.visible_to)
      or not (new.editable_by <@ old.editable_by)
      or not exists (
        select 1 from public.calendar_members
        where calendar_id = old.calendar_id and user_id = (select auth.uid()) and role = 'owner'
      ) then
      raise exception 'Solo il creatore può ampliare la condivisione o le autorizzazioni dell’evento.';
    end if;
  end if;
  if new.visibility = 'private' and cardinality(new.visible_to) > 0 then
    raise exception 'Un evento personale non può avere destinatari condivisi.';
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
  if exists (
    select 1 from unnest(new.editable_by) as editor(user_id)
    where editor.user_id is null or editor.user_id = new.created_by or not exists (
      select 1 from public.calendar_members
      where calendar_id = new.calendar_id and user_id = editor.user_id
    )
  ) then
    raise exception 'Le autorizzazioni di modifica possono includere solo altri membri del calendario.';
  end if;
  if cardinality(new.tags) > 12 or exists (
    select 1 from unnest(new.tags) as tag(value)
    where char_length(btrim(tag.value)) not between 1 and 32
  ) then
    raise exception 'Un evento può avere al massimo 12 tag, ciascuno da 1 a 32 caratteri.';
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
with check (created_by = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));

drop policy if exists "Members can update calendar items" on public.calendar_items;
create policy "Members can update calendar items" on public.calendar_items for update to authenticated
using (public.can_edit_calendar_item(calendar_id, created_by, editable_by))
with check (public.can_edit_calendar_item(calendar_id, created_by, editable_by));

drop policy if exists "Members can delete calendar items" on public.calendar_items;
create policy "Members can delete calendar items" on public.calendar_items for delete to authenticated
using (public.can_edit_calendar_item(calendar_id, created_by, editable_by));

create table if not exists public.calendar_schedule_sources (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('polito', 'unito')),
  feed_url text not null check (char_length(feed_url) between 10 and 2048),
  created_at timestamptz not null default now(),
  unique (calendar_id, user_id, provider)
);

alter table public.calendar_schedule_sources enable row level security;
revoke all on public.calendar_schedule_sources from anon, authenticated;
grant select, insert, update, delete on public.calendar_schedule_sources to authenticated;

drop policy if exists "Users read their private schedule links" on public.calendar_schedule_sources;
create policy "Users read their private schedule links" on public.calendar_schedule_sources for select to authenticated
using (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Users add their private schedule links" on public.calendar_schedule_sources;
create policy "Users add their private schedule links" on public.calendar_schedule_sources for insert to authenticated
with check (user_id = (select auth.uid()) and public.can_edit_calendar(calendar_id));
drop policy if exists "Users update their private schedule links" on public.calendar_schedule_sources;
create policy "Users update their private schedule links" on public.calendar_schedule_sources for update to authenticated
using (user_id = (select auth.uid()) and public.can_edit_calendar(calendar_id))
with check (user_id = (select auth.uid()) and public.can_edit_calendar(calendar_id));
drop policy if exists "Users delete their private schedule links" on public.calendar_schedule_sources;
create policy "Users delete their private schedule links" on public.calendar_schedule_sources for delete to authenticated
using (user_id = (select auth.uid()) and public.can_edit_calendar(calendar_id));

create or replace function public.sync_calendar_schedule(
  p_calendar_id uuid,
  p_provider text,
  p_from timestamptz,
  p_until timestamptz,
  p_events jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  event_data jsonb;
  event_uid text;
  event_title text;
  event_description text;
  event_start timestamptz;
  event_end timestamptz;
  event_all_day boolean;
  changed_count integer := 0;
  deleted_count integer := 0;
begin
  if current_user_id is null or not public.can_edit_calendar(p_calendar_id) then
    raise exception 'Solo un editor del calendario può sincronizzare gli orari.';
  end if;
  if p_provider is null or p_provider not in ('polito', 'unito')
    or p_from is null or p_until is null or p_until <= p_from
    or p_events is null or jsonb_typeof(p_events) <> 'array'
    or jsonb_array_length(p_events) > 2000 then
    raise exception 'Parametri di sincronizzazione non validi.';
  end if;

  for event_data in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(event_data) <> 'object'
      or jsonb_typeof(event_data->'uid') <> 'string'
      or jsonb_typeof(event_data->'title') <> 'string'
      or jsonb_typeof(event_data->'description') <> 'string'
      or jsonb_typeof(event_data->'starts_at') <> 'string'
      or jsonb_typeof(event_data->'ends_at') <> 'string'
      or jsonb_typeof(event_data->'all_day') <> 'boolean' then
      raise exception 'Evento del feed non valido.';
    end if;
    event_uid := event_data->>'uid';
    event_title := btrim(event_data->>'title');
    event_description := event_data->>'description';
    if event_uid !~ '^[0-9a-f]{64}$'
      or char_length(event_title) not between 1 and 120
      or char_length(event_description) > 1000 then
      raise exception 'Evento del feed non valido.';
    end if;
    begin
      event_start := (event_data->>'starts_at')::timestamptz;
      event_end := (event_data->>'ends_at')::timestamptz;
    exception when others then
      raise exception 'Orario dell’evento non valido.';
    end;
    event_all_day := (event_data->>'all_day')::boolean;
    if event_end < event_start or event_start < p_from or event_start >= p_until then
      raise exception 'Orario dell’evento fuori dall’intervallo sincronizzato.';
    end if;

    insert into public.calendar_items (
      calendar_id, title, description, item_type, starts_at, ends_at,
      all_day, assignee_id, created_by, source_provider, source_uid
    ) values (
      p_calendar_id, event_title, event_description, 'lesson', event_start, event_end,
      event_all_day, current_user_id, current_user_id, p_provider, event_uid
    )
    on conflict (calendar_id, created_by, source_provider, source_uid)
      where source_provider is not null and source_uid is not null
    do update set
      title = excluded.title,
      description = excluded.description,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      all_day = excluded.all_day;
    changed_count := changed_count + 1;
  end loop;

  delete from public.calendar_items as item
  where item.calendar_id = p_calendar_id
    and item.created_by = current_user_id
    and item.source_provider = p_provider
    and item.source_uid is not null
    and item.starts_at >= p_from
    and item.starts_at < p_until
    and not exists (
      select 1
      from jsonb_array_elements(p_events) as current_event(value)
      where current_event.value->>'uid' = item.source_uid
    );
  get diagnostics deleted_count = row_count;
  return changed_count + deleted_count;
end;
$$;
revoke all on function public.sync_calendar_schedule(uuid, text, timestamptz, timestamptz, jsonb) from public;
grant execute on function public.sync_calendar_schedule(uuid, text, timestamptz, timestamptz, jsonb) to authenticated;

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
    update public.calendar_items
      set visible_to = array_remove(visible_to, p_user_id),
          editable_by = array_remove(editable_by, p_user_id)
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
values ('family-shared', 'family-shared', false, null)
on conflict (id) do update set public = false, file_size_limit = null;

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

create or replace function public.is_shared_audio(p_calendar_id uuid, p_object_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.shared_object_calendar_id(p_object_path) = p_calendar_id
    and exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'family-shared'
        and object.name = p_object_path
        and (
          lower(coalesce(object.metadata->>'mimetype', '')) like 'audio/%'
          or lower(object.name) ~ '\.(mp3|m4a|aac|wav|ogg|opus|flac|wma|aiff)$'
        )
    );
$$;
revoke all on function public.is_shared_audio(uuid, text) from public;
grant execute on function public.is_shared_audio(uuid, text) to authenticated;

create table if not exists public.shared_audio_playlists (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  is_queue boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists shared_audio_playlist_name_idx
  on public.shared_audio_playlists(calendar_id, lower(name)) where not is_queue;
alter table public.shared_audio_playlists enable row level security;
revoke all on public.shared_audio_playlists from anon, authenticated;
grant select, insert, update, delete on public.shared_audio_playlists to authenticated;
drop policy if exists "Members read shared audio playlists" on public.shared_audio_playlists;
create policy "Members read shared audio playlists" on public.shared_audio_playlists for select to authenticated
using (public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Members create shared audio playlists" on public.shared_audio_playlists;
create policy "Members create shared audio playlists" on public.shared_audio_playlists for insert to authenticated
with check (created_by = (select auth.uid()) and not is_queue and public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Members update shared audio playlists" on public.shared_audio_playlists;
create policy "Members update shared audio playlists" on public.shared_audio_playlists for update to authenticated
using (not is_queue and public.is_current_user_calendar_member(calendar_id))
with check (not is_queue and public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Members delete shared audio playlists" on public.shared_audio_playlists;
create policy "Members delete shared audio playlists" on public.shared_audio_playlists for delete to authenticated
using (not is_queue and public.is_current_user_calendar_member(calendar_id));

create or replace function public.check_shared_audio_playlist()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.calendar_id is distinct from old.calendar_id
      or new.created_by is distinct from old.created_by
      or new.is_queue is distinct from old.is_queue
      or old.is_queue then
      raise exception 'La coda condivisa non si può rinominare o sostituire.';
    end if;
  elsif new.is_queue then
    if new.name <> 'Coda condivisa'
      or not exists (select 1 from public.calendars where id = new.calendar_id and created_by = new.created_by) then
      raise exception 'La coda condivisa non è valida.';
    end if;
  elsif new.created_by <> (select auth.uid()) then
    raise exception 'La playlist condivisa non è valida.';
  end if;
  return new;
end;
$$;

create table if not exists public.shared_audio_playlist_items (
  playlist_id uuid not null references public.shared_audio_playlists(id) on delete cascade,
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  object_path text not null,
  position integer not null check (position >= 0),
  added_by uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (playlist_id, object_path)
);
create index if not exists shared_audio_playlist_items_order_idx
  on public.shared_audio_playlist_items(playlist_id, position, added_at);
alter table public.shared_audio_playlist_items enable row level security;
revoke all on public.shared_audio_playlist_items from anon, authenticated;
grant select, insert, update, delete on public.shared_audio_playlist_items to authenticated;
drop policy if exists "Members read shared audio playlist items" on public.shared_audio_playlist_items;
create policy "Members read shared audio playlist items" on public.shared_audio_playlist_items for select to authenticated
using (public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Members add shared audio playlist items" on public.shared_audio_playlist_items;
create policy "Members add shared audio playlist items" on public.shared_audio_playlist_items for insert to authenticated
with check (added_by = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Members update shared audio playlist items" on public.shared_audio_playlist_items;
create policy "Members update shared audio playlist items" on public.shared_audio_playlist_items for update to authenticated
using (public.is_current_user_calendar_member(calendar_id))
with check (public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Members delete shared audio playlist items" on public.shared_audio_playlist_items;
create policy "Members delete shared audio playlist items" on public.shared_audio_playlist_items for delete to authenticated
using (public.is_current_user_calendar_member(calendar_id));

create or replace function public.check_shared_audio_playlist_item()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.playlist_id is distinct from old.playlist_id
    or new.calendar_id is distinct from old.calendar_id
    or new.object_path is distinct from old.object_path
    or new.added_by is distinct from old.added_by
  ) then
    raise exception 'Gli elementi non si possono spostare tra playlist.';
  end if;
  if not exists (
    select 1 from public.shared_audio_playlists playlist
    where playlist.id = new.playlist_id and playlist.calendar_id = new.calendar_id
  ) then
    raise exception 'La playlist non appartiene a questo spazio.';
  end if;
  if current_setting('app.syncing', true) is distinct from 'true' then
    if not public.is_shared_audio(new.calendar_id, new.object_path) then
      raise exception 'Il file indicato non è un audio condiviso.';
    end if;
    if tg_op = 'INSERT' and new.added_by <> (select auth.uid()) then
      raise exception 'Il membro che aggiunge il brano non è valido.';
    end if;
  end if;
  return new;
end;
$$;

create table if not exists public.shared_audio_favorites (
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null,
  created_at timestamptz not null default now(),
  primary key (calendar_id, user_id, object_path)
);
alter table public.shared_audio_favorites enable row level security;
revoke all on public.shared_audio_favorites from anon, authenticated;
grant select, insert, delete on public.shared_audio_favorites to authenticated;
drop policy if exists "Users read their shared audio favorites" on public.shared_audio_favorites;
create policy "Users read their shared audio favorites" on public.shared_audio_favorites for select to authenticated
using (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Users add their shared audio favorites" on public.shared_audio_favorites;
create policy "Users add their shared audio favorites" on public.shared_audio_favorites for insert to authenticated
with check (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id)
  and public.is_shared_audio(calendar_id, object_path));
drop policy if exists "Users remove their shared audio favorites" on public.shared_audio_favorites;
create policy "Users remove their shared audio favorites" on public.shared_audio_favorites for delete to authenticated
using (user_id = (select auth.uid()) and public.is_current_user_calendar_member(calendar_id));

create table if not exists public.shared_audio_player_settings (
  calendar_id uuid primary key references public.calendars(id) on delete cascade,
  active_playlist_id uuid not null references public.shared_audio_playlists(id),
  shuffle boolean not null default false,
  repeat_mode text not null default 'off' check (repeat_mode in ('off', 'all', 'one')),
  updated_at timestamptz not null default now()
);

drop trigger if exists check_shared_audio_playlist on public.shared_audio_playlists;
drop trigger if exists check_shared_audio_playlist_item on public.shared_audio_playlist_items;
lock table public.shared_audio_playlists, public.shared_audio_playlist_items,
  public.shared_audio_player_settings in share row exclusive mode;
do $$
declare duplicate_calendar record; queue_id uuid;
begin
  perform set_config('app.syncing', 'true', true);
  for duplicate_calendar in
    select calendar_id
    from public.shared_audio_playlists
    where is_queue
    group by calendar_id
    having count(*) > 1
  loop
    select playlist.id into queue_id
    from public.shared_audio_playlists playlist
    left join public.shared_audio_player_settings settings
      on settings.calendar_id = playlist.calendar_id
    where playlist.calendar_id = duplicate_calendar.calendar_id and playlist.is_queue
    order by (settings.active_playlist_id = playlist.id) desc nulls last,
      playlist.created_at, playlist.id
    limit 1;

    update public.shared_audio_player_settings
    set active_playlist_id = queue_id
    where calendar_id = duplicate_calendar.calendar_id
      and active_playlist_id in (
        select id from public.shared_audio_playlists
        where calendar_id = duplicate_calendar.calendar_id
          and is_queue and id <> queue_id
      );

    insert into public.shared_audio_playlist_items
      (playlist_id, calendar_id, object_path, position, added_by, added_at)
    select queue_id, item.calendar_id, item.object_path, item.position, item.added_by, item.added_at
    from public.shared_audio_playlist_items item
    join public.shared_audio_playlists duplicate
      on duplicate.id = item.playlist_id
    where duplicate.calendar_id = duplicate_calendar.calendar_id
      and duplicate.is_queue and duplicate.id <> queue_id
    order by item.position, item.added_at, item.object_path
    on conflict (playlist_id, object_path) do nothing;

    delete from public.shared_audio_playlist_items item
    using public.shared_audio_playlists duplicate
    where duplicate.id = item.playlist_id
      and duplicate.calendar_id = duplicate_calendar.calendar_id
      and duplicate.is_queue and duplicate.id <> queue_id;

    delete from public.shared_audio_playlists
    where calendar_id = duplicate_calendar.calendar_id
      and is_queue and id <> queue_id;

    with ordered_items as (
      select ctid, (row_number() over (order by position, added_at, object_path) - 1)::integer as new_position
      from public.shared_audio_playlist_items
      where playlist_id = queue_id
    )
    update public.shared_audio_playlist_items item
    set position = ordered_items.new_position
    from ordered_items
    where item.ctid = ordered_items.ctid;
  end loop;
end;
$$;
create unique index if not exists shared_audio_one_queue_per_calendar_idx
  on public.shared_audio_playlists(calendar_id) where is_queue;
create trigger check_shared_audio_playlist before insert or update on public.shared_audio_playlists
for each row execute function public.check_shared_audio_playlist();
create trigger check_shared_audio_playlist_item before insert or update on public.shared_audio_playlist_items
for each row execute function public.check_shared_audio_playlist_item();

alter table public.shared_audio_player_settings enable row level security;
revoke all on public.shared_audio_player_settings from anon, authenticated;
grant select, insert, update on public.shared_audio_player_settings to authenticated;
drop policy if exists "Members read shared audio player settings" on public.shared_audio_player_settings;
create policy "Members read shared audio player settings" on public.shared_audio_player_settings for select to authenticated
using (public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Members add shared audio player settings" on public.shared_audio_player_settings;
create policy "Members add shared audio player settings" on public.shared_audio_player_settings for insert to authenticated
with check (public.is_current_user_calendar_member(calendar_id));
drop policy if exists "Members update shared audio player settings" on public.shared_audio_player_settings;
create policy "Members update shared audio player settings" on public.shared_audio_player_settings for update to authenticated
using (public.is_current_user_calendar_member(calendar_id))
with check (public.is_current_user_calendar_member(calendar_id));

create or replace function public.check_shared_audio_player_settings()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.shared_audio_playlists playlist
    where playlist.id = new.active_playlist_id and playlist.calendar_id = new.calendar_id
  ) then
    raise exception 'La playlist attiva non appartiene a questo spazio.';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists check_shared_audio_player_settings on public.shared_audio_player_settings;
create trigger check_shared_audio_player_settings before insert or update on public.shared_audio_player_settings
for each row execute function public.check_shared_audio_player_settings();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'shared_audio_playlists', 'shared_audio_playlist_items',
    'shared_audio_favorites', 'shared_audio_player_settings'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception when duplicate_object or undefined_object then null;
    end;
  end loop;
end;
$$;

create or replace function public.add_shared_audio_playlist_item(
  p_calendar_id uuid, p_playlist_id uuid, p_object_path text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare next_position integer;
begin
  if not public.is_current_user_calendar_member(p_calendar_id)
    or not public.is_shared_audio(p_calendar_id, p_object_path) then
    raise exception 'Il file audio o lo spazio non è accessibile.';
  end if;
  perform 1 from public.shared_audio_playlists
    where id = p_playlist_id and calendar_id = p_calendar_id for update;
  if not found then raise exception 'Playlist non trovata.'; end if;
  select coalesce(max(position) + 1, 0) into next_position
    from public.shared_audio_playlist_items where playlist_id = p_playlist_id;
  insert into public.shared_audio_playlist_items
    (playlist_id, calendar_id, object_path, position, added_by)
  values (p_playlist_id, p_calendar_id, p_object_path, next_position, (select auth.uid()))
  on conflict (playlist_id, object_path) do nothing;
end;
$$;

create or replace function public.move_shared_audio_playlist_item(
  p_calendar_id uuid, p_playlist_id uuid, p_object_path text, p_new_position integer
)
returns void language plpgsql security definer set search_path = ''
as $$
declare old_position integer; item_count integer;
begin
  if not public.is_current_user_calendar_member(p_calendar_id) or p_new_position < 0 then
    raise exception 'Posizione o spazio non valido.';
  end if;
  perform 1 from public.shared_audio_playlists
    where id = p_playlist_id and calendar_id = p_calendar_id for update;
  if not found then raise exception 'Playlist non trovata.'; end if;
  select position into old_position from public.shared_audio_playlist_items
    where playlist_id = p_playlist_id and object_path = p_object_path for update;
  if not found then raise exception 'Brano non trovato nella playlist.'; end if;
  select count(*) into item_count from public.shared_audio_playlist_items where playlist_id = p_playlist_id;
  if p_new_position >= item_count then raise exception 'Posizione fuori dalla playlist.'; end if;
  if p_new_position < old_position then
    update public.shared_audio_playlist_items set position = position + 1
      where playlist_id = p_playlist_id and position >= p_new_position and position < old_position;
  elsif p_new_position > old_position then
    update public.shared_audio_playlist_items set position = position - 1
      where playlist_id = p_playlist_id and position > old_position and position <= p_new_position;
  end if;
  update public.shared_audio_playlist_items set position = p_new_position
    where playlist_id = p_playlist_id and object_path = p_object_path;
end;
$$;

create or replace function public.remove_shared_audio_playlist_item(
  p_calendar_id uuid, p_playlist_id uuid, p_object_path text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare old_position integer; active_playlist uuid; current_path text; next_path text;
begin
  if not public.is_current_user_calendar_member(p_calendar_id) then
    raise exception 'Accesso allo spazio non autorizzato.';
  end if;
  perform 1 from public.shared_audio_playlists
    where id = p_playlist_id and calendar_id = p_calendar_id for update;
  if not found then raise exception 'Playlist non trovata.'; end if;
  select position into old_position from public.shared_audio_playlist_items
    where playlist_id = p_playlist_id and object_path = p_object_path for update;
  if not found then return; end if;
  select active_playlist_id into active_playlist from public.shared_audio_player_settings
    where calendar_id = p_calendar_id;
  select object_path into current_path from public.shared_playback where calendar_id = p_calendar_id;
  delete from public.shared_audio_playlist_items
    where playlist_id = p_playlist_id and object_path = p_object_path;
  update public.shared_audio_playlist_items set position = position - 1
    where playlist_id = p_playlist_id and position > old_position;
  if active_playlist = p_playlist_id and current_path = p_object_path then
    select object_path into next_path from public.shared_audio_playlist_items
      where playlist_id = p_playlist_id and position >= old_position
      order by position, added_at, object_path limit 1;
    if next_path is null then
      select object_path into next_path from public.shared_audio_playlist_items
        where playlist_id = p_playlist_id order by position, added_at, object_path limit 1;
    end if;
    if next_path is null then
      delete from public.shared_playback where calendar_id = p_calendar_id;
    else
      update public.shared_playback set object_path = next_path, position_seconds = 0,
        playing = false, updated_at = clock_timestamp()
      where calendar_id = p_calendar_id;
    end if;
  end if;
end;
$$;
revoke all on function public.add_shared_audio_playlist_item(uuid, uuid, text) from public;
revoke all on function public.move_shared_audio_playlist_item(uuid, uuid, text, integer) from public;
revoke all on function public.remove_shared_audio_playlist_item(uuid, uuid, text) from public;
grant execute on function public.add_shared_audio_playlist_item(uuid, uuid, text) to authenticated;
grant execute on function public.move_shared_audio_playlist_item(uuid, uuid, text, integer) to authenticated;
grant execute on function public.remove_shared_audio_playlist_item(uuid, uuid, text) to authenticated;

create or replace function public.ensure_shared_audio_player()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare queue_id uuid;
begin
  insert into public.shared_audio_playlists (calendar_id, name, is_queue, created_by)
  values (new.id, 'Coda condivisa', true, new.created_by)
  on conflict (calendar_id) where is_queue do nothing
  returning id into queue_id;
  if queue_id is null then
    select id into queue_id from public.shared_audio_playlists
      where calendar_id = new.id and is_queue;
  end if;
  insert into public.shared_audio_player_settings (calendar_id, active_playlist_id)
    values (new.id, queue_id) on conflict (calendar_id) do nothing;
  return new;
end;
$$;
revoke all on function public.ensure_shared_audio_player() from public;
drop trigger if exists ensure_shared_audio_player on public.calendars;
create trigger ensure_shared_audio_player after insert on public.calendars
for each row execute function public.ensure_shared_audio_player();

insert into public.shared_audio_playlists (calendar_id, name, is_queue, created_by)
select calendar.id, 'Coda condivisa', true, calendar.created_by
from public.calendars calendar
where not exists (
  select 1 from public.shared_audio_playlists playlist
  where playlist.calendar_id = calendar.id and playlist.is_queue
);
insert into public.shared_audio_player_settings (calendar_id, active_playlist_id)
select calendar.id, queue.id
from public.calendars calendar
join public.shared_audio_playlists queue on queue.calendar_id = calendar.id and queue.is_queue
on conflict (calendar_id) do nothing;
update public.shared_audio_player_settings settings
set active_playlist_id = queue.id
from public.shared_audio_playlists queue
where queue.calendar_id = settings.calendar_id
  and queue.is_queue
  and not exists (
    select 1 from public.shared_audio_playlists active
    where active.id = settings.active_playlist_id
      and active.calendar_id = settings.calendar_id
  );

create or replace function public.shared_stream_calendar_id(p_topic text)
returns uuid language sql immutable set search_path = ''
as $$
  select case when p_topic ~* '^shared-stream:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_topic, ':', 2)::uuid else null end;
$$;
revoke all on function public.shared_stream_calendar_id(text) from public;
grant execute on function public.shared_stream_calendar_id(text) to authenticated;

drop policy if exists "Calendar members receive shared stream signals" on realtime.messages;
create policy "Calendar members receive shared stream signals" on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.is_current_user_calendar_member(public.shared_stream_calendar_id((select realtime.topic())))
);
drop policy if exists "Calendar members send shared stream signals" on realtime.messages;
create policy "Calendar members send shared stream signals" on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and public.is_current_user_calendar_member(public.shared_stream_calendar_id((select realtime.topic())))
);

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
  if not public.is_current_user_calendar_member(p_calendar_id) then raise exception 'Accesso allo spazio non autorizzato.'; end if;
  if p_position is null or p_position < 0 or p_position > 604800
    or p_position::text in ('NaN', 'Infinity', '-Infinity') or p_playing is null
    or not public.is_shared_audio(p_calendar_id, p_object_path) then
    raise exception 'File audio o posizione di riproduzione non validi.';
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
  if not public.is_current_user_calendar_member(p_calendar_id) then raise exception 'Accesso allo spazio non autorizzato.'; end if;
  delete from public.shared_playback where calendar_id = p_calendar_id and object_path = p_object_path;
end;
$$;

create or replace function public.advance_shared_playback(
  p_calendar_id uuid, p_current_path text, p_direction integer
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  active_playlist uuid;
  shuffle_enabled boolean;
  repeat_setting text;
  current_position integer;
  next_path text;
begin
  if not public.is_current_user_calendar_member(p_calendar_id) then
    raise exception 'Accesso allo spazio non autorizzato.';
  end if;
  if p_direction is null or p_direction not in (-1, 1) then raise exception 'Direzione di riproduzione non valida.'; end if;
  if not exists (
    select 1 from public.shared_playback
    where calendar_id = p_calendar_id and object_path = p_current_path
  ) then return; end if;

  select active_playlist_id, shuffle, repeat_mode into active_playlist, shuffle_enabled, repeat_setting
  from public.shared_audio_player_settings where calendar_id = p_calendar_id for update;
  if active_playlist is null then raise exception 'La playlist condivisa non è configurata.'; end if;

  if repeat_setting = 'one' and p_direction = 1 then
    update public.shared_playback set position_seconds = 0, playing = true, updated_at = clock_timestamp()
    where calendar_id = p_calendar_id and object_path = p_current_path;
    return;
  end if;

  select position into current_position
  from public.shared_audio_playlist_items
  where playlist_id = active_playlist and object_path = p_current_path;

  if shuffle_enabled and p_direction = 1 then
    select object_path into next_path
    from public.shared_audio_playlist_items
    where playlist_id = active_playlist and object_path <> p_current_path
    order by random() limit 1;
  elsif p_direction = 1 then
    select object_path into next_path
    from public.shared_audio_playlist_items
    where playlist_id = active_playlist and position > coalesce(current_position, -1)
    order by position, added_at, object_path limit 1;
  else
    select object_path into next_path
    from public.shared_audio_playlist_items
    where playlist_id = active_playlist and position < coalesce(current_position, 2147483647)
    order by position desc, added_at desc, object_path desc limit 1;
  end if;

  if next_path is null and repeat_setting = 'all' then
    if p_direction = 1 then
      select object_path into next_path from public.shared_audio_playlist_items
      where playlist_id = active_playlist order by position, added_at, object_path limit 1;
    else
      select object_path into next_path from public.shared_audio_playlist_items
      where playlist_id = active_playlist order by position desc, added_at desc, object_path desc limit 1;
    end if;
  end if;

  if next_path is null then
    update public.shared_playback set position_seconds = 0, playing = false, updated_at = clock_timestamp()
    where calendar_id = p_calendar_id;
  else
    update public.shared_playback set object_path = next_path, position_seconds = 0,
      playing = true, updated_at = clock_timestamp()
    where calendar_id = p_calendar_id;
  end if;
end;
$$;

create or replace function public.remove_shared_audio_path(p_calendar_id uuid, p_object_path text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  active_playlist uuid;
  current_position integer;
  next_path text;
begin
  if not public.can_edit_calendar(p_calendar_id)
    or public.shared_object_calendar_id(p_object_path) is distinct from p_calendar_id then
    raise exception 'Solo un editor può rimuovere file audio condivisi.';
  end if;
  select active_playlist_id into active_playlist
  from public.shared_audio_player_settings where calendar_id = p_calendar_id for update;
  select position into current_position from public.shared_audio_playlist_items
  where playlist_id = active_playlist and object_path = p_object_path;
  if exists (select 1 from public.shared_playback where calendar_id = p_calendar_id and object_path = p_object_path) then
    select object_path into next_path from public.shared_audio_playlist_items
    where playlist_id = active_playlist and object_path <> p_object_path
      and position > coalesce(current_position, -1)
    order by position, added_at, object_path limit 1;
    if next_path is null then
      select object_path into next_path from public.shared_audio_playlist_items
      where playlist_id = active_playlist and object_path <> p_object_path
      order by position, added_at, object_path limit 1;
    end if;
    if next_path is null then
      delete from public.shared_playback where calendar_id = p_calendar_id and object_path = p_object_path;
    else
      update public.shared_playback set object_path = next_path, position_seconds = 0,
        playing = false, updated_at = clock_timestamp()
      where calendar_id = p_calendar_id and object_path = p_object_path;
    end if;
  end if;
  delete from public.shared_audio_playlist_items item
  using public.shared_audio_playlists playlist
  where item.playlist_id = playlist.id and playlist.calendar_id = p_calendar_id
    and item.object_path = p_object_path;
end;
$$;
revoke all on function public.get_shared_playback(uuid) from public;
revoke all on function public.set_shared_playback(uuid, text, double precision, boolean) from public;
revoke all on function public.clear_shared_playback(uuid, text) from public;
revoke all on function public.advance_shared_playback(uuid, text, integer) from public;
revoke all on function public.remove_shared_audio_path(uuid, text) from public;
grant execute on function public.get_shared_playback(uuid) to authenticated;
grant execute on function public.set_shared_playback(uuid, text, double precision, boolean) to authenticated;
grant execute on function public.clear_shared_playback(uuid, text) to authenticated;
grant execute on function public.advance_shared_playback(uuid, text, integer) to authenticated;
grant execute on function public.remove_shared_audio_path(uuid, text) to authenticated;

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
    update public.calendar_items
      set visible_to = array_remove(visible_to, p_user_id),
          editable_by = array_remove(editable_by, p_user_id)
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

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bio text not null default '' check (char_length(bio) <= 140),
  avatar jsonb check (
    avatar is null
    or (jsonb_typeof(avatar) = 'object' and octet_length(avatar::text) <= 2000)
  ),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
revoke all on table public.user_profiles from anon, authenticated;
grant select, insert, update on table public.user_profiles to authenticated;

drop policy if exists "Members read profiles of people in their calendars" on public.user_profiles;
create policy "Members read profiles of people in their calendars" on public.user_profiles for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.calendar_members as me
    join public.calendar_members as other on other.calendar_id = me.calendar_id
    where me.user_id = (select auth.uid())
      and other.user_id = user_profiles.user_id
  )
);

drop policy if exists "Users insert their own profile" on public.user_profiles;
create policy "Users insert their own profile" on public.user_profiles for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users update their own profile" on public.user_profiles;
create policy "Users update their own profile" on public.user_profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

alter table public.calendars
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.calendar_members
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.calendar_items
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.watch_sessions
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.watch_participants
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.watch_items
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.watch_votes
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.shared_playback
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.user_profiles
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.calendar_view_preferences
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.shared_audio_playlists
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.shared_audio_playlist_items
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.shared_audio_favorites
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();
alter table public.shared_audio_player_settings
  add column if not exists sync_updated_at timestamptz not null default clock_timestamp();

create table if not exists public.sync_tombstones (
  table_name text not null check (table_name in (
    'calendars', 'calendar_members', 'calendar_items', 'watch_sessions',
    'watch_participants', 'watch_items', 'watch_votes', 'shared_playback',
    'user_profiles', 'calendar_view_preferences', 'shared_audio_playlists',
    'shared_audio_playlist_items', 'shared_audio_favorites', 'shared_audio_player_settings'
  )),
  row_key jsonb not null,
  calendar_id uuid,
  user_id uuid,
  deleted_at timestamptz not null default clock_timestamp(),
  primary key (table_name, row_key)
);
alter table public.sync_tombstones drop constraint if exists sync_tombstones_table_name_check;
alter table public.sync_tombstones add constraint sync_tombstones_table_name_check
  check (table_name in (
    'calendars', 'calendar_members', 'calendar_items', 'watch_sessions',
    'watch_participants', 'watch_items', 'watch_votes', 'shared_playback',
    'user_profiles', 'calendar_view_preferences', 'shared_audio_playlists',
    'shared_audio_playlist_items', 'shared_audio_favorites', 'shared_audio_player_settings'
  ));

alter table public.sync_tombstones enable row level security;
revoke all on public.sync_tombstones from anon, authenticated;
grant select on public.sync_tombstones to authenticated;
drop policy if exists "Members read visible sync tombstones" on public.sync_tombstones;
create policy "Members read visible sync tombstones" on public.sync_tombstones for select to authenticated
using (
  user_id = (select auth.uid())
  or (calendar_id is not null and public.is_current_user_calendar_member(calendar_id))
);

create or replace function public.touch_sync_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_setting('app.syncing', true) is distinct from 'true' then
    new.sync_updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function public.record_sync_tombstone()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  old_row jsonb := to_jsonb(old);
  row_key_value jsonb;
  affected_calendar uuid;
  affected_user uuid;
begin
  row_key_value := case tg_table_name
    when 'calendars' then jsonb_build_object('id', old_row->'id')
    when 'calendar_members' then jsonb_build_object('calendar_id', old_row->'calendar_id', 'user_id', old_row->'user_id')
    when 'calendar_items' then jsonb_build_object('id', old_row->'id')
    when 'watch_sessions' then jsonb_build_object('id', old_row->'id')
    when 'watch_participants' then jsonb_build_object('session_id', old_row->'session_id', 'user_id', old_row->'user_id')
    when 'watch_items' then jsonb_build_object('id', old_row->'id')
    when 'watch_votes' then jsonb_build_object('session_id', old_row->'session_id', 'item_id', old_row->'item_id', 'user_id', old_row->'user_id')
    when 'shared_playback' then jsonb_build_object('calendar_id', old_row->'calendar_id')
    when 'user_profiles' then jsonb_build_object('user_id', old_row->'user_id')
    when 'calendar_view_preferences' then jsonb_build_object('calendar_id', old_row->'calendar_id', 'user_id', old_row->'user_id')
    when 'shared_audio_playlists' then jsonb_build_object('id', old_row->'id')
    when 'shared_audio_playlist_items' then jsonb_build_object('playlist_id', old_row->'playlist_id', 'object_path', old_row->'object_path')
    when 'shared_audio_favorites' then jsonb_build_object('calendar_id', old_row->'calendar_id', 'user_id', old_row->'user_id', 'object_path', old_row->'object_path')
    when 'shared_audio_player_settings' then jsonb_build_object('calendar_id', old_row->'calendar_id')
  end;
  affected_calendar := case when tg_table_name in ('calendar_view_preferences', 'shared_audio_favorites') then null
    else coalesce(nullif(old_row->>'calendar_id', '')::uuid,
      case when tg_table_name = 'calendars' then nullif(old_row->>'id', '')::uuid end)
  end;
  if affected_calendar is null and tg_table_name in ('watch_votes') then
    select calendar_id into affected_calendar from public.watch_sessions
    where id = (old_row->>'session_id')::uuid;
  end if;
  affected_user := coalesce(
    nullif(old_row->>'user_id', '')::uuid,
    nullif(old_row->>'created_by', '')::uuid,
    nullif(old_row->>'added_by', '')::uuid
  );
  insert into public.sync_tombstones (table_name, row_key, calendar_id, user_id, deleted_at)
  values (tg_table_name, row_key_value, affected_calendar, affected_user, clock_timestamp())
  on conflict (table_name, row_key) do update set
    calendar_id = excluded.calendar_id,
    user_id = excluded.user_id,
    deleted_at = excluded.deleted_at;
  return old;
end;
$$;
revoke all on function public.record_sync_tombstone() from public;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'calendars', 'calendar_members', 'calendar_items', 'watch_sessions',
    'watch_participants', 'watch_items', 'watch_votes', 'shared_playback',
    'user_profiles', 'calendar_view_preferences', 'shared_audio_playlists',
    'shared_audio_playlist_items', 'shared_audio_favorites', 'shared_audio_player_settings'
  ] loop
    execute format('drop trigger if exists touch_sync_updated_at on public.%I', table_name);
    execute format(
      'create trigger touch_sync_updated_at before insert or update on public.%I for each row execute function public.touch_sync_updated_at()',
      table_name
    );
    execute format('drop trigger if exists record_sync_tombstone on public.%I', table_name);
    execute format(
      'create trigger record_sync_tombstone after delete on public.%I for each row execute function public.record_sync_tombstone()',
      table_name
    );
    execute format('grant select (sync_updated_at) on public.%I to authenticated', table_name);
  end loop;
end;
$$;

commit;
