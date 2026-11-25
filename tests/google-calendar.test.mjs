import { test } from 'node:test'
import assert from 'node:assert/strict'
import { googleCalendarHandler } from '../api/google-calendar.js'

const userId = '00000000-0000-4000-8000-000000000001'
const calendarId = '10000000-0000-4000-8000-000000000001'
const encryptionKey = Buffer.alloc(32, 7).toString('base64')
const config = {
  supabaseUrl: 'https://supabase.example.test',
  supabaseKey: 'anon-key',
  serviceRoleKey: 'server-only-service-role-key',
  googleClientId: 'google-client-id',
  googleClientSecret: 'google-client-secret',
  googleRedirectUri: 'https://app.example.test/api/google-calendar?action=callback',
  oauthStateSecret: 'a-state-secret-that-is-long-enough-to-sign-oauth-state',
  tokenEncryptionKey: encryptionKey,
  appUrl: 'https://app.example.test',
}

async function request(action, fetcher, options = {}) {
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { this.body = value ? JSON.parse(value) : null },
  }
  await googleCalendarHandler({
    method: options.method ?? 'POST',
    url: options.url ?? `/api/google-calendar?action=${action}`,
    headers: options.headers ?? { authorization: 'Bearer session-token' },
    body: options.body ?? { calendarId },
  }, res, options.config ?? config, fetcher)
  return res
}

