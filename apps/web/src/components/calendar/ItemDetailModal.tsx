import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import styles from './NewEventModal.module.css';

interface Props { item: any; onClose: () => void; onSave: () => void; }

const CATS = [
  { v: 'general', l: 'Generale' }, { v: 'work', l: 'Lavoro' },
  { v: 'personal', l: 'Personale' }, { v: 'meeting', l: 'Riunione' },
  { v: 'holiday', l: 'Vacanza' }, { v: 'birthday', l: 'Compleanno' },
];

export function ItemDetailModal({ item, onClose, onSave }: Props) {
  const api = useApi();
  const [title, setTitle] = useState(item.title || '');
  const [description, setDescription] = useState(item.description || '');
  const [date, setDate] = useState(item.date || '');
  const [startTime, setStartTime] = useState(item.startTime || '09:00');
  const [endTime, setEndTime] = useState(item.endTime || '10:00');
  const [allDay, setAllDay] = useState(!!item.allDay);
  const [category, setCategory] = useState(item.category || 'general');
  const [visibility, setVisibility] = useState(item.visibility || 'default');
  const [location, setLocation] = useState(item.location || '');
  const [recurrence, setRecurrence] = useState(item.recurrence || 'none');
  const [completed, setCompleted] = useState(!!item.completed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isTask = item.type === 'task';

  async function patch(data: Record<string, any>) {
    setLoading(true); setError('');
    try { await api.patch(`/items/${item.id}`, data); onSave(); }
    catch (e) { console.error(e); setError('Errore nel salvataggio'); setLoading(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError('Il titolo e obbligatorio'); return; }
    if (!date) { setError('La data e obbligatoria'); return; }
    await patch({
      title: title.trim(), description: description.trim() || undefined,
      date, allDay, startTime: allDay ? undefined : startTime,
      endTime: allDay ? undefined : endTime, category, visibility,
      location: location.trim() || undefined, recurrence,
      completed: isTask ? completed : undefined,
    });
  }

  async function toggleDone() {
    const next = !completed; setCompleted(next);
    await patch({ completed: next });
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setLoading(true);
    try { await api.delete(`/items/${item.id}`); onSave(); }
    catch (e) { console.error(e); setError("Errore nell'eliminazione"); setLoading(false); }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{isTask ? 'Modifica Task' : 'Modifica Evento'}</h2>
          <button className={styles.closeBtn} onClick={onClose}>X</button>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.typeBadge}>
            <span className={isTask ? styles.badgeTask : styles.badgeEvent}>{isTask ? 'TASK' : 'EVENTO'}</span>
            {item.source === 'polito' && (
              <span className={styles.badgeEvent} style={{ background: '#4f46e5' }}>🎓 POLITO</span>
            )}
            <span className={styles.metaId}>ID: {String(item.id).slice(0, 8)}</span>
          </div>

          {item.source === 'polito' && (
            <p style={{ fontSize: '.8rem', color: '#64748b', margin: '0 0 .5rem' }}>
              Lezione sincronizzata dall'orario PoliTO{item.polito?.lessonType ? ` (${item.polito.lessonType})` : ''}.
              Le modifiche verranno sovrascritte al prossimo sync.
            </p>
          )}

          {isTask && (
            <button type="button" className={`${styles.statusToggle} ${completed ? styles.done : styles.todo}`}
              onClick={toggleDone} disabled={loading}>
              {completed ? 'Completato - clicca per riaprire' : 'Da fare - clicca per completare'}
            </button>
          )}

          <div className={styles.formGroup}>
            <label>Titolo *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
          </div>

          <div className={styles.formGroup}>
            <label>Descrizione</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>Data *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            {!allDay && (
              <>
                <div className={styles.formGroup}>
                  <label>Inizio</label>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className={styles.formGroup}>
                  <label>Fine</label>
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </>
            )}
          </div>

          <label className={styles.checkRow}>
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            Tutto il giorno
          </label>

          <div className={styles.formRow2}>
            <div className={styles.formGroup}>
              <label>Categoria</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Visibilità</label>
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)}
                title="Visibilità dell'evento (filtrabile e salvabile dal calendario)">
                <option value="default">Default</option>
                <option value="public">Pubblica</option>
                <option value="private">Privata</option>
                <option value="confidential">Riservata</option>
              </select>
            </div>
          </div>
          <div className={styles.formRow2}>
            <div className={styles.formGroup}>
              <label>Ricorrenza</label>
              <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                <option value="none">Nessuna</option>
                <option value="daily">Giornaliera</option>
                <option value="weekly">Settimanale</option>
                <option value="monthly">Mensile</option>
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Luogo</label>
              <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Es. Ufficio..." />
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <button type="button" className={confirmDelete ? styles.dangerBtn : styles.deleteBtn}
              onClick={handleDelete} disabled={loading}>
              {confirmDelete ? 'Confermi eliminazione?' : 'Elimina'}
            </button>
            <div className={styles.spacer} />
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Annulla</button>
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? 'Salvataggio...' : 'Salva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

