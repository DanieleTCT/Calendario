import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { pickProvider, rankProviders } from '../providers';
import { executeTool, applyApprovedAction } from '@calendario/agent';

export const aiRoutes = Router();

// Testo che "simula" una richiesta preparata senza che il tool sia stato chiamato:
// in quel caso NON esiste nessuna PendingAction e quindi nessun pulsante di approvazione.
const PHANTOM_REPLY_RE = /ho preparat|premi (?:il pulsante )?approva|per confermare oppure rifiuta/i;
// Invito a fare la chiamata vera quando il modello risponde solo con testo.
const REPAIR_NUDGE =
  'Non hai chiamato alcuno strumento: la richiesta NON e stata preparata e l utente non vedra alcun pulsante. ' +
  'Rileggi il mio ultimo messaggio e CHIAMA ORA il tool di modifica corretto (es. calendar_create_item o tasks_create) con i dati esatti. ' +
  'Non rispondere in testo senza la chiamata.';

function buildSystemPrompt(itemsSummary: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    'Sei un assistente calendario italiano, concreto e breve.',
    `Oggi e ${today}.`,
    'Hai a disposizione FUNCTION CALLING con tool reali. Usali quando servono:',
    '- calendar_query_range(startDate, endDate, type): eventi/task in un intervallo',
    '- calendar_search(query, limit): ricerca per parola chiave',
    '- calendar_find_free_slots(date, startHour, endHour, slotDurationMinutes): slot liberi',
    '- tasks_list(status, limit): task per stato (all/open/completed/overdue)',
    '- calendar_create_item / tasks_create / calendar_update_item / calendar_delete_item / tasks_complete: AZIONI CHE MODIFICANO I DATI. Chiamali pure: il server crea una RICHIESTA DI APPROVAZIONE e NON esegue nulla finche l\u2019utente non conferma dai pulsanti. Dopo la chiamata, spiega cosa hai proposto e invita a confermare.',
    'REGOLE: per leggere dati usa i tool invece di indovinare. Per modifiche, chiama il tool e poi descrivi la proposta in testo semplice. Mai eseguire modifiche senza tool.',
    'REGOLA FONDAMENTALE: il testo "Ho preparato la richiesta" o "Premi Approva" puo essere scritto SOLO dopo aver appena chiamato un tool di modifica (calendar_create_item, tasks_create, calendar_update_item, calendar_delete_item, tasks_complete). Senza quella chiamata la richiesta NON esiste e l utente non vede alcun pulsante: non inventarla mai e non ripetere questa frase solo perch compare nella cronologia.',
    'FORMATO RISPOSTA (obbligatorio): usa SOLO testo semplice su righe separate. VIETATO usare asterischi, cancelleti, underscore, backtick o qualsiasi sintassi markdown. Per gli elenchi usa il trattino "-" a inizio riga. Per evidenziare scrivi in MAIUSCOLO la parola chiave invece del grassetto.',
    'Se l\u2019utente chiede quali comandi o funzioni conosci, rispondi con questa lista esatta (solo testo semplice, una voce per riga):',
    '- RIASSUNTO: riepilogo eventi e task di oggi o di un periodo (uso calendar_query_range)',
    '- CERCA: ricerca eventi o task per parola chiave (uso calendar_search)',
    '- SLOT LIBERI: trova fasce orarie libere in una data (uso calendar_find_free_slots)',
    '- CREA EVENTO: creo una richiesta di creazione evento da approvare (uso calendar_create_item)',
    '- CREA TASK: creo una richiesta di creazione task da approvare (uso tasks_create)',
    '- COMPLETA TASK: creo una richiesta per segnare un task completato o da rifare (uso tasks_complete)',
    '- MODIFICA / ELIMINA: creo richieste di modifica o eliminazione da approvare (uso calendar_update_item / calendar_delete_item)',
    '- AGENDA: elenco ordinato dei prossimi 14 giorni (uso calendar_query_range)',
    'Esempio corretto:',
    '- OGGI 23/09: Riunione Team dalle 09:00 alle 10:00',
    '- 26/09: Torneo Al TT dalle 08:00 alle 16:00',
    'Contesto calendario attuale (puo essere parziale: usa i tool per dati freschi):',
    itemsSummary || '(calendario vuoto)',
  ].join('\n');
}