test('Google Calendar richiede autenticazione Supabase e limita OAuth al permesso di sola lettura', async () => {
  const missingConfig = await request('calendars', async () => Response.json({}), {
    method: 'GET',
    url: `/api/google-calendar?action=calendars&calendarId=${calendarId}`,
    config: { supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey },
  })
  assert.equal(missingConfig.statusCode, 503)
  assert.equal(missingConfig.body.code, 'GOOGLE_CALENDAR_NOT_CONFIGURED')
  assert.match(missingConfig.body.error, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(missingConfig.body.error, /GOOGLE_OAUTH_CLIENT_ID/)

  let upstreamCalls = 0
  const unauthorized = await request('authorize', async () => {
    upstreamCalls += 1
    return Response.json({})
  }, { headers: {} })
  assert.equal(unauthorized.statusCode, 401)
  assert.equal(upstreamCalls, 0)

  const fetcher = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/auth/v1/user') return Response.json({ id: userId })
    if (url.pathname === '/rest/v1/calendar_members') return Response.json([{ calendar_id: calendarId }])
    throw new Error(`Richiesta inattesa: ${url.href}`)
  }
  const result = await request('authorize', fetcher)
  assert.equal(result.statusCode, 200)
  const authorizationUrl = new URL(result.body.authorizationUrl)
  assert.equal(authorizationUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.readonly')
  assert.equal(authorizationUrl.searchParams.get('access_type'), 'offline')
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code')
})

test('OAuth archivia il refresh token cifrato e la sincronizzazione converte eventi e cancellazioni', async () => {
  let connection = null
  let savedEvents = []
  let deletedEventQuery = ''
  let syncTokenSaved = null
  let expireNextSyncToken = false
  let incrementalRequestSeen = false
  const source = {
    calendar_id: calendarId,
    google_calendar_id: 'primary',
    summary: 'Personale',
    time_zone: 'Europe/Rome',
    sync_token: null,
  }
  const fetcher = async (input, options = {}) => {
    const url = new URL(String(input))
    if (url.pathname === '/auth/v1/user') return Response.json({ id: userId })
    if (url.pathname === '/rest/v1/calendar_members') return Response.json([{ calendar_id: calendarId }])
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const body = new URLSearchParams(options.body)
      if (body.get('grant_type') === 'authorization_code') {
        return Response.json({ access_token: 'access-token', refresh_token: 'sensitive-refresh-token', expires_in: 1 })
      }
      assert.equal(body.get('grant_type'), 'refresh_token')
      return Response.json({ access_token: 'refreshed-access-token', expires_in: 3600 })
    }
    if (url.pathname === '/rest/v1/google_calendar_connections' && options.method === 'POST') {
      connection = JSON.parse(options.body)[0] ?? JSON.parse(options.body)
      return Response.json([])
    }
    if (url.pathname === '/rest/v1/google_calendar_connections' && options.method === 'PATCH') {
      connection = { ...connection, ...JSON.parse(options.body) }
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/rest/v1/google_calendar_connections' && options.method !== 'DELETE') {
      return Response.json(connection ? [connection] : [])
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/events')) {
      assert.equal(options.headers.Authorization, 'Bearer refreshed-access-token')
      assert.equal(url.searchParams.get('singleEvents'), 'true')
      if (url.searchParams.has('syncToken') && expireNextSyncToken) {
        expireNextSyncToken = false
        incrementalRequestSeen = true
        return new Response(JSON.stringify({ error: { message: 'Sync token expired' } }), { status: 410 })
      }
      return Response.json({
        items: [
          {
            id: 'timed-event',
            summary: 'Riunione',
            description: 'Pianificazione',
            location: 'Torino',
            start: { dateTime: '2026-11-25T10:00:00+01:00' },
            end: { dateTime: '2026-11-25T11:00:00+01:00' },
            eventType: 'default',
            htmlLink: 'https://www.google.com/calendar/event?eid=abc',
          },
          {
            id: 'all-day-event',
            summary: 'Festa',
            start: { date: '2026-11-26' },
            end: { date: '2026-11-27' },
            eventType: 'birthday',
          },
          { id: 'cancelled-event', status: 'cancelled' },
        ],
        nextSyncToken: incrementalRequestSeen ? 'replacement-sync-token' : 'next-sync-token',
      })
    }
    if (url.pathname === '/rest/v1/google_calendar_sources' && options.method === 'GET') return Response.json([source])
    if (url.pathname === '/rest/v1/google_calendar_events' && options.method === 'POST') {
      savedEvents = JSON.parse(options.body)
      return Response.json([])
    }
    if (url.pathname === '/rest/v1/google_calendar_events' && options.method === 'DELETE') {
      deletedEventQuery = url.search
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/rest/v1/google_calendar_sources' && options.method === 'PATCH') {
      syncTokenSaved = JSON.parse(options.body).sync_token
      return new Response(null, { status: 204 })
    }
    throw new Error(`Richiesta inattesa: ${options.method ?? 'GET'} ${url.href}`)
  }

  const authorized = await request('authorize', fetcher)
  const state = new URL(authorized.body.authorizationUrl).searchParams.get('state')
  const callback = await request('callback', fetcher, {
    method: 'GET',
    url: `/api/google-calendar?action=callback&code=one-time-code&state=${encodeURIComponent(state)}`,
  })
  assert.equal(callback.statusCode, 303)
  assert.equal(callback.headers.Location, `https://app.example.test/?google_calendar=connected&calendar_id=${calendarId}`)
  assert.ok(connection.refresh_token_encrypted)
  assert.ok(connection.refresh_token_encrypted.startsWith('v1:'))
  assert.doesNotMatch(connection.refresh_token_encrypted, /sensitive-refresh-token/)

  const synced = await request('sync', fetcher)
  assert.equal(synced.statusCode, 200)
  assert.deepEqual(synced.body, { connected: true, updated: 3, calendars: 1 })
  assert.equal(savedEvents.length, 2)
  const timed = savedEvents.find((event) => event.event_id === 'timed-event')
  assert.equal(timed.title, 'Riunione')
  assert.equal(timed.starts_at, '2026-11-25T09:00:00.000Z')
  assert.equal(timed.description, 'Pianificazione\nLuogo: Torino')
  assert.deepEqual(timed.tags, ['Google Calendar', 'Personale'])
  assert.equal(timed.source_url, 'https://www.google.com/calendar/event?eid=abc')
  const allDay = savedEvents.find((event) => event.event_id === 'all-day-event')
  assert.equal(allDay.all_day, true)
  assert.equal(allDay.start_date, '2026-11-26')
  assert.equal(allDay.ends_at, '2026-11-27T00:00:00.000Z')
  assert.ok(allDay.tags.includes('Compleanno'))
  assert.match(deletedEventQuery, /cancelled-event/)
  assert.equal(syncTokenSaved, 'next-sync-token')

  source.sync_token = syncTokenSaved
  expireNextSyncToken = true
  const recovered = await request('sync', fetcher)
  assert.equal(recovered.statusCode, 200)
  assert.equal(recovered.body.updated, 3)
  assert.equal(incrementalRequestSeen, true)
  assert.match(deletedEventQuery, /google_calendar_id/)
  assert.equal(syncTokenSaved, 'replacement-sync-token')
})
