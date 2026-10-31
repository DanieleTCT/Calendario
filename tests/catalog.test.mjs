import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogHandler } from '../api/catalog.js'

const config = { token: 'server-secret', supabaseUrl: 'https://auth.example.test', supabaseKey: 'anon-key' }

async function request(url, options = {}) {
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(body) { this.body = JSON.parse(body) },
  }
  await catalogHandler({ method: options.method || 'GET', url, headers: options.headers || {} }, res, options.config || config, options.fetcher)
  return res
}

test('catalogo richiede configurazione e utente autenticato', async () => {
  assert.equal((await request('?query=ciao', { config: {} })).statusCode, 503)
  assert.equal((await request('?query=ciao')).statusCode, 401)
  assert.equal((await request('?query=x', { headers: { authorization: 'Bearer session' } })).statusCode, 400)
  const invalid = await request('?query=ciao', {
    headers: { authorization: 'Bearer session' },
    fetcher: async () => ({ status: 401, ok: false }),
  })
  assert.equal(invalid.statusCode, 401)
})

test('catalogo restituisce solo film e serie senza esporre il token', async () => {
  const calls = []
  const response = await request('?query=film&page=2', {
    headers: { authorization: 'Bearer session' },
    fetcher: async (url, options) => {
      calls.push({ url: String(url), headers: options.headers })
      if (calls.length === 1) return { status: 200, ok: true }
      return { status: 200, ok: true, json: async () => ({
        total_pages: 3,
        results: [
          { id: 8, media_type: 'movie', title: 'Film', poster_path: '/cover.jpg', release_date: '2025-01-02', genre_ids: [28, 12] },
          { id: 9, media_type: 'tv', name: 'Serie', poster_path: '//evil.example/image', first_air_date: '2024-01-02', genre_ids: [10759] },
          { id: 10, media_type: 'person', name: 'Persona' },
        ],
      }) }
    },
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.results.length, 2)
  assert.equal(response.body.results[0].poster_path, '/cover.jpg')
  assert.deepEqual(response.body.results[0].genre_ids, [28, 12])
  assert.equal(response.body.results[1].poster_path, null)
  assert.equal(response.body.results[1].category, 'serie')
  assert.equal(response.body.page, 2)
  assert.match(calls[1].url, /\/search\/multi\?/)
  assert.equal(calls[1].headers.Authorization, 'Bearer server-secret')
  assert.doesNotMatch(JSON.stringify(response.body), /server-secret|Bearer session/)
})

test('catalogo supporta ricerca per categoria, anno e genere anche senza titolo', async () => {
  const calls = []
  const response = await request('?type=film&year=1999&genre=28&page=2', {
    headers: { authorization: 'Bearer session' },
    fetcher: async (url) => {
      calls.push(String(url))
      if (calls.length === 1) return { status: 200, ok: true }
      return { status: 200, ok: true, json: async () => ({
        total_pages: 4,
        results: [
          { id: 11, title: 'Azione', poster_path: '/action.jpg', release_date: '1999-01-01', genre_ids: [28] },
          { id: 12, title: 'Commedia', poster_path: null, release_date: '1999-01-01', genre_ids: [35] },
        ],
      }) }
    },
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.results.length, 1)
  assert.equal(response.body.results[0].title, 'Azione')
  assert.match(calls[1], /\/discover\/movie\?/)
  assert.match(calls[1], /primary_release_year=1999/)
  assert.match(calls[1], /with_genres=28/)
})
