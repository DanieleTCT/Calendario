import React, { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from './components/DashboardLayout';
import { SettingsPanel } from './components/SettingsPanel';
import { CalendarView } from './components/CalendarView';
import { TasksPanel } from './components/TasksPanel';
import { AIAssistant } from './components/AIAssistant';
import { useApi } from './hooks/useApi';
import styles from './App.module.css';

export default function App() {
  const [view, setView] = useState<'calendar' | 'tasks' | 'settings' | 'chat'>('calendar');
  const [currentDate, setCurrentDate] = useState(new Date());
  const api = useApi();
  const [items, setItems] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Sidebar collassabile: default CHIUSA => calendario quasi a schermo intero.
  // Si apre come pannello in-flow che RIDIMENSIONA il calendario (mai overlay).
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('sidebar-open-v1') === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('sidebar-open-v1', sidebarOpen ? '1' : '0'); } catch { /* noop */ }
  }, [sidebarOpen]);

  useEffect(() => { loadItems(); loadSettings(); }, []);

  // Refresh calendar when AI approves an action (event dispatched by AIAssistant)
  useEffect(() => {
    const handler = () => { loadItems(); };
    window.addEventListener('calendar-items-changed', handler);
    return () => window.removeEventListener('calendar-items-changed', handler);
  }, []);

  async function loadItems() {
    setLoading(true);
    try { const r = await api.get('/items'); setItems(r.data); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }
  async function loadSettings() {
    try { const r = await api.get('/settings'); setSettings(r.data); }
    catch { setSettings({ defaultView: 'week' }); }
  }

  const eventsCount = items.filter((i: any) => i.type === 'event').length;
  const tasksCount = items.filter((i: any) => i.type === 'task').length;

  const sidebarW = settings?.sidebarWidth || 264;

  return (
    <DashboardLayout currentDate={currentDate} onDateChange={setCurrentDate} onViewChange={(v) => setView(v as any)} currentView={view}
      onMenuToggle={() => setSidebarOpen((v) => !v)} sidebarOpen={sidebarOpen}>
      <div className={styles.mainContainer}>
        <aside
          className={`${styles.sidebar} ${sidebarOpen ? styles.open : styles.closed}`}
          style={{ ['--sidebar-w' as any]: `${sidebarW}px` }}
          aria-hidden={!sidebarOpen}
        >
          <div className={styles.sidebarInner}>
            <div className={styles.dateCard}>
              <div className={styles.dow}>{currentDate.toLocaleDateString('it-IT', { weekday: 'long' })}</div>
              <div className={styles.dnum}>{currentDate.getDate()}</div>
              <div className={styles.dmonth}>{currentDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</div>
            </div>

            <nav className={styles.nav}>
              <div className={styles.navLabel}>Menu</div>
              <button className={`${styles.navButton} ${view === 'calendar' ? styles.active : ''}`} onClick={() => setView('calendar')} tabIndex={sidebarOpen ? 0 : -1}>
                <span className={styles.ico}>📅</span> Calendario
              </button>
              <button className={`${styles.navButton} ${view === 'tasks' ? styles.active : ''}`} onClick={() => setView('tasks')} tabIndex={sidebarOpen ? 0 : -1}>
                <span className={styles.ico}>✓</span> Task
              </button>
              <button className={`${styles.navButton} ${view === 'chat' ? styles.active : ''}`} onClick={() => setView('chat')} tabIndex={sidebarOpen ? 0 : -1}>
                <span className={styles.ico}>✦</span> Assistente
              </button>
              <button className={`${styles.navButton} ${view === 'settings' ? styles.active : ''}`} onClick={() => setView('settings')} tabIndex={sidebarOpen ? 0 : -1}>
                <span className={styles.ico}>⚙</span> Impostazioni
              </button>
            </nav>

            <div className={styles.miniStats}>
              <div><strong>{eventsCount}</strong> eventi totali</div>
              <div><strong>{tasksCount}</strong> task aperti</div>
            </div>
          </div>
        </aside>

        <main className={styles.content}>
          {loading ? <div className={styles.loading}>Caricamento…</div> : (
            <>
              {view === 'calendar' && <CalendarView items={items} onItemsChange={loadItems} settings={settings} currentDate={currentDate} onDateChange={setCurrentDate} sidebarOpen={sidebarOpen} onSidebarChange={setSidebarOpen} />}
              {view === 'tasks' && <TasksPanel items={items} onItemsChange={loadItems} />}
              {view === 'chat' && <AIAssistant />}
              {view === 'settings' && <SettingsPanel onSave={() => { loadItems(); loadSettings(); }} settings={settings} />}
            </>
          )}
        </main>
      </div>
    </DashboardLayout>
  );
}

