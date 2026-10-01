import React, { useMemo, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { ItemDetailModal } from './calendar/ItemDetailModal';
import { dateToString } from '../utils/dateUtils';
import styles from './TasksPanel.module.css';

interface Props { items: any[]; onItemsChange: () => void; }

export function TasksPanel({ items, onItemsChange }: Props) {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'done' | 'overdue'>('all');
  const [selected, setSelected] = useState<any | null>(null);
  const today = dateToString(new Date());

  const tasks = useMemo(() => items.filter((i) => i.type === 'task'), [items]);

  async function toggle(t: any, e: React.MouseEvent) {
    e.stopPropagation();
    try { await api.patch(`/items/${t.id}`, { completed: !t.completed }); onItemsChange(); }
    catch (err) { console.error(err); }
  }

  const filtered = tasks.filter((t) => {
    if (search && !(`${t.title} ${t.description || ''}`.toLowerCase().includes(search.toLowerCase()))) return false;
    if (filter === 'open') return !t.completed;
    if (filter === 'done') return !!t.completed;
    if (filter === 'overdue') return !t.completed && t.date < today;
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date));

  const openTasks = filtered.filter((t) => !t.completed);
  const doneTasks = filtered.filter((t) => !!t.completed);

  const renderRow = (task: any) => {
    const overdue = !task.completed && task.date < today;
    return (
      <div key={task.id} className={`${styles.taskCard} ${overdue ? styles.overdue : ''}`}
        onClick={() => setSelected(task)} title="Clicca per modificare">
        <button className={styles.taskCheckbox} onClick={(e) => toggle(task, e)}
          title={task.completed ? 'Segna da fare' : 'Segna completato'}>
          {task.completed ? '☑' : '☐'}
        </button>
        <div className={styles.taskInfo}>
          <div className={`${styles.taskTitle} ${task.completed ? styles.completed : ''}`}>{task.title}</div>
          <div className={styles.taskDate}>
            📅 {task.date}{task.startTime ? ` · ${task.startTime}` : ''} · {task.category || 'general'}
            {overdue && <span className={styles.overdueBadge}> in ritardo</span>}
          </div>
          {task.description && <div className={styles.taskDesc}>{task.description}</div>}
        </div>
        <span className={styles.editHint}>✎</span>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.topbar}>
        <h2>Task ({tasks.length})</h2>
        <input className={styles.search} placeholder="🔍 Cerca task..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className={styles.filters}>
        {(['all', 'open', 'done', 'overdue'] as const).map((f) => (
          <button key={f} className={`${styles.filterBtn} ${filter === f ? styles.active : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Tutti' : f === 'open' ? 'Da fare' : f === 'done' ? 'Completati' : 'In ritardo'}
          </button>
        ))}
      </div>
      <div className={styles.sections}>
        <div className={styles.section}>
          <h3>Da fare ({openTasks.length})</h3>
          {openTasks.length === 0 ? <p className={styles.empty}>Nessun task aperto</p>
            : <div className={styles.taskList}>{openTasks.map(renderRow)}</div>}
        </div>
        <div className={styles.section}>
          <h3>Completati ({doneTasks.length})</h3>
          {doneTasks.length === 0 ? <p className={styles.empty}>Nessun task completato</p>
            : <div className={styles.taskList}>{doneTasks.map(renderRow)}</div>}
        </div>
      </div>
      {selected && <ItemDetailModal item={selected} onClose={() => setSelected(null)}
        onSave={() => { setSelected(null); onItemsChange(); }} />}
    </div>
  );
}

