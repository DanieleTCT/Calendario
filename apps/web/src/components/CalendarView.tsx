import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MonthView } from './calendar/MonthView';
import { WeekView } from './calendar/WeekView';
import { DayView } from './calendar/DayView';
import { NewEventModal } from './calendar/NewEventModal';
import { ItemDetailModal } from './calendar/ItemDetailModal';
import { Legend } from './calendar/Legend';
import { dateToString } from '../utils/dateUtils';
import { useApi } from '../hooks/useApi';
import { isPolito, legendCourses } from '../utils/politoColors';
import { EventTextMode, CATEGORY_LABELS, clampOpacity, DEFAULT_TASK_DEADLINE_COLOR } from '../utils/eventColors';
import styles from './CalendarView.module.css';

type ViewType = 'month' | 'week' | 'day' | 'agenda';

interface Props {
  items: any[];
  onItemsChange: () => void;
  settings?: any;
  currentDate: Date;
  onDateChange: (d: Date) => void;
  sidebarOpen?: boolean;
  onSidebarChange?: (open: boolean) => void;
}

function titleFor(view: ViewType, d: Date) {
  if (view === 'month') return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  if (view === 'agenda') return 'Agenda - prossimi 14 giorni';
  if (view === 'week') {
    const s = new Date(d); const day = (s.getDay() + 6) % 7; s.setDate(s.getDate() - day);
    const e = new Date(s); e.setDate(e.getDate() + 6);
    return `${s.getDate()} ${s.toLocaleDateString('it-IT', { month: 'short' })} – ${e.getDate()} ${e.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}`;
  }
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function CalendarView({ items, onItemsChange, settings, currentDate, onDateChange, sidebarOpen, onSidebarChange }: Props) {
  const api = useApi();
  const [view, setView] = useState<ViewType>(settings?.defaultView || 'month');
  const [showModal, setShowModal] = useState(false);
  const [selDate, setSelDate] = useState<string | null>(null);
  const [selTime, setSelTime] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  // Visibilità/filtri: selezionabili e salvabili (persistiti in settings.calendarFilters + localStorage)
  const LS_KEY = 'cal-filters-v1';
  function loadLocal(): any {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  const savedFilters = { ...(settings?.calendarFilters || {}), ...loadLocal() };
  const [showEvents, setShowEvents] = useState(savedFilters.showEvents ?? true);
  const [showTasks, setShowTasks] = useState(savedFilters.showTasks ?? true);
  const [showCompletedTasks, setShowCompletedTasks] = useState(savedFilters.showCompletedTasks ?? true);
  const [showAllDay, setShowAllDay] = useState(savedFilters.showAllDay ?? true);
  const [showDeadlines, setShowDeadlines] = useState((savedFilters as any).showDeadlines ?? true);
  const [visibilityFilter, setVisibilityFilter] = useState<string>(savedFilters.visibilityFilter || 'all');
  // Stato PoliTO: mostra/nascondi globale + corsi singoli nascosti
  const [showPolito, setShowPolito] = useState(savedFilters.showPolito ?? true);
  const [hiddenCourses, setHiddenCourses] = useState<Set<string>>(new Set(savedFilters.hiddenCourses || []));
  const [filtersDirty, setFiltersDirty] = useState(false);
  const [filtersSaved, setFiltersSaved] = useState(false);
  const saveTimer = useRef<any>(null);
  // Menu in alto collassabile: default QUASI TUTTO CHIUSO => calendario a schermo intero.
  // Ogni sezione è in-flow: aprendola RIDIMENSIONA il calendario, mai overlay.
  const PANELS_KEY = 'cal-panels-v1';
  const [openPanels, setOpenPanels] = useState<{ nav: boolean; filters: boolean; legend: boolean }>(() => {
    try {
      const raw = localStorage.getItem(PANELS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return { nav: !!p.nav, filters: !!p.filters, legend: !!p.legend };
      }
    } catch { /* noop */ }
    return { nav: true, filters: false, legend: false };
  });
  useEffect(() => {
    try { localStorage.setItem(PANELS_KEY, JSON.stringify(openPanels)); } catch { /* noop */ }
  }, [openPanels]);
  const sidebarControlled = onSidebarChange !== undefined;
  const sidebarIsOpen = sidebarOpen ?? false;
  const allOpen = openPanels.nav && openPanels.filters && openPanels.legend && (!sidebarControlled || sidebarIsOpen);
  const allClosed = !openPanels.nav && !openPanels.filters && !openPanels.legend && (!sidebarControlled || !sidebarIsOpen);
  function togglePanel(k: keyof typeof openPanels) {
    setOpenPanels((p) => ({ ...p, [k]: !p[k] }));
  }
  function setAllPanels(open: boolean) {
    setOpenPanels({ nav: open, filters: open, legend: open });
    // 'Espandi/Comprimi tutte' include anche la barra laterale sx (se controllata da App)
    if (sidebarControlled) onSidebarChange!(open);
  }

  const filtersSnapshot = useMemo(() => ({
    showEvents, showTasks, showCompletedTasks, showAllDay,
    showDeadlines, visibilityFilter, showPolito, hiddenCourses: [...hiddenCourses],
  }), [showEvents, showTasks, showCompletedTasks, showAllDay, showDeadlines, visibilityFilter, showPolito, hiddenCourses]);

  function markDirty() {
    setFiltersDirty(true);
    setFiltersSaved(false);
    try { localStorage.setItem(LS_KEY, JSON.stringify(filtersSnapshot)); } catch { /* noop */ }
  }

  // Sincronizza i filtri quando arrivano i settings dal server (solo se non modificati localmente)
  useEffect(() => {
    const cf = settings?.calendarFilters;
    if (!cf || filtersDirty) return;
    if (cf.showEvents !== undefined) setShowEvents(!!cf.showEvents);
    if (cf.showTasks !== undefined) setShowTasks(!!cf.showTasks);
    if (cf.showCompletedTasks !== undefined) setShowCompletedTasks(!!cf.showCompletedTasks);
    if (cf.showAllDay !== undefined) setShowAllDay(!!cf.showAllDay);
    if ((cf as any).showDeadlines !== undefined) setShowDeadlines(!!(cf as any).showDeadlines);
    if (cf.visibilityFilter) setVisibilityFilter(cf.visibilityFilter);
    if (cf.showPolito !== undefined) setShowPolito(!!cf.showPolito);
    if (Array.isArray(cf.hiddenCourses)) setHiddenCourses(new Set(cf.hiddenCourses));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.calendarFilters]);

  // Autosave debounced su localStorage ad ogni cambio (feedback immediato anche offline)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(filtersSnapshot)); } catch { /* noop */ }
    }, 300);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [filtersSnapshot]);

  async function saveFilters() {
    try {
      await api.put('/settings', {
        calendarFilters: {
          showEvents, showTasks, showCompletedTasks, showAllDay,
          showDeadlines, visibilityFilter, showPolito, hiddenCourses: [...hiddenCourses],
        },
      });
      try { localStorage.setItem(LS_KEY, JSON.stringify(filtersSnapshot)); } catch { /* noop */ }
      setFiltersDirty(false);
      setFiltersSaved(true);
      setTimeout(() => setFiltersSaved(false), 2500);
    } catch (e) {
      console.error('Salvataggio filtri fallito', e);
      try { localStorage.setItem(LS_KEY, JSON.stringify(filtersSnapshot)); } catch { /* noop */ }
    }
  }

  function resetFilters() {
    setShowEvents(true); setShowTasks(true); setShowCompletedTasks(true);
    setShowAllDay(true); setShowDeadlines(true); setVisibilityFilter('all');
    setShowPolito(true); setHiddenCourses(new Set());
    setFiltersDirty(true); setFiltersSaved(false);
  }

  const politoConf = settings?.polito;
  const colorMap: Record<string, string> = politoConf?.colorMap || {};
  const catColors: Record<string, string> = settings?.categoryColors || {};
  const textMode: EventTextMode = settings?.eventTextMode || 'auto';
  const eventOpacity = clampOpacity(settings?.eventOpacity ?? 1);
  const taskDeadlineColor: string = settings?.taskDeadlineColor || DEFAULT_TASK_DEADLINE_COLOR;
  const hasPolitoItems = useMemo(() => items.some((i) => isPolito(i)), [items]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = (e.target as HTMLElement)?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      if (e.key === 'm') setView('month');
      else if (e.key === 'w') setView('week');
      else if (e.key === 'd') setView('day');
      else if (e.key === 'a') setView('agenda');
      else if (e.key === 't') onDateChange(new Date());
      else if (e.key === 'Escape') { setSelectedItem(null); setShowModal(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => items.filter((i) => {
    if (!showEvents && i.type === 'event') return false;
    if (!showTasks && i.type === 'task') return false;
    // FIX scadenze task: i task senza orario hanno solo la data → non escluderli dalle viste
    // (la visibilità oraria è gestita dalle fasce "tutto il giorno"/scadenze, non dal filtro)
    if (i.type === 'task' && i.completed && !showCompletedTasks) return false;
    if (i.type === 'task' && !i.startTime && !showDeadlines) return false;
    // FIX impegni giornalieri: gli eventi allDay non hanno startTime → mai filtrarli qui
    if (i.allDay && !showAllDay) return false;
    if (visibilityFilter !== 'all' && (i.visibility || 'default') !== visibilityFilter) return false;
    if (catFilter !== 'all' && i.category !== catFilter) return false;
    if (search && !(`${i.title} ${i.description || ''}`.toLowerCase().includes(search.toLowerCase()))) return false;
    if (isPolito(i)) {
      if (!showPolito) return false;
      if (hiddenCourses.has(i.polito?.courseName || i.title)) return false;
      // Rispetta la visibilità per vista configurata in Impostazioni > PoliTO
      if (view === 'week' && politoConf?.showInWeek === false) return false;
      if (view === 'month' && politoConf?.showInMonth === false) return false;
      if (view === 'day' && politoConf?.showInDay === false) return false;
    }
    return true;
  }), [items, showEvents, showTasks, showCompletedTasks, showAllDay, showDeadlines, visibilityFilter, catFilter, search, showPolito, hiddenCourses, view, politoConf]);

  const events = useMemo(() => filtered.filter((i) => i.type === 'event'), [filtered]);
  const todayCount = useMemo(() => events.filter((e) => e.date === dateToString(new Date())).length, [events]);
  const openTasks = useMemo(() => items.filter((i) => i.type === 'task' && !i.completed).length, [items]);
  const legend = useMemo(() => legendCourses(filtered, colorMap), [filtered, colorMap]);

  function toggleCourse(name: string) {
    setHiddenCourses((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    markDirty();
  }

  function onTogglePolito() {
    setShowPolito((v: boolean) => !v);
    // markDirty usa lo snapshot precedente: forza il flag + persistenza locale immediata
    setFiltersDirty(true); setFiltersSaved(false);
  }

  const agenda = useMemo(() => {
    const out: { date: string; list: any[] }[] = [];
    const base = new Date();
    for (let k = 0; k < 14; k++) {
      const d = new Date(base); d.setDate(d.getDate() + k);
      const ds = dateToString(d);
      const list = filtered.filter((i) => i.date === ds)
        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      out.push({ date: ds, list });
    }
    return out;
  }, [filtered]);

  function shift(dir: 1 | -1) {
    const n = new Date(currentDate);
    if (view === 'month') n.setMonth(n.getMonth() + dir);
    else if (view === 'week') n.setDate(n.getDate() + dir * 7);
    else n.setDate(n.getDate() + dir);
    onDateChange(n);
  }
  function openNew(date?: string, time?: string) {
    setSelDate(date || dateToString(currentDate));
    setSelTime(time || null);
    setShowModal(true);
  }

  return (
    <div className={styles.shell}>
      <div className={styles.panelToggleBar}>
        <div className={styles.panelToggleGroup}>
          <button type="button" className={`${styles.panelToggle} ${openPanels.nav ? styles.panelOn : ''}`}
            onClick={() => togglePanel('nav')} aria-expanded={openPanels.nav} title="Navigazione e viste">
            {openPanels.nav ? '▾' : '▸'} Navigazione
          </button>
          <button type="button" className={`${styles.panelToggle} ${openPanels.filters ? styles.panelOn : ''}`}
            onClick={() => togglePanel('filters')} aria-expanded={openPanels.filters} title="Ricerca e filtri">
            {openPanels.filters ? '▾' : '▸'} Filtri
          </button>
          <button type="button" className={`${styles.panelToggle} ${openPanels.legend ? styles.panelOn : ''}`}
            onClick={() => togglePanel('legend')} aria-expanded={openPanels.legend} title="Legenda PoliTO">
            {openPanels.legend ? '▾' : '▸'} Legenda
          </button>
        </div>
        <button type="button" className={styles.panelToggle} onClick={() => setAllPanels(!allOpen)}
          title={allOpen ? 'Comprimi tutte' : 'Espandi tutte'}>
          {allOpen ? 'Comprimi tutte' : 'Espandi tutte'}
        </button>
      </div>
      <div className={`${styles.collapsible} ${openPanels.nav ? styles.expanded : styles.collapsed}`}>
      <div className={styles.topbar}>
        <div className={styles.titleBlock}>
          <div className={styles.navGroup}>
            <button className={styles.arrowBtn} onClick={() => shift(-1)} aria-label="Precedente">‹</button>
            <button className={styles.todayBtn} onClick={() => onDateChange(new Date())}>Oggi</button>
            <button className={styles.arrowBtn} onClick={() => shift(1)} aria-label="Successivo">›</button>
          </div>
          <div>
            <div className={styles.title}>{titleFor(view, currentDate)}</div>
            <div className={styles.sub}>{todayCount} eventi oggi · {events.length} eventi · {openTasks} task aperti</div>
          </div>
        </div>
        <div className={styles.actions}>
          <div className={styles.segmented}>
            <button className={`${styles.segBtn} ${view === 'month' ? styles.active : ''}`} onClick={() => setView('month')}>Mese</button>
            <button className={`${styles.segBtn} ${view === 'week' ? styles.active : ''}`} onClick={() => setView('week')}>Settimana</button>
            <button className={`${styles.segBtn} ${view === 'day' ? styles.active : ''}`} onClick={() => setView('day')}>Giorno</button>
            <button className={`${styles.segBtn} ${view === 'agenda' ? styles.active : ''}`} onClick={() => setView('agenda')}>Agenda</button>
          </div>
          <button className={styles.newBtn} onClick={() => openNew()}>+ Nuovo evento</button>
        </div>
      </div>
      </div>

      <div className={`${styles.collapsible} ${openPanels.filters ? styles.expanded : styles.collapsed}`}>
      <div className={styles.filterbar}>
        <input className={styles.searchInput} placeholder="Cerca..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={styles.catSelect} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">Tutte le categorie</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select className={styles.catSelect} value={visibilityFilter} title="Filtra per visibilità evento"
          onChange={(e) => { setVisibilityFilter(e.target.value); markDirty(); }}>
          <option value="all">Visibilità: tutte</option>
          <option value="default">Default</option>
          <option value="public">Pubblica</option>
          <option value="private">Privata</option>
          <option value="confidential">Riservata</option>
        </select>
        <label className={styles.toggleTasks}>
          <input type="checkbox" checked={showEvents} onChange={(e) => { setShowEvents(e.target.checked); markDirty(); }} /> Eventi
        </label>
        <label className={styles.toggleTasks}>
          <input type="checkbox" checked={showTasks} onChange={(e) => { setShowTasks(e.target.checked); markDirty(); }} /> Task
        </label>
        <label className={styles.toggleTasks} title="Mostra i task completati">
          <input type="checkbox" checked={showCompletedTasks} onChange={(e) => { setShowCompletedTasks(e.target.checked); markDirty(); }} /> Completati
        </label>
        <label className={styles.toggleTasks} title="Mostra gli impegni di tutto il giorno">
          <input type="checkbox" checked={showAllDay} onChange={(e) => { setShowAllDay(e.target.checked); markDirty(); }} /> Tutto il giorno
        </label>
        <label className={styles.toggleTasks} title="Mostra le scadenze dei task (senza orario)">
          <input type="checkbox" checked={showDeadlines} onChange={(e) => { setShowDeadlines(e.target.checked); markDirty(); }} /> Scadenze
        </label>
        <button type="button" className={styles.todayBtn} onClick={saveFilters} title="Salva la visibilità scelta nelle impostazioni">
          {filtersSaved ? '✓ Salvato' : '💾 Salva vista'}
        </button>
        <button type="button" className={styles.arrowBtn} onClick={resetFilters} title="Ripristina tutte le visibilità">↺</button>
      </div>
      </div>

      {hasPolitoItems && (
        <div className={`${styles.collapsible} ${openPanels.legend ? styles.expanded : styles.collapsed}`}>
        <Legend
          courses={legend}
          hidden={hiddenCourses}
          onToggleCourse={toggleCourse}
          showPolito={showPolito}
          onToggleShow={onTogglePolito}
          taskDeadlineColor={taskDeadlineColor}
        />
        </div>
      )}

      <div className={styles.body}>
        {view === 'month' && <MonthView currentDate={currentDate} events={filtered} onDateClick={(d) => openNew(d)} onDayOpen={(d) => { onDateChange(new Date(d + 'T12:00:00')); setView('day'); }} onEventClick={setSelectedItem} colorMap={colorMap} catColors={catColors} textMode={textMode} opacity={eventOpacity} taskDeadlineColor={taskDeadlineColor} />}
        {view === 'week' && <WeekView currentDate={currentDate} events={filtered} onTimeSlotClick={(d, t) => openNew(d, t)} onEventClick={setSelectedItem} colorMap={colorMap} catColors={catColors} textMode={textMode} opacity={eventOpacity} taskDeadlineColor={taskDeadlineColor} />}
        {view === 'day' && <DayView currentDate={currentDate} events={filtered} onTimeSlotClick={(d, t) => openNew(d, t)} onEventClick={setSelectedItem} colorMap={colorMap} catColors={catColors} textMode={textMode} opacity={eventOpacity} taskDeadlineColor={taskDeadlineColor} />}
        {view === 'agenda' && (
          <div className={styles.agenda}>
            {agenda.map((g) => (
              <div key={g.date} className={styles.agendaDay}>
                <div className={styles.agendaHead}>
                  <strong>{new Date(g.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' })}</strong>
                  <span>{g.list.length} attivita</span>
                </div>
                {g.list.length === 0 ? <div className={styles.agendaEmpty}>libero</div> : g.list.map((it) => (
                  <button key={it.id} className={`${styles.agendaItem} ${it.completed ? styles.agendaDone : ''}`} onClick={() => setSelectedItem(it)}>
                    <span className={styles.agendaTime}>{it.startTime ? `${it.startTime}${it.endTime ? `-${it.endTime}` : ''}` : '--:--'}</span>
                    <span className={styles.agendaTitle}>{it.type === 'task' ? (it.completed ? '[x] ' : '[ ] ') : ''}{it.title}</span>
                    <span className={styles.agendaCat}>{it.category}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && selDate && (
        <NewEventModal date={selDate} time={selTime} onClose={() => setShowModal(false)} onSave={() => { setShowModal(false); onItemsChange(); }} />
      )}
      {selectedItem && (
        <ItemDetailModal item={selectedItem} onClose={() => setSelectedItem(null)}
          onSave={() => { setSelectedItem(null); onItemsChange(); }} />
      )}
    </div>
  );
}