function summarizeItems(items: any[]): string {
  return items
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 60)
    .map((i) => {
      const when = `${i.date}${i.startTime ? ' ' + i.startTime : ''}${i.endTime ? '-' + i.endTime : ''}`;
      const state = i.type === 'task' ? (i.completed ? '[completato]' : '[da fare]') : '[evento]';
      return `- ${state} ${i.title} (${when}) cat=${i.category || 'general'} id=${i.id}`;
    })
    .join('\n');
}

// Flatten tool results (arrays of items, {freeSlots}, etc.) into readable plain text.
// Used as a degraded answer when the model is unavailable but tools already ran.
function flattenItems(results: any[]): string {
  const rows: string[] = [];
  const push = (arr: any[]) => {
    for (const it of arr) {
      const when = `${it.date || ''}${it.startTime ? ' ' + it.startTime : ''}${it.endTime ? '-' + it.endTime : ''}`;
      const state = it.type === 'task' ? (it.completed ? '[completato] ' : '[da fare] ') : '';
      rows.push(`- ${when ? when + ': ' : ''}${state}${it.title}`);
    }
  };
  for (const r of results) {
    if (Array.isArray(r)) push(r);
    else if (r && Array.isArray(r.freeSlots)) {
      rows.push(r.freeSlots.length ? `- Slot liberi il ${r.date}: ${r.freeSlots.join(', ')}` : `- Nessuno slot libero il ${r.date}`);
    }
  }
  if (rows.length === 0) return '- Nessun risultato';
  return Array.from(new Set(rows)).slice(0, 40).join('\n');
}

// Verifica che la risposta del modello non inventi eventi/task: ogni titolo citato
// deve corrispondere (match sfocato) a un item restituito dai tool. Se il modello
// cita item inesistenti, si sostituisce la risposta con l'elenco deterministico.
function groundReplyOnTools(reply: string, collected: any[]): { replaced: boolean; text: string } {
  const items: any[] = [];
  for (const r of collected) {
    if (Array.isArray(r)) items.push(...r);
    else if (r && typeof r === 'object' && (r as any).id && (r as any).title) items.push(r);
  }
  if (!items.length) return { replaced: false, text: reply };
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();
  const low = norm(reply);
  let matched = 0;
  for (const it of items) {
    const title = norm(String(it.title || ''));
    if (!title) continue;
    const words = title.split(' ').filter((w) => w.length > 3);
    const key = words.slice(0, 3).join(' ');
    if ((key && low.includes(key)) || (title.length > 4 && low.includes(title))) matched++;
  }
  // Se NESSUN titolo dei tool compare nella risposta ma il modello elenca eventi/task,
  // quasi certamente ha inventato: sostituisci con i dati veri.
  const looksLikeListing = /-|\d{1,2}[./-]\d{1,2}|ore|orario|•/i.test(reply);
  if (matched === 0 && looksLikeListing) {
    return { replaced: true, text: `Ecco i dati reali dal calendario:\n${flattenItems(collected)}` };
  }
  return { replaced: false, text: reply };
}

// ---- Scelta del provider in modalita 'auto' -------------------------------
// La sola isOnline() non basta: non rileva errori come quota esaurita (429),
// modello non disponibile o server locale spento. Qui si prova davvero ogni
// provider della catena con una richiesta minima e si usa il primo che risponde.
let autoChoice: { id: string; at: number } | null = null;
const AUTO_CHOICE_TTL_MS = 120000;

