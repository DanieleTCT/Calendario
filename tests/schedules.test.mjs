import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleHandler } from '../api/schedules.js'

const userId = '00000000-0000-4000-8000-000000000001'
const calendarId = '10000000-0000-4000-8000-000000000001'
const sourceId = '20000000-0000-4000-8000-000000000001'
const config = {
  supabaseUrl: 'https://supabase.example.test',
  supabaseKey: 'anon-key',
  now: '2026-11-23T12:00:00.000Z',
}
const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:course-1@example.test
DTSTART:20270104T090000Z
DTEND:20270104T110000Z
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Analisi matematica
LOCATION:Aula 1
DESCRIPTION:Lezione settimanale
END:VEVENT
END:VCALENDAR`

async function request(body, fetcher, options = {}) {
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { this.body = JSON.parse(value) },
  }
  await scheduleHandler({
    method: options.method || 'POST',
    headers: options.headers || { authorization: 'Bearer session-token' },
    body,
  }, res, options.config || config, fetcher)
  return res
}

function scheduledFetch(feedUrl, overrides = {}) {
  const calls = []
  const fetcher = async (input, options) => {
    const url = new URL(String(input))
    calls.push({ url, options })
    if (url.pathname === '/auth/v1/user') {
      return Response.json({ id: userId })
    }
    if (url.pathname === '/rest/v1/calendar_members') {
      return Response.json([{ role: 'owner', can_edit: true }])
    }
    if (url.pathname === '/rest/v1/calendar_schedule_sources') {
      return Response.json([{ provider: 'polito', feed_url: feedUrl }])
    }
    if (url.href === feedUrl) {
      return overrides.feedResponse ?? new Response(ical, { headers: { 'content-type': 'text/calendar' } })
    }
    throw new Error('Richiesta inattesa.')
  }
  return { calls, fetcher }
}

test('sincronizzazione richiede sessione autenticata', async () => {
  let fetchCount = 0
  const result = await request(
    { calendarId, sourceId },
    async () => { fetchCount += 1; return Response.json({}) },
    { headers: {} },
  )
  assert.equal(result.statusCode, 401)
  assert.equal(fetchCount, 0)
})

test('sincronizzazione rifiuta feed fuori dai domini degli atenei', async () => {
  const { calls, fetcher } = scheduledFetch('https://example.test/secret.ics')
  const result = await request({ calendarId, sourceId }, fetcher)
  assert.equal(result.statusCode, 400)
  assert.match(result.body.error, /link iCal HTTPS ufficiale/)
  assert.equal(calls.some(({ url }) => url.hostname === 'example.test'), false)
})

test('sincronizzazione espande le ricorrenze iCalendar e restituisce eventi normalizzati', async () => {
  const feedUrl = 'https://my.polito.it/calendar.ics?token=private'
  const { calls, fetcher } = scheduledFetch(feedUrl)
  const result = await request({ calendarId, sourceId }, fetcher)
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.provider, 'polito')
  assert.equal(result.body.events.length, 3)
  assert.equal(result.body.events[0].title, 'Analisi matematica')
  assert.equal(result.body.events[0].description, 'Lezione settimanale\nLuogo: Aula 1')
  assert.match(result.body.events[0].uid, /^[0-9a-f]{64}$/)
  assert.equal(result.body.events[0].all_day, false)
  assert.equal(calls.at(-1).options.redirect, 'manual')
  assert.doesNotMatch(JSON.stringify(result.body), /token=private/)
})
