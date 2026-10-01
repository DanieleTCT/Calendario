// Telegram bot (locale, long-polling) per Sito-calendario.
// Riusa le API esistenti: POST /api/ai/chat (SSE), GET /api/ai/actions, POST /api/ai/actions/:id/confirm.
// Zero nuove dipendenze: solo fetch nativo (Node 18+).
// Avvio:  TELEGRAM_BOT_TOKEN=xxx  API_BASE_URL=http://localhost:3000/api  node scripts/telegram-bot.mjs
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const API = (process.env.API_BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const ALLOW = (process.env.TELEGRAM_ALLOWED_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const POLL_TIMEOUT = 25;
if (!TOKEN) { console.error('Manca TELEGRAM_BOT_TOKEN. Vedi TELEGRAM-SETUP.md'); process.exit(1); }
const TG = `https://api.telegram.org/bot${TOKEN}`;
let offset = 0;
const convByChat = new Map();
// Ultimo id di pending ricevuto per chat: serve per approvare anche solo con testo.
const lastPendingByChat = new Map();
console.log(`[tg] API=${API} allow=${ALLOW.length ? ALLOW.join(',') : 'tutti'}`);
async function tg(method, body) {
  const r = await fetch(`${TG}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  // Errore Telegram silenzioso = messaggio/pulsante che non arriva mai: logghiamolo.
  if (j && j.ok === false) console.error(`[tg] ${method} failed:`, JSON.stringify(j).slice(0, 300));
  return j;
}

function sanitizeText(raw) {
  let s = String(raw || '');
  // Rimuovi bold/italic markdown come **testo** o *testo*
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  // Rimuovi backticks `codice` o ```
  s = s.replace(/```[a-zA-Z]*\n?/g, '');
  s = s.replace(/`([^`]+)`/g, '$1');
  // Rimuovi header markdown tipo # o ##
  s = s.replace(/^#{1,4}\s+/gm, '');
  return s.trim();
}

async function sendLong(chatId, text, extra = {}) {
  const chunks = [];
  let t = sanitizeText(text) || '(risposta vuota)';
  while (t.length > 4000) { let k = t.lastIndexOf('\n', 4000); if (k < 500) k = 4000; chunks.push(t.slice(0, k)); t = t.slice(k); }
  chunks.push(t);
  for (const c of chunks) await tg('sendMessage', { chat_id: chatId, text: c, ...extra });
}

async function askAI(chatId, text) {
  const convId = convByChat.get(String(chatId)) || undefined;
  const resp = await fetch(`${API}/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: convId, message: text }) });
  const raw = await resp.text();
  if (!resp.ok) throw new Error(raw.slice(0, 200));
  let full = ''; let conv = convId; const pendings = [];
  for (const part of raw.split(/\r?\n\r?\n/)) {
    const line = part.split(/\r?\n/).find((l) => l.startsWith('data:'));
    if (!line) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      if (ev.type === 'meta' && ev.conversationId) conv = ev.conversationId;
      if (ev.type === 'chunk') full += ev.content;
      if (ev.type === 'pending' && ev.pending) pendings.push(ev.pending);
      if (ev.type === 'done' && ev.conversationId) conv = ev.conversationId;
      if (ev.type === 'error') throw new Error(ev.error);
    } catch (e) { if (e.message && !e.message.startsWith('{')) throw e; }
  }
  if (conv) convByChat.set(String(chatId), conv);
  if (pendings.length) lastPendingByChat.set(String(chatId), pendings[pendings.length - 1].id);
  // Difesa: se il testo promette una richiesta ma non e arrivata nessuna pending,
  // avvisiamo altrimenti l'utente cercherebbe un pulsante inesistente.
  if (!pendings.length && /ho preparat|premi (?:il pulsante )?approva/i.test(full)) {
    full += '\n\nNessuna richiesta e stata creata: il modello non ha eseguito la chiamata. Scrivi /azioni per vedere le richieste in attesa oppure riprova riformulando.';
  }
  return { full: full || '(nessuna risposta)', pendings };
}

// Id della pending da confermare: prima l'ultima ricevuta in questa chat, poi la piu recente.
async function resolvePendingId(chatId) {
  try {
    const r = await fetch(`${API}/ai/actions`);
    const list = await r.json();
    if (!Array.isArray(list) || !list.length) return null;
    const remembered = lastPendingByChat.get(String(chatId));
    if (remembered && list.some((p) => p.id === remembered)) return remembered;
    return list[list.length - 1].id;
  } catch { return null; }
}

async function confirmAction(id, approved) {
  const r = await fetch(`${API}/ai/actions/${id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved }) });
  return r.json();
}

function pendingKeyboard(p) {
  return { inline_keyboard: [[{ text: '✅ Approva', callback_data: `ok:${p.id}` }, { text: '❌ Rifiuta', callback_data: `no:${p.id}` }]] };
}

const HELP = `Ciao! Sono il tuo calendario AI.
Scrivi pure in italiano, es: "cosa ho domani?" o "crea task comprare latte domani".
Comandi:
/oggi - cosa hai oggi
/settimana - prossimi 7 giorni
/cerca <parola> - ricerca
/libero <AAAA-MM-GG> - slot liberi
/azioni - richieste in attesa
/approva o "approva" - conferma l'ultima richiesta (serve solo se i pulsanti non arrivano)
/rifiuta o "rifiuta" - annulla l'ultima richiesta
/aiuto - questo messaggio
Le modifiche creano una richiesta con bottoni Approva/Rifiuta.`;

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  if (ALLOW.length && !ALLOW.includes(String(chatId))) { await sendLong(chatId, 'Non sei autorizzato. Chiedi al proprietario di aggiungerti.'); return; }
  const text = (msg.text || '').trim();
  if (!text) { await sendLong(chatId, 'Mandami un messaggio di testo.'); return; }
  if (text === '/start' || text === '/aiuto' || text === '/help') { await sendLong(chatId, HELP); return; }
  if (text === '/oggi') return handleMessage({ ...msg, text: 'cosa ho in programma oggi?' });
  if (text === '/settimana') return handleMessage({ ...msg, text: 'riassumi i prossimi 7 giorni giorno per giorno' });
  if (text.startsWith('/cerca ')) return handleMessage({ ...msg, text: `cerca "${text.slice(7).trim()}" nel calendario` });
  if (text.startsWith('/libero')) { const d = text.split(/\s+/)[1] || 'domani'; return handleMessage({ ...msg, text: `quali slot liberi ho ${d}?` }); }
  if (text === '/azioni') {
    try {
      const r = await fetch(`${API}/ai/actions`); const list = await r.json();
      if (!list.length) { await sendLong(chatId, 'Nessuna richiesta in attesa.'); return; }
      for (const p of list.slice(0, 10)) await sendLong(chatId, `In attesa: ${p.description}`, { reply_markup: pendingKeyboard(p) });
    } catch (e) { await sendLong(chatId, 'Errore lettura azioni: ' + e.message); }
    return;
  }
  // Approvazione/rifiuto anche senza pulsante (workaround se il pulsante non arriva).
  if (/^(\/(approva|rifiuta)|approva|rifiuta|annulla|conferma)[\s.!👍✅]*$/i.test(text)) {
    const id = await resolvePendingId(chatId);
    if (id) {
      try {
        const approved = !/rifiuta|annulla/i.test(text);
        await confirmAction(id, approved);
        lastPendingByChat.delete(String(chatId));
        await sendLong(chatId, approved ? 'Fatto! Calendario aggiornato.' : 'Richiesta annullata.');
      } catch (e) { await sendLong(chatId, 'Errore: ' + String(e.message || e).slice(0, 200)); }
      return;
    }
    if (text.startsWith('/')) { await sendLong(chatId, 'Nessuna richiesta in attesa.'); return; }
    // testo libero senza pending -> comportati come messaggio normale per l'AI
  }
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const { full, pendings } = await askAI(chatId, text);
    await sendLong(chatId, full);
    for (const p of pendings) await sendLong(chatId, `Richiesta: ${p.description}`, { reply_markup: pendingKeyboard(p) });
  } catch (e) { await sendLong(chatId, 'Errore: ' + String(e.message || e).slice(0, 300)); }
}

async function handleCallback(q) {
  const chatId = q.message?.chat?.id;
  const data = q.data || '';
  const m = data.match(/^(ok|no):(.+)$/);
  try {
    if (!m) { await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Azione sconosciuta' }); return; }
    const approved = m[1] === 'ok';
    await confirmAction(m[2], approved);
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: approved ? 'Approvata!' : 'Rifiutata' });
    if (chatId) await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    if (chatId) await sendLong(chatId, approved ? 'Fatto! Calendario aggiornato.' : 'Richiesta annullata.');
  } catch (e) { await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Errore: ' + String(e.message || e).slice(0, 100) }); }
}

async function poll() {
  while (true) {
    try {
      const r = await fetch(`${TG}/getUpdates?timeout=${POLL_TIMEOUT}&offset=${offset}`);
      const j = await r.json();
      for (const u of j.result || []) {
        offset = u.update_id + 1;
        if (u.message) await handleMessage(u.message);
        else if (u.callback_query) await handleCallback(u.callback_query);
      }
    } catch (e) { console.error('[tg] poll err:', e.message); await new Promise((r) => setTimeout(r, 3000)); }
  }
}
poll();