async function probeAutoProvider(providers: any[], systemPrompt: string): Promise<any | null> {
  const ordered = rankProviders(providers);
  const reachable: any[] = [];
  const others: any[] = [];
  for (const p of ordered) {
    try {
      if (!(await p.isConfigured())) continue;
      if (await p.isOnline()) reachable.push(p); else others.push(p);
    } catch { others.push(p); }
  }
  let candidates: any[] = [...reachable, ...others];

  // Se un provider e stato scelto da poco, riproviamolo per primo.
  const cacheFresh = !!autoChoice && Date.now() - autoChoice.at < AUTO_CHOICE_TTL_MS;
  if (autoChoice && cacheFresh) {
    const i = candidates.findIndex((p) => p.id === autoChoice!.id);
    if (i > 0) candidates = [candidates[i], ...candidates.filter((_, k) => k !== i)];
  }

  let lastError: any = null;
  for (const cand of candidates) {
    // Provider scelto di recente: si evita la probe extra ad ogni messaggio.
    if (cacheFresh && autoChoice && autoChoice.id === cand.id) return cand;
    try {
      const probe: any = await cand.startSession({ systemPrompt, maxTokens: 1, temperature: 0, timeout: 20000 });
      try { await probe.complete([{ role: 'user', content: 'ping' }], false); }
      finally { try { await probe.close(); } catch { /* noop */ } }
      autoChoice = { id: cand.id, at: Date.now() };
      return cand;
    } catch (e) { lastError = e; }
  }
  if (lastError) console.warn('[ai] auto: nessun provider ha risposto alla probe:', String(lastError?.message || lastError));
  return null;
}

// Available AI commands legend (used by the AI page legend panel)
const COMMAND_LEGEND = [
  { command: 'Riassunto', description: 'Riepilogo di eventi e task di oggi o di un periodo scelto.', tool: 'calendar_query_range', kind: 'read' },
  { command: 'Cerca', description: 'Ricerca eventi e task per parola chiave o categoria.', tool: 'calendar_search', kind: 'read' },
  { command: 'Slot liberi', description: 'Trova le fasce orarie libere in una data, con durata slot configurabile.', tool: 'calendar_find_free_slots', kind: 'read' },
  { command: 'Lista task', description: 'Elenca i task filtrando per stato: tutti, da fare, completati, in ritardo.', tool: 'tasks_list', kind: 'read' },
  { command: 'Crea evento', description: 'Propone un nuovo evento: il server crea una richiesta di approvazione, poi salvi tu.', tool: 'calendar_create_item', kind: 'write' },
  { command: 'Crea task', description: 'Propone un nuovo task con scadenza: richiede la tua approvazione prima di salvarlo.', tool: 'tasks_create', kind: 'write' },
  { command: 'Completa task', description: 'Segna un task come completato o da rifare, previa approvazione.', tool: 'tasks_complete', kind: 'write' },
  { command: 'Modifica', description: 'Modifica titolo, data, orario o categoria di un evento/task, previa approvazione.', tool: 'calendar_update_item', kind: 'write' },
  { command: 'Elimina', description: 'Elimina un evento o un task, previa approvazione.', tool: 'calendar_delete_item', kind: 'write' },
];

aiRoutes.get('/tools', (_req: Request, res: Response) => {
  res.json({
    commands: COMMAND_LEGEND,
    note: 'Le voci READ vengono eseguite subito dall\u2019IA. Le voci WRITE creano una richiesta di approvazione: nulla viene salvato finche non confermi.',
  });
});

