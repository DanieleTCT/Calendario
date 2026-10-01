import React, { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import {
  DEFAULT_CATEGORY_COLORS,
  CATEGORY_LABELS,
  EDITABLE_CATEGORIES,
  categoryGradient,
  eventTextColor,
  EventTextMode,
  clampOpacity,
  DEFAULT_EVENT_OPACITY,
  DEFAULT_TASK_DEADLINE_COLOR,
  taskDeadlineGradient,
} from '../utils/eventColors';
import styles from './SettingsPanel.module.css';

interface Props {
  onSave: () => void;
  settings?: any;
}

// Stili riusati dalle righe del selettore colore
const colorRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '.6rem',
  padding: '.4rem .6rem', border: '1px solid var(--gray-200)', borderRadius: 10,
};
const colorInputStyle: React.CSSProperties = {
  width: 40, height: 34, padding: 0, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0,
};
const previewStyle: React.CSSProperties = {
  fontSize: '.68rem', fontWeight: 700, padding: '.2rem .5rem', borderRadius: 6,
  whiteSpace: 'nowrap', flexShrink: 0,
};

export function SettingsPanel({ onSave, settings = {} }: Props) {
  const api = useApi();
  const [theme, setTheme] = useState('auto');
  const [defaultView, setDefaultView] = useState<'month' | 'week' | 'day'>('week');
  const [layoutMode, setLayoutMode] = useState<'fit' | 'scroll' | 'card'>('card');
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [calendarSlotHeight, setCalendarSlotHeight] = useState(48);
  const [daySlotHeight, setDaySlotHeight] = useState(60);
  const [monthCellMinHeight, setMonthCellMinHeight] = useState(120);
  const [contentMaxWidth, setContentMaxWidth] = useState<number | null>(null);
  const [cardWidthPercent, setCardWidthPercent] = useState(90);
  const [cardHeightPercent, setCardHeightPercent] = useState(85);
  const [cardMaxWidth, setCardMaxWidth] = useState<number | null>(1200);
  const [autoFit, setAutoFit] = useState(true);
  const [geminiKey, setGeminiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('');
  const [localUrl, setLocalUrl] = useState('http://localhost:11434/v1');
  const [localModel, setLocalModel] = useState('');
  const [localKey, setLocalKey] = useState('');
  const [message, setMessage] = useState('');
  // PoliTO
  const [politoUser, setPolitoUser] = useState('');
  const [politoPass, setPolitoPass] = useState('');
  const [politoEnabled, setPolitoEnabled] = useState(true);
  const [politoSyncMin, setPolitoSyncMin] = useState(60);
  const [politoWindowDays, setPolitoWindowDays] = useState(28);
  const [politoShowWeek, setPolitoShowWeek] = useState(true);
  const [politoShowMonth, setPolitoShowMonth] = useState(true);
  const [politoShowDay, setPolitoShowDay] = useState(true);
  const [politoColorMap, setPolitoColorMap] = useState<Record<string, string>>({});
  const [politoStatus, setPolitoStatus] = useState<any>(null);
  const [politoBusy, setPolitoBusy] = useState(false);
  const [politoMsg, setPolitoMsg] = useState('');
  // Colori eventi per categoria + colore testo + opacità + scadenza task
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>({});
  const [eventTextMode, setEventTextMode] = useState<EventTextMode>('auto');
  const [eventOpacity, setEventOpacity] = useState<number>(DEFAULT_EVENT_OPACITY);
  const [taskDeadlineColor, setTaskDeadlineColor] = useState<string>(DEFAULT_TASK_DEADLINE_COLOR);
  // Visibilità calendario (selezionabile e salvabile)
  const [fShowEvents, setFShowEvents] = useState(true);
  const [fShowTasks, setFShowTasks] = useState(true);
  const [fShowCompleted, setFShowCompleted] = useState(true);
  const [fShowAllDay, setFShowAllDay] = useState(true);
  const [fShowDeadlines, setFShowDeadlines] = useState(true);
  const [fShowPolito, setFShowPolito] = useState(true);
  const [fVisibility, setFVisibility] = useState('all');

  useEffect(() => {
    loadSettings();
  }, [settings]);

  useEffect(() => {
    loadPolitoStatus();
  }, []);

  async function loadPolitoStatus() {
    try {
      const r = await api.get('/polito/status');
      setPolitoStatus(r.data);
      if (r.data?.enabled !== undefined) setPolitoEnabled(!!r.data.enabled);
      if (r.data?.syncIntervalMin) setPolitoSyncMin(r.data.syncIntervalMin);
      if (r.data?.windowDays) setPolitoWindowDays(r.data.windowDays);
      if (r.data?.showInWeek !== undefined) setPolitoShowWeek(!!r.data.showInWeek);
      if (r.data?.showInMonth !== undefined) setPolitoShowMonth(!!r.data.showInMonth);
      if (r.data?.showInDay !== undefined) setPolitoShowDay(!!r.data.showInDay);
      if (r.data?.colorMap) setPolitoColorMap(r.data.colorMap);
      if (r.data?.username) setPolitoUser(r.data.username);
    } catch { /* API non raggiungibile: sezione mostrata comunque */ }
  }

  async function loadSettings() {
    try {
      // Load from props if available (already fetched), otherwise fetch from API
      if (settings && Object.keys(settings).length > 0) {
        applySettings(settings);
      } else {
        const response = await api.get('/settings');
        applySettings(response.data);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  function applySettings(data: any) {
    setTheme(data.theme || 'auto');
    setDefaultView(data.defaultView || 'week');
    setLayoutMode(data.layoutMode || 'card');
    setSidebarWidth(data.sidebarWidth || 280);
    setCalendarSlotHeight(data.calendarSlotHeight || 48);
    setDaySlotHeight(data.daySlotHeight || 60);
    setMonthCellMinHeight(data.monthCellMinHeight || 120);
    setContentMaxWidth(data.contentMaxWidth || null);
    setCardWidthPercent(data.cardWidthPercent ?? 90);
    setCardHeightPercent(data.cardHeightPercent ?? 85);
    setCardMaxWidth(data.cardMaxWidth ?? 1200);
    setAutoFit(data.autoFit ?? true);
    setCategoryColors({ ...DEFAULT_CATEGORY_COLORS, ...(data.categoryColors || {}) });
    setEventTextMode(data.eventTextMode || 'auto');
    setEventOpacity(clampOpacity(data.eventOpacity ?? DEFAULT_EVENT_OPACITY));
    setTaskDeadlineColor(data.taskDeadlineColor || DEFAULT_TASK_DEADLINE_COLOR);
    const cf = data.calendarFilters || {};
    if (cf.showEvents !== undefined) setFShowEvents(!!cf.showEvents);
    if (cf.showTasks !== undefined) setFShowTasks(!!cf.showTasks);
    if (cf.showCompletedTasks !== undefined) setFShowCompleted(!!cf.showCompletedTasks);
    if (cf.showAllDay !== undefined) setFShowAllDay(!!cf.showAllDay);
    if ((cf as any).showDeadlines !== undefined) setFShowDeadlines(!!(cf as any).showDeadlines);
    if (cf.showPolito !== undefined) setFShowPolito(!!cf.showPolito);
    if (cf.visibilityFilter) setFVisibility(cf.visibilityFilter);

    if (data.cloudProviders?.gemini?.configured) {
      setGeminiKey('***configured***');
    }
    if (data.cloudProviders?.openrouter?.configured) {
      setOpenrouterKey('***configured***');
    }
    if (data.ollama) {
      setOllamaUrl(data.ollama.baseUrl || 'http://localhost:11434');
      setOllamaModel(data.ollama.model || '');
    }
    if ((data as any).local) {
      setLocalUrl((data as any).local.baseUrl || 'http://localhost:11434/v1');
      setLocalModel((data as any).local.model || '');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      const updates: any = {
        theme,
        defaultView,
        layoutMode,
        sidebarWidth,
        calendarSlotHeight,
        daySlotHeight,
        monthCellMinHeight,
        contentMaxWidth,
        cardWidthPercent,
        cardHeightPercent,
        cardMaxWidth,
        autoFit,
        categoryColors,
        eventTextMode,
        eventOpacity: clampOpacity(eventOpacity),
        taskDeadlineColor,
        calendarFilters: {
          showEvents: fShowEvents,
          showTasks: fShowTasks,
          showCompletedTasks: fShowCompleted,
          showAllDay: fShowAllDay,
          showDeadlines: fShowDeadlines,
          showPolito: fShowPolito,
          visibilityFilter: fVisibility,
        },
      };

      if (geminiKey && geminiKey !== '***configured***') {
        updates.cloudProviders = updates.cloudProviders || {};
        updates.cloudProviders.gemini = {
          apiKey: geminiKey,
          enabled: true,
        };
      }

      if (openrouterKey && openrouterKey !== '***configured***') {
        updates.cloudProviders = updates.cloudProviders || {};
        updates.cloudProviders.openrouter = {
          apiKey: openrouterKey,
          enabled: true,
        };
      }

      if (ollamaModel) {
        updates.ollama = {
          baseUrl: ollamaUrl,
          model: ollamaModel,
        };
      }

      if (localModel || localUrl) {
        updates.local = {
          baseUrl: localUrl,
          model: localModel,
          apiKey: localKey || undefined,
        };
      }

      await api.put('/settings', updates);
      setMessage('✓ Impostazioni salvate con successo');
      setTimeout(() => setMessage(''), 3000);
      onSave();
    } catch (error) {
      setMessage('✗ Errore nel salvataggio');
      console.error('Failed to save settings:', error);
    }
  }

  /* ===== PoliTO ===== */

  async function politoLogin() {
    setPolitoBusy(true); setPolitoMsg('');
    try {
      // Password già salvata + campo vuoto: niente nuovo login, solo sync con il token/credenziali esistenti
      if (!politoPass && politoStatus?.passwordSet) {
        const r = await api.post('/polito/sync', {});
        setPolitoMsg(r.data.ok
          ? `✓ Sync ok: +${r.data.added} ~${r.data.updated} -${r.data.removed} (${r.data.total} totali)`
          : `✗ ${r.data.error}`);
        await loadPolitoStatus();
        onSave();
        return;
      }
      const r = await api.post('/polito/login', { username: politoUser, password: politoPass });
      setPolitoPass('');
      const s = r.data?.sync;
      setPolitoMsg(s?.ok
        ? `✓ Collegato. ${s.added} nuove, ${s.updated} aggiornate, ${s.total} lezioni totali.`
        : `✓ Collegato, ma sync: ${r.data?.sync?.error || 'n/d'}`);
      await loadPolitoStatus();
    } catch (e: any) {
      const data = e?.response?.data;
      setPolitoMsg(`✗ ${data?.error || 'Login fallito'}`);
      if (data?.mfaRequired) setPolitoMsg((m) => `${m} (account con MFA: non supportato)`);
    } finally { setPolitoBusy(false); }
  }

  async function politoSyncNow() {
    setPolitoBusy(true); setPolitoMsg('');
    try {
      const r = await api.post('/polito/sync', {});
      setPolitoMsg(r.data.ok
        ? `✓ Sync ok: +${r.data.added} ~${r.data.updated} -${r.data.removed} (${r.data.total} totali)`
        : `✗ ${r.data.error}`);
      await loadPolitoStatus();
      onSave(); // ricarica gli item nel calendario
    } catch (e: any) {
      setPolitoMsg(`✗ ${e?.response?.data?.error || 'Sync fallito'}`);
    } finally { setPolitoBusy(false); }
  }

  async function politoLogout() {
    setPolitoBusy(true); setPolitoMsg('');
    try {
      await api.post('/polito/logout', {});
      setPolitoMsg('✓ Disconnesso: credenziali e lezioni rimosse.');
      setPolitoPass('');
      await loadPolitoStatus();
      onSave();
    } catch (e: any) {
      setPolitoMsg(`✗ ${e?.response?.data?.error || 'Logout fallito'}`);
    } finally { setPolitoBusy(false); }
  }

  /** Salva le impostazioni PoliTO (visibilità, intervalli, colori) senza toccare le credenziali. */
  async function politoSaveOptions() {
    try {
      await api.patch('/polito/settings', {
        enabled: politoEnabled,
        syncIntervalMin: politoSyncMin,
        windowDays: politoWindowDays,
        showInWeek: politoShowWeek,
        showInMonth: politoShowMonth,
        showInDay: politoShowDay,
        colorMap: politoColorMap,
      });
      setPolitoMsg('✓ Impostazioni PoliTO salvate.');
      setTimeout(() => setPolitoMsg(''), 3000);
      onSave();
    } catch (e: any) {
      setPolitoMsg(`✗ ${e?.response?.data?.error || 'Salvataggio fallito'}`);
    }
  }

  return (
    <div className={styles.container}>
      <h2>Impostazioni</h2>

      <form className={styles.form} onSubmit={handleSave}>
        {/* Basic Settings */}
        <section className={styles.section}>
          <h3>Impostazioni Generali</h3>

          <div className={styles.formGroup}>
            <label>Tema</label>
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="light">Chiaro</option>
              <option value="dark">Scuro</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Visualizzazione Predefinita</label>
            <select value={defaultView} onChange={(e) => setDefaultView(e.target.value as any)}>
              <option value="month">Mese</option>
              <option value="week">Settimana</option>
              <option value="day">Giorno</option>
            </select>
          </div>
        </section>

        {/* Visibilità calendario: selezionabile e salvabile */}
        <section className={styles.section}>
          <h3>👁️ Visibilità Calendario</h3>
          <p className={styles.hint}>
            Scegli cosa mostrare nelle viste Mese / Settimana / Giorno / Agenda.
            Viene salvato con “Salva Impostazioni” e ritrovato al prossimo accesso.
          </p>
          <div className={styles.formGroup}>
            <label>Visibilità evento</label>
            <select value={fVisibility} onChange={(e) => setFVisibility(e.target.value)}>
              <option value="all">Tutte</option>
              <option value="default">Default</option>
              <option value="public">Pubblica</option>
              <option value="private">Privata</option>
              <option value="confidential">Riservata</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <label className={styles.toggleTasks}>
              <input type="checkbox" checked={fShowEvents} onChange={(e) => setFShowEvents(e.target.checked)} /> Eventi
            </label>
            <label className={styles.toggleTasks}>
              <input type="checkbox" checked={fShowTasks} onChange={(e) => setFShowTasks(e.target.checked)} /> Task
            </label>
            <label className={styles.toggleTasks}>
              <input type="checkbox" checked={fShowCompleted} onChange={(e) => setFShowCompleted(e.target.checked)} /> Task completati
            </label>
            <label className={styles.toggleTasks}>
              <input type="checkbox" checked={fShowAllDay} onChange={(e) => setFShowAllDay(e.target.checked)} /> Tutto il giorno
            </label>
            <label className={styles.toggleTasks}>
              <input type="checkbox" checked={fShowDeadlines} onChange={(e) => setFShowDeadlines(e.target.checked)} /> Scadenze task
            </label>
            <label className={styles.toggleTasks}>
              <input type="checkbox" checked={fShowPolito} onChange={(e) => setFShowPolito(e.target.checked)} /> Lezioni PoliTO
            </label>
          </div>
        </section>

        {/* Layout Settings */}
        <section className={styles.section}>
          <h3>📐 Layout e Dimensioni</h3>
          <p className={styles.hint}>
            Personalizza l'aspetto del calendario per farlo stare perfettamente nel tuo schermo.
          </p>

          <div className={styles.formGroup}>
            <label>Modalità Layout</label>
            <select value={layoutMode} onChange={(e) => setLayoutMode(e.target.value as any)}>
              <option value="card">🃏 Card (calendario in una card % dello schermo)</option>
              <option value="scroll">Scroll (il calendario si adatta verticalmente)</option>
              <option value="fit">Fit (il calendario si riduce per stare nella pagina)</option>
            </select>
            <small>
              {layoutMode === 'card' ? 'Il calendario sta dentro una card centrata, grande n% dello schermo, e mostra sempre tutti i giorni.' : layoutMode === 'scroll' ? 'Il calendario è scrollabile se necessario.' : 'Il calendario si adatta automaticamente alla dimensione della finestra.'}
            </small>
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label>Larghezza Sidebar (px)</label>
              <input
                type="number"
                min="200"
                max="500"
                value={sidebarWidth}
                onChange={(e) => setSidebarWidth(Number(e.target.value))}
              />
              <small>Larghezza del menu laterale sinistro</small>
            </div>

            <div className={styles.formGroup}>
              <label>Contenuto Max Width (px)</label>
              <input
                type="number"
                min="600"
                max="2000"
                placeholder="Nessuno (pieno schermo)"
                value={contentMaxWidth || ''}
                onChange={(e) => setContentMaxWidth(e.target.value ? Number(e.target.value) : null)}
              />
              <small>Larghezza massima dell'area contenuto (lascia vuoto per pieno schermo)</small>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>Altezza Minima Celle Mese (px)</label>
            <input
              type="number"
              min="60"
              max="300"
              value={monthCellMinHeight}
              onChange={(e) => setMonthCellMinHeight(Number(e.target.value))}
            />
            <small>Altezza base di ogni cella nel calendario mensile</small>
          </div>

          <div className={styles.formGroup}>
            <label>Altezza Slot Settimana (px per 30 min)</label>
            <input
              type="number"
              min="30"
              max="120"
              value={calendarSlotHeight}
              onChange={(e) => setCalendarSlotHeight(Number(e.target.value))}
            />
            <small>Altezza di ogni slot orario nella vista settimanale</small>
          </div>

          <div className={styles.formGroup}>
            <label>Altezza Slot Giorno (px per 30 min)</label>
            <input
              type="number"
              min="30"
              max="150"
              value={daySlotHeight}
              onChange={(e) => setDaySlotHeight(Number(e.target.value))}
            />
            <small>Altezza di ogni slot nella vista giornaliera (più grande per dettagli)</small>
          </div>
        </section>

        {/* Card Mode Settings */}
        {layoutMode === 'card' && (
        <section className={styles.section}>
          <h3>🃏 Dimensioni Card Calendario (n% dello schermo)</h3>
          <p className={styles.hint}>La card contiene il calendario e mostra SEMPRE tutti i giorni della vista, senza scroll esterno.</p>
          <div className={styles.formGroup}>
            <label>Larghezza Card: {cardWidthPercent}%</label>
            <input type="range" min="50" max="100" value={cardWidthPercent} onChange={(e) => setCardWidthPercent(Number(e.target.value))} />
          </div>
          <div className={styles.formGroup}>
            <label>Altezza Card: {cardHeightPercent}%</label>
            <input type="range" min="50" max="100" value={cardHeightPercent} onChange={(e) => setCardHeightPercent(Number(e.target.value))} />
          </div>
          <div className={styles.formGroup}>
            <label>Max Width (px)</label>
            <input type="number" min="400" max="2000" placeholder="none" value={cardMaxWidth || ''} onChange={(e) => setCardMaxWidth(e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.checkbox}>
              <input type="checkbox" checked={autoFit} onChange={(e) => setAutoFit(e.target.checked)} />
              <span>Auto-fit: adatta celle/slot per mostrare tutto dentro la card</span>
            </label>
          </div>
        </section>
        )}

        {/* AI Providers */}
        <section className={styles.section}>
          <h3>Provider AI</h3>

          <div className={styles.formGroup}>
            <label>Gemini API Key</label>
            <input
              type="password"
              placeholder="Inserisci la tua chiave Gemini"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              disabled={geminiKey === '***configured***'}
            />
            {geminiKey === '***configured***' && (
              <small>✓ Gemini è configurato</small>
            )}
          </div>

          <div className={styles.formGroup}>
            <label>OpenRouter API Key</label>
            <input
              type="password"
              placeholder="Inserisci la tua chiave OpenRouter"
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
              disabled={openrouterKey === '***configured***'}
            />
            {openrouterKey === '***configured***' && (
              <small>✓ OpenRouter è configurato</small>
            )}
          </div>
        </section>

        {/* Ollama Local */}
        <section className={styles.section}>
          <h3>Ollama (IA Locale)</h3>
          <p className={styles.hint}>
            Configura Ollama per usare modelli di IA locali. Scarica Ollama da{' '}
            <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer">
              ollama.ai
            </a>
          </p>

          <div className={styles.formGroup}>
            <label>URL Ollama</label>
            <input
              type="text"
              placeholder="http://localhost:11434"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Modello Ollama</label>
            <input
              type="text"
              placeholder="es: mistral, neural-chat, phi"
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
            />
            <small>
              Modelli consigliati per 5-6GB VRAM: mistral, neural-chat, phi, orca-mini
            </small>
          </div>
        </section>

        {/* Modello locale OpenAI-compatibile (Bionic, LM Studio, Ollama /v1...) */}
        <section className={styles.section}>
          <h3>Modello locale (Bionic / LM Studio / Ollama OpenAI)</h3>
          <p className={styles.hint}>
            Endpoint OpenAI-compatibile, es: Bionic di solito espone
            http://localhost:PORT/v1 — controlla la porta nella dashboard di Bionic.
          </p>

          <div className={styles.formGroup}>
            <label>Base URL (OpenAI-compatibile)</label>
            <input
              type="text"
              placeholder="http://localhost:11434/v1"
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Nome modello (es: qwen3:1.7b, qwen2.5:3b)</label>
            <input
              type="text"
              placeholder="es: qwen3:1.7b"
              value={localModel}
              onChange={(e) => setLocalModel(e.target.value)}
            />
            <small>
              Qwen3 1.7B: leggero ma con tool-calling limitato. Se i tool non scattano,
              tieni Gemini per l'AI e usa il locale per la chat semplice.
            </small>
          </div>

          <div className={styles.formGroup}>
            <label>API Key locale (se richiesta, altrimenti lascia vuoto)</label>
            <input
              type="password"
              placeholder="solo se Bionic la richiede"
              value={localKey}
              onChange={(e) => setLocalKey(e.target.value)}
            />
          </div>
        </section>

        {/* Colori eventi per categoria + colore testo */}
        <section className={styles.section}>
          <h3>🎨 Colori Eventi</h3>
          <p className={styles.hint}>
            Scegli il colore di ogni tipologia di evento. Il colore delle lezioni PoliTO si gestisce
            per singolo corso nella sezione PoliTO qui sotto.
          </p>

          <div className={styles.formGroup}>
            <label>Colore per tipologia</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '.5rem' }}>
              {[...EDITABLE_CATEGORIES, 'lesson', 'exercise', 'exam'].map((cat) => {
                const color = categoryColors[cat] || DEFAULT_CATEGORY_COLORS[cat] || '#64748b';
                const preview = categoryGradient(cat, { [cat]: color });
                const fg = eventTextColor(preview, eventTextMode);
                const isPolitoType = ['lesson', 'exercise', 'exam'].includes(cat);
                const subtitle = isPolitoType ? 'eventi manuali (sync PoliTO = colore corso)' : color;
                return (
                  <div key={cat} style={colorRowStyle}>
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setCategoryColors((m) => ({ ...m, [cat]: e.target.value }))}
                      style={colorInputStyle}
                      aria-label={`Colore categoria ${cat}`}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.85rem', fontWeight: 600 }}>{CATEGORY_LABELS[cat]}</div>
                      <div style={{ fontSize: '.7rem', color: 'var(--gray-500)' }}>{subtitle}</div>
                    </div>
                    <div style={{ ...previewStyle, background: preview, color: fg }}>Anteprima</div>
                  </div>
                );
              })}
            </div>
            <small>
              Le categorie Lezione/Esercitazione/Esame valgono per gli eventi creati a mano: le lezioni
              sincronizzate da PoliTO usano invece il colore del corso.
            </small>
          </div>

          <div className={styles.formGroup}>
            <label>Colore del testo sugli eventi</label>
            <select value={eventTextMode} onChange={(e) => setEventTextMode(e.target.value as EventTextMode)}>
              <option value="auto">Automatico (testo scuro su sfondi chiari, bianco su sfondi scuri)</option>
              <option value="light">Sempre bianco</option>
              <option value="dark">Sempre nero</option>
            </select>
            <small>Con &quot;Automatico&quot; il testo resta leggibile anche con colori chiari (es. corsi PoliTO chiari).</small>
          </div>

          <div className={styles.formGroup}>
            <label>Opacità eventi: {Math.round(clampOpacity(eventOpacity) * 100)}%</label>
            <input type="range" min="20" max="100" step="5"
              value={Math.round(clampOpacity(eventOpacity) * 100)}
              onChange={(e) => setEventOpacity(clampOpacity(Number(e.target.value) / 100))} />
            <small>Rende gli eventi più o meno trasparenti nel calendario (20% = molto trasparente, 100% = pieno).</small>
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '.4rem', alignItems: 'center' }}>
              <div style={{ ...previewStyle, background: categoryGradient('work', categoryColors), color: eventTextColor(categoryGradient('work', categoryColors), eventTextMode), opacity: clampOpacity(eventOpacity) }}>Evento</div>
              <div style={{ ...previewStyle, background: taskDeadlineGradient(taskDeadlineColor), color: '#0f172a', opacity: clampOpacity(eventOpacity), borderLeft: `4px double ${taskDeadlineColor}`, borderRadius: '4px 10px 10px 4px' }}>⏳ Scadenza</div>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>Colore scadenza task</label>
            <div style={colorRowStyle}>
              <input type="color" value={taskDeadlineColor}
                onChange={(e) => setTaskDeadlineColor(e.target.value)}
                style={colorInputStyle} aria-label="Colore scadenza task" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.85rem', fontWeight: 600 }}>Scadenza task</div>
                <div style={{ fontSize: '.7rem', color: 'var(--gray-500)' }}>Nuova forma dedicata: angoli asimmetrici + bordo doppio + ⏳ (solo task non completati)</div>
              </div>
              <div style={{ ...previewStyle, background: taskDeadlineGradient(taskDeadlineColor), color: '#0f172a', borderLeft: `4px double ${taskDeadlineColor}`, borderRadius: '4px 10px 10px 4px' }}>⏳ {taskDeadlineColor}</div>
            </div>
            <small>Colore usato per evidenziare le scadenze dei task in mese/settimana/giorno e nella legenda.</small>
          </div>

          <button
            type="button"
            onClick={() => setCategoryColors({ ...DEFAULT_CATEGORY_COLORS })}
            className={styles.submitButton}
            style={{ padding: '.5rem 1rem', fontSize: '.85rem', background: '#475569' }}
          >
            ↺ Ripristina colori predefiniti
          </button>
          <small style={{ display: 'block', marginTop: '.4rem' }}>
            Ricorda di premere &quot;Salva Impostazioni&quot; in fondo per applicare le modifiche.
          </small>
        </section>

        {/* PoliTO - Calendario lezioni */}
        <section className={styles.section}>
          <h3>🎓 PoliTO — Orario lezioni</h3>
          <p className={styles.hint}>
            Collega il tuo account PoliTO per sincronizzare automaticamente lezioni ed esercitazioni
            dall'API ufficiale (app.didattica.polito.it). Le credenziali restano solo in data.json su questo server.
            {politoStatus?.configured && <> Account: <strong>{politoStatus.username}</strong>.</>}
            {politoStatus?.lastSyncAt && <> Ultimo sync: {new Date(politoStatus.lastSyncAt).toLocaleString('it-IT')}.</>}
            {politoStatus?.lessonCount > 0 && <> {politoStatus.lessonCount} lezioni salvate ({(politoStatus.courses || []).length} corsi).</>}
          </p>

          <div className={styles.formGroup}>
            <label>Matricola / username PoliTO</label>
            <input type="text" placeholder="es. s123456" value={politoUser}
              onChange={(e) => setPolitoUser(e.target.value)} autoComplete="username" />
          </div>

          <div className={styles.formGroup}>
            <label>Password PoliTO {politoStatus?.passwordSet && <small>(già salvata — lascia vuoto per mantenerla)</small>}</label>
            <input type="password" placeholder={politoStatus?.passwordSet ? '••••••••' : 'password del portale'}
              value={politoPass} onChange={(e) => setPolitoPass(e.target.value)} autoComplete="current-password" />
          </div>

          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
            <button type="button" onClick={politoLogin} disabled={politoBusy || !politoUser || (!politoPass && !politoStatus?.passwordSet)}
              className={styles.submitButton} style={{ padding: '.5rem 1rem', fontSize: '.85rem' }}>
              {politoBusy ? 'Attendi…' : ' Collegati e sincronizza'}
            </button>
            <button type="button" onClick={politoSyncNow} disabled={politoBusy || !politoStatus?.configured}
              className={styles.submitButton} style={{ padding: '.5rem 1rem', fontSize: '.85rem', background: '#0f766e' }}>
              ⟳ Sync ora
            </button>
            <button type="button" onClick={politoLogout} disabled={politoBusy || !politoStatus?.configured}
              className={styles.submitButton} style={{ padding: '.5rem 1rem', fontSize: '.85rem', background: '#b91c1c' }}>
              Disconnetti
            </button>
          </div>

          {politoMsg && (
            <div className={`${styles.message} ${politoMsg.startsWith('✓') ? styles.success : styles.error}`}>
              {politoMsg}
            </div>
          )}
          {politoStatus?.lastError && !politoMsg && (
            <div className={`${styles.message} ${styles.error}`}>Ultimo errore: {politoStatus.lastError}</div>
          )}

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>Sincronizza ogni (minuti)</label>
              <input type="number" min="5" max="1440" value={politoSyncMin}
                onChange={(e) => setPolitoSyncMin(Number(e.target.value))} />
              <small>Frequenza del sync automatico</small>
            </div>
            <div className={styles.formGroup}>
              <label>Finestra (giorni futuri)</label>
              <input type="number" min="7" max="120" value={politoWindowDays}
                onChange={(e) => setPolitoWindowDays(Number(e.target.value))} />
              <small>Quanti giorni avanti sincronizzare</small>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>Visibilità nelle viste</label>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <label className={styles.toggleTasks}>
                <input type="checkbox" checked={politoShowWeek} onChange={(e) => setPolitoShowWeek(e.target.checked)} /> Settimana
              </label>
              <label className={styles.toggleTasks}>
                <input type="checkbox" checked={politoShowMonth} onChange={(e) => setPolitoShowMonth(e.target.checked)} /> Mese
              </label>
              <label className={styles.toggleTasks}>
                <input type="checkbox" checked={politoShowDay} onChange={(e) => setPolitoShowDay(e.target.checked)} /> Giorno
              </label>
              <label className={styles.toggleTasks}>
                <input type="checkbox" checked={politoEnabled} onChange={(e) => setPolitoEnabled(e.target.checked)} /> Sync attivo
              </label>
            </div>
          </div>

          {(politoStatus?.courses || []).length > 0 && (
            <div className={styles.formGroup}>
              <label>Colori per corso (legenda)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                {politoStatus.courses.map((c: string) => (
                  <div key={c} style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                    <input type="color" value={politoColorMap[c] || '#4f46e5'}
                      onChange={(e) => setPolitoColorMap((m) => ({ ...m, [c]: e.target.value }))}
                      style={{ width: 42, height: 28, padding: 0, border: 'none', background: 'none' }} />
                    <span style={{ fontSize: '.82rem' }}>{c}</span>
                  </div>
                ))}
              </div>
              <small>Cambia colore e salva le opzioni PoliTO qui sotto</small>
            </div>
          )}

          <button type="button" onClick={politoSaveOptions} className={styles.submitButton}
            style={{ padding: '.5rem 1rem', fontSize: '.85rem', background: '#4338ca' }}>
            💾 Salva opzioni PoliTO
          </button>
        </section>

        {/* Message */}
        {message && (
          <div className={`${styles.message} ${message.startsWith('✓') ? styles.success : styles.error}`}>
            {message}
          </div>
        )}

        {/* Submit */}
        <button type="submit" className={styles.submitButton}>
          💾 Salva Impostazioni
        </button>
      </form>
    </div>
  );
}
