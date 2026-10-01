// Diagnostica SSE: replica ESATTAMENTE la logica di parsing del frontend
// (apps/web/src/components/AIAssistant.tsx) per capire se lo stream viene letto.
// Uso:  node scripts/debug-sse.mjs [baseUrl] [provider] [messaggio]
const base = (process.argv[2] || 'http://localhost:3000/api').replace(/\/$/, '');
const provider = process.argv[3] || 'local';
const message = process.argv[4] || 'analizza il calendario';

const resp = await fetch(`${base}/ai/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversationId: null, message, provider }),
});
console.log('status:', resp.status, 'ok:', resp.ok, 'ctype:', resp.headers.get('content-type'));
if (!resp.ok || !resp.body) { console.log('BODY:', await resp.text()); process.exit(1); }

const reader = resp.body.getReader();
const decoder = new TextDecoder();
let buf = '';
let acc = '';
const types = [];
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const chunk = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    const line = chunk.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    let ev = null;
    try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
    types.push(ev.type);
    if (ev.type === 'chunk') acc += ev.content;
    if (ev.type === 'tool') console.log(`  [tool] ${ev.tool} -> ${String(ev.result).slice(0, 160)}`);
    if (ev.type === 'pending') console.log(`  [pending] ${ev.pending?.id} :: ${ev.pending?.description}`);
    if (ev.type === 'error') console.log('ERRORE dal provider:', ev.provider, ev.error.slice(0, 200));
  }
}
console.log('eventi ricevuti:', types.join(', ') || '(nessuno)');
console.log('testo accumulato:', JSON.stringify(acc.slice(0, 300)));
console.log('residuo non processato nel buffer:', JSON.stringify(buf.slice(0, 120)));