// List pending actions (for approval UI)
aiRoutes.get('/actions', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const all = await repository.listPendingActions();
    res.json(all.filter((a) => a.status === 'pending'));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get available providers
aiRoutes.get('/providers', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const settings = await repository.getSettings();
    const chain = req.appContext!.providers as any;
    const list: any[] = (chain as any).providers || [];
    const details = [];
    for (const p of list) {
      try { details.push({ id: p.id, label: p.label, ...(await p.getStatus()) }); }
      catch (e) { details.push({ id: p.id, label: p.label, online: false, configured: false, error: String(e) }); }
    }
    res.json({
      chain: await chain.getStatus(),
      providers: details,
      aiProvider: (settings as any).aiProvider || 'auto',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get local (Ollama) status
aiRoutes.get('/local-status', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const settings = await repository.getSettings();
    const { resolveOllamaBaseUrl, resolveOllamaModel } = await import('../providers');
    const model = resolveOllamaModel(settings.ollama?.model);
    const baseUrl = resolveOllamaBaseUrl(settings.ollama?.baseUrl);

    if (!model) {
      return res.json({
        configured: false,
        online: false,
        baseUrl,
        error: 'Ollama not configured',
      });
    }

    // Check Ollama connection
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = (await response.json()) as any;
      const models = data.models?.map((m: any) => m.name) || [];
      // Match esatto o per prefisso (ollama restituisce 'qwen2.5:3b...' ma l'utente salva 'qwen2.5:3b').
      const modelExists = models.some((m: string) => m === model || m.startsWith(model + ':') || model.startsWith(m));

      res.json({
        configured: true,
        online: modelExists,
        model,
        availableModels: models,
        baseUrl,
      });
    } catch {
      res.json({
        configured: true,
        online: false,
        model,
        baseUrl,
        error: 'Cannot connect to Ollama',
      });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// List conversations
aiRoutes.get('/conversations', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const conversations = await repository.listConversations();

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get conversation messages
aiRoutes.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const repository = req.appContext!.repository;

    const conversation = await repository.getConversation(id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation.messages);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// List pending actions
aiRoutes.get('/pending', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const actions = await repository.listPendingActions();

    // Filter by conversation if specified
    const { conversationId } = req.query;
    const filtered = conversationId
      ? actions.filter((a) => a.conversationId === conversationId)
      : actions;

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Create chat message (real streaming via configured provider, Gemini first)
aiRoutes.post('/chat', async (req: Request, res: Response) => {
  try {
    const { conversationId, message, provider } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing required field: message' });

    const repository = req.appContext!.repository;
    const chain = req.appContext!.providers as any;
    const list: any[] = (chain as any).providers || [];
    const settings = await repository.getSettings();
    // 'explicit' = il client (UI web) ha scelto un provider specifico.
    // Se non c'e scelta esplicita (bot Telegram, altri client) si usa il provider
    // salvato nelle impostazioni e, se non risponde, la catena con fallback.
    const explicit = typeof provider === 'string' && provider.trim().length > 0;
    const preferred = explicit ? provider.trim() : ((settings as any).aiProvider || 'auto');

    // Selezione provider:
    // - provider esplicito (gemini/openrouter/local/ollama/demo) => si usa SOLO quello scelto.
    //   Se non e disponibile/configured si risponde con un errore chiaro, senza fallback
    //   silenzioso su un altro provider (evita di ricevere risposte da Gemini inattese).
    // - 'auto' => catena con fallback (Gemini -> OpenRouter -> Locale -> Ollama -> Demo).
    let target: any = null;
    if (explicit && preferred !== 'auto') {
      target = list.find((p: any) => p.id === preferred) || null;
      if (!target) {
        const available = list.map((p: any) => p.id).join(', ') || 'nessuno';
        return res.status(400).json({
          error: `Provider "${preferred}" non disponibile. Provider attualmente caricati: ${available}. Configuralo in Impostazioni (o avvia il server locale) e riprova.`,
        });
      }
      try {
        const ok = await target.isConfigured();
        if (!ok) return res.status(400).json({ error: `Provider "${preferred}" non configurato: aggiungi la chiave API nelle Impostazioni.` });
      } catch (e) { return res.status(503).json({ error: String(e) }); }
    } else {
      target = pickProvider(list, 'auto');
      // 'auto': si prova davvero la catena (Gemini -> OpenRouter -> Locale -> Ollama -> Demo)
      // e si usa il primo provider che risponde, cosi un provider non disponibile
      // (quota esaurita, server spento...) non blocca la risposta.
      try {
        const probed = await probeAutoProvider(list, 'Sei un assistente. Rispondi con OK.');
        if (probed) target = probed;
      } catch (e) { console.warn('[ai] auto probe failed:', String((e as any)?.message || e)); }
      // Auto: se la catena finisce sul Demo ma esiste un provider reale configurato, preferisci quello.
      if (target?.id === 'demo') {
        const real = list.find((p: any) => p.id !== 'demo');
        if (real) {
          try { if (await real.isConfigured()) target = real; } catch { /* keep demo */ }
        }
      }
      if (!target) return res.status(503).json({ error: 'Nessun provider AI disponibile.' });
      try {
        const ok = await target.isConfigured();
        if (!ok) return res.status(503).json({ error: 'Nessun provider AI configurato. Aggiungi una chiave API o configura il modello locale.' });
      } catch (e) { return res.status(503).json({ error: String(e) }); }
    }

    // Conversation persistence (best-effort)
    let convId = conversationId;
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    try {
      if (convId) {
        const conv = await repository.getConversation(convId);
        if (conv) history = (conv.messages || []).map((m: any) => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant', content: String(m.content) })).slice(-20);
      }
      if (!convId) {
        convId = uuid();
        await repository.createConversation({ id: convId, title: String(message).slice(0, 60), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] } as any);
      }
    } catch { /* persistence optional */ }

    // Calendar context for grounded answers
    let summary = '';
    try { summary = summarizeItems(await repository.listItems()); } catch { summary = ''; }
    const systemPrompt = buildSystemPrompt(summary);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    (res as any).flushHeaders?.();

    // Frame SSE con terminatore LF esplicito: non dipende dagli a-capo del file sorgente.
    const sse = (obj: any) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    sse({ type: 'meta', provider: target.id, conversationId: convId });

    // I modelli locali (LM Studio/Bionic, Ollama) sono lenti: timeout piu generoso.
    const slowLocal = target.id === 'local' || target.id === 'ollama';
    const session = await target.startSession({ systemPrompt, maxTokens: 2048, temperature: 0.7, timeout: slowLocal ? 300000 : 90000 });
    let full = '';
    const toolCtx = { repository, conversationId: convId, userId: 'local' };
    const sendChunk = (content: string) => sse({ type: 'chunk', content });
    const sendTool = (tool: string, input: any, result: any) =>
      sse({ type: 'tool', tool, input, result });
    const sendPending = (p: any) =>
      sse({ type: 'pending', pending: p });
    try {
      // Agentic loop: complete() with tools -> execute read-only immediately,
      // modifying ones become PendingActions. Max 4 iterations.
      const convo: Array<{ role: 'user' | 'assistant'; content: string }> = [...history, { role: 'user', content: String(message) }];
      const pendingDescs: string[] = [];
      const usedTools: string[] = [];
      const collected: any[] = [];
      let loopError: any = null;
      let repairTries = 0;
      for (let step = 0; step < 4; step++) {
        let out: any = null;
        try {
          out = await (session as any).complete(convo, true);
        } catch (modelErr: any) {
          loopError = modelErr;
          break;
        }
        const calls: Array<{ name: string; input: Record<string, unknown> }> = out?.toolCalls || [];
        if (calls.length === 0) {
          // "Fantasma": il modello scrive di aver preparato la richiesta ma NON ha chiamato
          // alcun tool -> non esiste nessuna PendingAction e quindi nessun pulsante.
          // Non inviamo quel testo: si chiede al modello di effettuare la chiamata (max 2 volte).
          const phantomText = String(out?.content || '');
          const isPhantom = pendingDescs.length === 0 && PHANTOM_REPLY_RE.test(phantomText);
          if (isPhantom && repairTries < 2) {
            repairTries++;
            convo.push({ role: 'assistant', content: phantomText });
            convo.push({ role: 'user', content: REPAIR_NUDGE });
            continue;
          }
          if (isPhantom) {
            // Ripristino fallito: meglio dire la verita che fingere un pulsante inesistente.
            const msg = 'Non sono riuscito a preparare la richiesta: il modello non ha chiamato lo strumento di modifica, quindi nessun pulsante e stato creato. Riprova con una richiesta piu specifica (titolo, data e ora).';
            full += msg; sendChunk(msg);
          } else if (phantomText) {
            full += phantomText; sendChunk(phantomText);
          }
          break;
        }
        if (out?.content) { full += out.content; sendChunk(out.content); }
        // Execute each tool call server-side
        const toolResults: string[] = [];
        let allModifying = true;
        for (const c of calls) {
          usedTools.push(c.name);
          const r: any = await executeTool(c.name, c.input || {}, toolCtx);
          if (r.success && !r.pendingActionId) collected.push(r.data);
          sendTool(c.name, c.input, r.success ? (r.data ?? r.message) : r.message);
          if (r.pendingActionId) {
            const p = await repository.getPendingAction(r.pendingActionId);
            if (p) { pendingDescs.push(p.description); sendPending(p); }
          } else {
            allModifying = false;
          }
          toolResults.push(`RISULTATO TOOL ${c.name} input=${JSON.stringify(c.input)} output=${JSON.stringify(r.success ? (r.data ?? r.message) : r.message).slice(0, 2000)}`);
        }
        // Gemini rejects conversations that END with a model turn:
        // keep alternation (assistant text, if any) then feed results back as a USER turn.
        if (out?.content) convo.push({ role: 'assistant', content: out.content });
        convo.push({ role: 'user', content: toolResults.join('\n') });
        // All calls were modifying -> user must approve, no further model turn needed
        if (allModifying) break;
      }
      if (!full && pendingDescs.length) {
        const msg = `Ho preparato ${pendingDescs.length > 1 ? 'le richieste' : 'la richiesta'}: ${pendingDescs.join('; ')}.
Premi Approva per confermare oppure Rifiuta per annullare.`;
        full = msg; sendChunk(msg);
      }
      // Degraded but useful answer when the model is unavailable (503/429) or silent
      if (!full && collected.length) {
        const lines = flattenItems(collected);
        const msg = `Il modello non e disponibile al momento${loopError ? ' (' + String(loopError.message || loopError).slice(0, 120) + ')' : ''}, ma ecco i dati dal calendario:
${lines}`;
        full = msg; sendChunk(msg);
      }
      if (!full) {
        // Fallback: stream path for providers without tool support
        try {
          const sout: any = await (session as any).stream(convo, undefined, (ch: string) => { full += ch; sendChunk(ch); });
          full = sout?.content || full;
        } catch (streamErr: any) {
          console.warn('stream failed, full so far:', full.length, streamErr?.message || streamErr);
        }
      }
      // Anti-allucinazione: se il modello ha usato tool di LETTURA, la risposta finale
      // deve citare solo item realmente restituiti. Altrimenti si risponde con i dati veri.
      if (full && collected.length) {
        const grounded = groundReplyOnTools(full, collected);
        if (grounded.replaced) {
          full = grounded.text;
          sse({ type: 'chunk', content: '\n\n[Dati verificati dal calendario]' });
        }
      }
      // Sicurezza finale: se il testo promette una richiesta ma nessuna pending e stata
      // creata (tool non chiamato o tool in errore), non facciamo credere all'utente di
      // dover premere un pulsante che non esiste.
      if (full && pendingDescs.length === 0 && PHANTOM_REPLY_RE.test(full)) {
        const warn = '\n\nATTENZIONE: nessuna richiesta e stata creata e nessun pulsante e disponibile.';
        full += warn; sendChunk(warn);
      }
      if (!full) throw (loopError || new Error('Il provider non ha restituito testo (tool loop vuoto)'));
    } catch (err: any) {
      sse({ type: 'error', provider: target?.id, error: String(err?.message || err) });
      sse({ type: 'done' });
      autoChoice = null;
      return res.end();
    } finally { try { await session.close(); } catch { /* noop */ } }

    // Save messages (best-effort)
    try {
      const conv = await repository.getConversation(convId);
      if (conv) {
        const now = new Date().toISOString();
        await repository.updateConversation(convId, {
          updatedAt: now,
          messages: [...(conv.messages || []),
            { id: uuid(), conversationId: convId, role: 'user', content: String(message), timestamp: now } as any,
            { id: uuid(), conversationId: convId, role: 'assistant', content: full, timestamp: now, metadata: { provider: target.id } } as any,
          ],
        } as any);
      }
    } catch { /* noop */ }

    sse({ type: 'done', provider: target.id, conversationId: convId });
    res.end();
    req.on('close', () => { try { res.end(); } catch { /* noop */ } });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/ai/local-probe — testa un endpoint OpenAI-compatibile (Bionic, LM Studio...)
aiRoutes.post('/local-probe', async (req: Request, res: Response) => {
  try {
    const { baseUrl, apiKey } = req.body as { baseUrl?: string; apiKey?: string };
    const base = String(baseUrl || '').replace(/\/$/, '');
    if (!base) return res.status(400).json({ error: 'baseUrl mancante (es: http://localhost:11434/v1)' });
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const tryUrls = [`${base}/models`, base.replace(/\/v1$/, '') + '/v1/models'];
    let models: string[] = [];
    let okUrl = '';
    let lastErr = '';
    for (const u of [...new Set(tryUrls)]) {
      try {
        const r = await fetch(u, { headers, signal: AbortSignal.timeout(6000) });
        if (!r.ok) { lastErr = `${u} -> ${r.status}`; continue; }
        const j = await r.json() as any;
        models = (j.data || []).map((m: any) => String(m.id));
        okUrl = u;
        break;
      } catch (e: any) { lastErr = `${u}: ${e?.message || e}`; }
    }
    if (!okUrl) return res.json({ ok: false, models: [], error: `Non raggiungibile. Ultimo errore: ${lastErr}` });
    return res.json({ ok: true, baseUrl: base, modelsUrl: okUrl, models });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Select active provider (auto/gemini/openrouter/ollama/local/demo)
aiRoutes.post('/select-provider', async (req: Request, res: Response) => {
  try {
    const { provider } = req.body;
    const allowed = ['auto', 'gemini', 'openrouter', 'ollama', 'local', 'demo'];
    if (!allowed.includes(provider)) return res.status(400).json({ error: `Invalid provider. Use one of: ${allowed.join(', ')}` });
    const repository = req.appContext!.repository;
    const updated = await repository.updateSettings({ aiProvider: provider } as any);
    res.json({ aiProvider: (updated as any).aiProvider });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Confirm pending action
aiRoutes.post('/actions/:id/confirm', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { approved } = req.body;
    const repository = req.appContext!.repository;

    const action = await repository.getPendingAction(id);
    if (!action) {
      return res.status(404).json({ error: 'Action not found' });
    }

    if (!approved) {
      // Reject action
      const updated = await repository.updatePendingAction(id, {
        status: 'rejected',
      });
      return res.json(updated);
    }

    // Approve action: mark approved AND apply it for real
    let applied: unknown = null;
    let applyError: string | null = null;
    try {
      applied = await applyApprovedAction({ toolName: action.toolName, toolInput: action.toolInput as any }, repository);
    } catch (e: any) {
      applyError = String(e?.message || e);
    }
    const approvedAction = await repository.updatePendingAction(id, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
    });

    res.json({ ...approvedAction, applied, applyError });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
