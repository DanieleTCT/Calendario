import React, { useState, useRef, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import styles from './AIAssistant.module.css';

export function AIAssistant() {
  const api = useApi();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [providerStatus, setProviderStatus] = useState<any>(null);
  const [activeProvider, setActiveProvider] = useState('auto');
  const [convId, setConvId] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<any[]>([]);
  const [toolLog, setToolLog] = useState<Array<{ tool: string; ok: boolean }>>([]);
  const [legend, setLegend] = useState<{ commands: any[]; note?: string } | null>(null);
  const [showLegend, setShowLegend] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadProviderStatus(); loadLegend(); loadPending(); }, []);

  async function loadLegend() {
    try { const r = await api.get('/ai/tools'); setLegend(r.data); }
    catch (e) { console.error('legend failed', e); }
  }

  async function loadPending() {
    try { const r = await api.get('/ai/actions'); setPendingActions(r.data || []); }
    catch { /* ignore */ }
  }

  async function confirmAction(id: string, approved: boolean) {
    try {
      await api.post(`/ai/actions/${id}/confirm`, { approved });
      setPendingActions((prev) => prev.filter((p) => p.id !== id));
      window.dispatchEvent(new CustomEvent('calendar-items-changed'));
    } catch (e) { console.error('confirm failed', e); }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadProviderStatus() {
    try {
      const response = await api.get('/ai/providers');
      setProviderStatus(response.data);
      if (response.data?.aiProvider) setActiveProvider(response.data.aiProvider);
    } catch (error) {
      console.error('Failed to load provider status:', error);
    }
  }

  async function selectProvider(p: string) {
    setActiveProvider(p);
    try { await api.post('/ai/select-provider', { provider: p }); loadProviderStatus(); }
    catch (e) { console.error(e); }
  }

  function parseSSE(raw: string, onEvent: (ev: any) => void) {
    const parts = raw.split('\n\n');
    for (const part of parts) {
      const line = part.trim().split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || loading) return;
    const text = message;
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setMessage('');
    setLoading(true);
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
    try {
      const base = (api.defaults.baseURL || '').replace(/\/$/, '');
      const resp = await fetch(`${base}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId, message: text, provider: activeProvider }),
      });
      if (!resp.ok || !resp.body) {
        // Read error body WITHOUT consuming resp twice
        let errText = resp.statusText;
        try { errText = await resp.text(); } catch { /* noop */ }
        // If backend returned JSON { error }, show it
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error) errText = parsed.error;
        } catch { /* plain text */ }
        throw new Error(`HTTP ${resp.status}: ${errText}`.slice(0, 500));
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      let providerError = '';
      const setAssistant = (content: string) => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content };
          return next;
        });
      };
      // I frame SSE terminano con una riga vuota: "\n\n" oppure "\r\n\r\n".
      const FRAME_SEP = /\r?\n\r?\n/;
      const handleFrame = (frame: string) => {
        const line = frame.split(/\r?\n/).find((l) => l.startsWith('data:'));
        if (!line) return;
        let ev: any = null;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { return; }
        if (ev.type === 'meta' && ev.conversationId) setConvId(ev.conversationId);
        else if (ev.type === 'chunk') {
          acc += ev.content;
          setAssistant(acc);
        } else if (ev.type === 'tool') {
          setToolLog((prev) => [...prev, { tool: ev.tool, ok: !String(ev.result).toLowerCase().includes('errore') }]);
        } else if (ev.type === 'pending' && ev.pending) {
          setPendingActions((prev) => (prev.some((p) => p.id === ev.pending.id) ? prev : [...prev, ev.pending]));
        } else if (ev.type === 'error') {
          providerError = String(ev.error || 'errore sconosciuto');
          const label = ev.provider ? `Errore provider ${ev.provider}` : 'Errore provider';
          setAssistant(`${acc ? acc + '\n\n' : ''}${label}: ${providerError}`);
        } else if (ev.type === 'done' && ev.conversationId) setConvId(ev.conversationId);
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // process complete events
        let m: RegExpExecArray | null;
        while ((m = FRAME_SEP.exec(buf)) !== null) {
          const frame = buf.slice(0, m.index);
          buf = buf.slice(m.index + m[0].length);
          handleFrame(frame);
        }
      }
      if (buf.trim()) handleFrame(buf); // ultimo frame senza riga vuota finale
      loadProviderStatus();
      if (!acc && !providerError) {
        // Stream terminato senza testo e senza errore esplicito dal provider.
        setAssistant(`Il provider (${activeProvider}) non ha restituito testo. Controlla il log del server o prova un altro provider dal menu.`);
      }
    } catch (error: any) {
      console.error('Failed to send message:', error);
      const msg = String(error?.message || error);
      const isHttp = msg.startsWith('HTTP ');
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: 'assistant',
          content: isHttp
            ? `Provider "${activeProvider}": ${msg.replace(/^HTTP \d+:\s*/, '')}`
            : `Errore di connessione: ${msg}. Verifica che il server sia attivo e che la configurazione di "${activeProvider}" sia corretta.`,
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  const list: any[] = providerStatus?.providers || [];

  // Calcola lo stato online e il nome del modello in base al provider attualmente selezionato
  const activeStatus = (() => {
    if (!providerStatus) return null;
    if (activeProvider === 'auto') {
      return {
        online: !!providerStatus.chain?.online,
        model: providerStatus.chain?.model || 'none',
      };
    }
    const matched = list.find((p: any) => p.id === activeProvider);
    if (matched) {
      return {
        online: !!matched.online,
        model: matched.model || matched.label || activeProvider,
      };
    }
    // Provider selezionato ma non presente nella lista (chiave/servizio non configurato)
    return {
      online: false,
      model: 'non configurato',
    };
  })();

  function renderMarkdown(text: string) {
    // Minimal safe markdown: **bold**, *italic*, `code`, -/* lists, 1. numbered, line breaks
    const lines = text.split('\n');
    const els: React.ReactNode[] = [];
    let listBuf: { ordered: boolean; items: string[] } | null = null;
    const flush = () => {
      if (!listBuf) return;
      const { ordered, items } = listBuf;
      listBuf = null;
      els.push(ordered
        ? <ol key={`ol-${els.length}`} className={styles.mdOl}>{items.map((it, i) => <li key={i}>{inline(it)}</li>)}</ol>
        : <ul key={`ul-${els.length}`} className={styles.mdUl}>{items.map((it, i) => <li key={i}>{inline(it)}</li>)}</ul>);
    };
    const inline = (s: string): React.ReactNode[] => {
      // escape nothing (trusted local AI output); parse **bold**, *italic*, `code`
      const parts: React.ReactNode[] = [];
      const re = /(\*\*.+?\*\*|\*[^*]+?\*|`[^`]+?`)/g;
      let last = 0; let m: RegExpExecArray | null; let k = 0;
      while ((m = re.exec(s))) {
        if (m.index > last) parts.push(s.slice(last, m.index));
        const tok = m[0];
        if (tok.startsWith('**')) parts.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
        else if (tok.startsWith('*')) parts.push(<em key={k++}>{tok.slice(1, -1)}</em>);
        else parts.push(<code key={k++} className={styles.mdCode}>{tok.slice(1, -1)}</code>);
        last = m.index + tok.length;
      }
      if (last < s.length) parts.push(s.slice(last));
      return parts;
    };
    lines.forEach((ln, i) => {
      const t = ln.trim();
      const ol = t.match(/^(\d+)[.)]\s+(.*)/);
      if (/^([-*•])\s+/.test(t)) {
        const item = t.replace(/^([-*•])\s+/, '');
        if (!listBuf || listBuf.ordered) { flush(); listBuf = { ordered: false, items: [] }; }
        listBuf.items.push(item);
        return;
      }
      if (ol) {
        if (!listBuf || !listBuf.ordered) { flush(); listBuf = { ordered: true, items: [] }; }
        listBuf.items.push(ol[2]);
        return;
      }
      flush();
      if (t === '') { els.push(<div key={`sp-${i}`} className={styles.mdGap} />); return; }
      if (/^#{1,3}\s/.test(t)) { els.push(<div key={`h-${i}`} className={styles.mdH}>{inline(t.replace(/^#{1,3}\s/, ''))}</div>); return; }
      els.push(<div key={`p-${i}`} className={styles.mdP}>{inline(ln)}</div>);
    });
    flush();
    return els;
  }

  return (
    <div className={styles.container}>
      <div className={styles.statusBar}>
        <h3>Assistente AI</h3>
        {activeStatus && (
          <div className={styles.status}>
            <span className={activeStatus.online ? styles.online : styles.offline}>
              {activeStatus.online ? '● Online' : '● Offline'}
            </span>
            <span className={styles.model}>Modello: {activeStatus.model}</span>
          </div>
        )}
      </div>

      <div className={styles.providerBar}>
        <label>Provider:</label>
        <select value={activeProvider} onChange={(e) => selectProvider(e.target.value)} disabled={loading}>
          <option value="auto">Auto (Gemini prima)</option>
          <option value="gemini">Gemini</option>
          <option value="openrouter">OpenRouter</option>
          <option value="local">Locale (Bionic/LM Studio)</option>
          <option value="ollama">Ollama</option>
          <option value="demo">Demo</option>
        </select>
        <div className={styles.providerDots}>
          {list.map((p: any) => (
            <span key={p.id} title={`${p.label}: ${p.configured ? 'configurato' : 'non configurato'}${p.online ? ', online' : ''}`}
              className={`${styles.dot} ${p.online ? styles.dotOn : p.configured ? styles.dotCfg : styles.dotOff}`}>
              {p.id}
            </span>
          ))}
        </div>
      </div>

      {pendingActions.length > 0 && (
        <div className={styles.pendingBar}>
          {pendingActions.map((p) => (
            <div key={p.id} className={styles.pendingCard}>
              <div className={styles.pendingText}>
                <strong>Approvazione richiesta</strong>
                <span>{p.description}</span>
              </div>
              <div className={styles.pendingBtns}>
                <button className={styles.approveBtn} onClick={() => confirmAction(p.id, true)}>✓ Approva</button>
                <button className={styles.rejectBtn} onClick={() => confirmAction(p.id, false)}>✕ Rifiuta</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.messagesContainer}>
        {messages.length === 0 ? (
          <div className={styles.welcome}>
            <h4>Benvenuto nell'Assistente AI</h4>
            <p>Connesso a Gemini: chiedimi dei tuoi eventi e task, li leggo dal calendario.</p>
            <div className={styles.examples}>
              <p>Esempi:</p>
              <ul>
                <li>"Crea un evento domani alle 10"</li>
                <li>"Trova tempo libero questa settimana"</li>
                <li>"Quanti task ho in sospeso?"</li>
                <li>"Aggiungi un reminder per la riunione"</li>
              </ul>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`${styles.message} ${styles[msg.role]}`}>
              <div className={styles.messageContent}>
                {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {toolLog.length > 0 && (
        <div className={styles.toolLog}>
          {toolLog.slice(-6).map((t, i) => (
            <span key={i} className={`${styles.toolChip} ${t.ok ? styles.toolChipOk : styles.toolChipErr}`}>{t.tool}</span>
          ))}
        </div>
      )}

      {legend && (
        <div className={styles.legend}>
          <button className={styles.legendToggle} onClick={() => setShowLegend((v) => !v)}>
            {showLegend ? '▾' : '▸'} Comandi disponibili per l'IA ({legend.commands.length})
          </button>
          {showLegend && (
            <div className={styles.legendBody}>
              <table className={styles.legendTable}>
                <thead>
                  <tr><th>Comando</th><th>Cosa fa</th><th>Tipo</th></tr>
                </thead>
                <tbody>
                  {legend.commands.map((c: any) => (
                    <tr key={c.command}>
                      <td className={styles.legendCmd}>{c.command}</td>
                      <td>{c.description}</td>
                      <td>
                        <span className={c.kind === 'write' ? styles.kindWrite : styles.kindRead}>
                          {c.kind === 'write' ? 'con approvazione' : 'sola lettura'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {legend.note && <p className={styles.legendNote}>{legend.note}</p>}
            </div>
          )}
        </div>
      )}

      <form className={styles.inputForm} onSubmit={handleSendMessage}>
        <input
          type="text"
          placeholder="Scrivi un messaggio..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={loading}
          className={styles.input}
        />
        <button type="submit" disabled={loading} className={styles.sendButton}>
          {loading ? '...' : '→'}
        </button>
      </form>
    </div>
  );
}
