import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const owner = '00000000-0000-4000-8000-000000000001'
const editor = '00000000-0000-4000-8000-000000000002'
const viewer = '00000000-0000-4000-8000-000000000003'
const outsider = '00000000-0000-4000-8000-000000000004'
const calendar = '10000000-0000-4000-8000-000000000001'
const item = '20000000-0000-4000-8000-000000000001'
const session = '30000000-0000-4000-8000-000000000001'
const choice = '40000000-0000-4000-8000-000000000001'
const file = `${calendar}/audio.mp3`

test('schema idempotente e autorizzazioni per calendari, file e Watch-decider', async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
      create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select, insert, delete on storage.objects to authenticated;
      create publication supabase_realtime;
    `)
    const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
    await db.exec(schema)
    await db.exec(schema)
    for (const [id, email] of [[owner, 'owner@example.test'], [editor, 'editor@example.test'], [viewer, 'viewer@example.test'], [outsider, 'other@example.test']]) {
      await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
    }

    async function as(id) {
      await db.exec('reset role')
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
      await db.exec('set role authenticated')
    }
    async function rows(sql, params = []) {
      return (await db.query(sql, params)).rows
    }

    await as(owner)
    await db.query('insert into public.calendars (id, name, created_by) values ($1, $2, $3)', [calendar, 'Famiglia', owner])
    const code = (await rows('select public.get_calendar_invite_code($1) as code', [calendar]))[0].code
    await as(editor)
    await db.query('select public.join_calendar_with_code($1)', [code])
    await as(viewer)
    await db.query('select public.join_calendar_with_code($1)', [code])
    await assert.rejects(() => db.query('select public.get_calendar_invite_code($1)', [calendar]))
    await assert.rejects(() => db.query('select invite_code from public.calendars where id = $1', [calendar]))
    await assert.rejects(() => db.query(
      'insert into public.calendar_items (calendar_id, title, item_type, starts_at, ends_at, created_by) values ($1, $2, $3, now(), now(), $4)',
      [calendar, 'Vietato', 'event', viewer],
    ))
    await as(owner)
    await db.query('select public.manage_calendar_member($1, $2, true, false)', [calendar, editor])
    await db.query(`insert into public.calendar_items
      (id, calendar_id, title, item_type, starts_at, ends_at, created_by, visibility, visible_to)
      values ($1, $2, 'Privato', 'event', now(), now(), $3, 'selected', array[$4::uuid])`,
    [item, calendar, owner, editor])
    await db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', ['family-shared', file])
    await db.query('insert into public.watch_sessions (id, calendar_id, name, created_by) values ($1, $2, $3, $4)', [session, calendar, 'Serata', owner])
    await db.query('insert into public.watch_items (id, session_id, calendar_id, title, category, created_by) values ($1, $2, $3, $4, $5, $6)', [choice, session, calendar, 'Titolo', 'film', owner])

    await as(viewer)
    assert.equal((await rows('select id from public.calendar_items')).length, 0)
    assert.equal((await rows('select name from storage.objects')).length, 1)
    await assert.rejects(() => db.query('insert into public.watch_items (session_id, calendar_id, title, category, created_by) values ($1, $2, $3, $4, $5)', [session, calendar, 'No', 'film', viewer]))
    await assert.rejects(() => db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', ['family-shared', `${calendar}/vietato`]))
    await assert.rejects(() => db.query('select public.set_shared_playback($1, $2, 0, true)', [calendar, file]))
    await db.query('insert into public.watch_participants (session_id, calendar_id, user_id) values ($1, $2, $3)', [session, calendar, viewer])
    await db.query('insert into public.watch_votes (session_id, item_id, user_id, liked, rating) values ($1, $2, $3, true, 4)', [session, choice, viewer])
    await assert.rejects(() => db.query('update public.watch_votes set rating = 6 where user_id = $1', [viewer]))

    await as(editor)
    assert.equal((await rows('select id from public.calendar_items')).length, 1)
    assert.equal((await rows('update public.calendar_items set title = $1 where id = $2 returning id', ['Aggiornato', item])).length, 1)
    await assert.rejects(() => db.query('update public.calendar_items set created_by = $1 where id = $2', [editor, item]))
    await db.query('select public.set_shared_playback($1, $2, 12, true)', [calendar, file])
    assert.equal((await rows('select * from public.get_shared_playback($1)', [calendar]))[0].playing, true)
    await assert.rejects(() => db.query('select public.set_shared_playback($1, $2, -1, true)', [calendar, file]))
    assert.equal((await rows('update public.watch_votes set liked = false where user_id = $1 returning item_id', [viewer])).length, 0)

    await as(outsider)
    assert.equal((await rows('select id from public.watch_sessions')).length, 0)
    assert.equal((await rows('select name from storage.objects')).length, 0)
    await assert.rejects(() => db.query('select public.get_shared_playback($1)', [calendar]))
    await assert.rejects(() => db.query('insert into public.watch_participants (session_id, calendar_id, user_id) values ($1, $2, $3)', [session, calendar, outsider]))

    await as(owner)
    await db.query('select public.manage_calendar_member($1, $2, false, true)', [calendar, viewer])
    const newCode = (await rows('select public.get_calendar_invite_code($1) as code', [calendar]))[0].code
    assert.notEqual(newCode, code)
    assert.equal((await rows('select user_id from public.watch_participants where user_id = $1', [viewer])).length, 0)
    assert.equal((await rows('select user_id from public.watch_votes where user_id = $1', [viewer])).length, 0)
    await as(viewer)
    assert.equal((await rows('select name from storage.objects')).length, 0)
    await assert.rejects(() => db.query('select public.join_calendar_with_code($1)', [code]))
  } finally {
    await db.close()
  }
})
