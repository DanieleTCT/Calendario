import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import styles from './NewEventModal.module.css';

interface Props {
  date: string;
  time?: string | null;
  onClose: () => void;
  onSave: () => void;
}

export function NewEventModal({ date, time, onClose, onSave }: Props) {
  const api = useApi();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState(time || '09:00');
  const [endTime, setEndTime] = useState(time ? addMinutes(time, 30) : '10:00');
  const [category, setCategory] = useState('general');
  const [visibility, setVisibility] = useState('default');
  const [allDay, setAllDay] = useState(false);
  const [itemType, setItemType] = useState<'event' | 'task'>('event');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function addMinutes(timeStr: string, minutes: number): string {
    const [h, m] = timeStr.split(':').map(Number);
    const totalMinutes = h * 60 + m + minutes;
    const newH = Math.floor(totalMinutes / 60) % 24;
    const newM = totalMinutes % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Il titolo è obbligatorio');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // FIX: task senza orario = solo data (scadenza visibile sul calendario);
      // eventi allDay senza start/end così compaiono nella fascia giornaliera.
      const isTaskNoTime = itemType === 'task' && allDay;
      await api.post('/items', {
        type: itemType,
        title: title.trim(),
        description: description.trim() || undefined,
        date,
        startTime: isTaskNoTime || allDay ? undefined : startTime,
        endTime: isTaskNoTime || allDay ? undefined : endTime,
        allDay: itemType === 'event' ? allDay : false,
        category,
        visibility,
        reminderMinutes: 1440,
      });

      onSave();
    } catch (err) {
      setError('Errore nella creazione dell\'evento');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Nuova Attivita</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.tabs}>
            <button type="button" className={`${styles.tabBtn} ${itemType === 'event' ? styles.tabActive : ''}`} onClick={() => setItemType('event')}>Evento</button>
            <button type="button" className={`${styles.tabBtn} ${itemType === 'task' ? styles.tabActive : ''}`} onClick={() => setItemType('task')}>Task</button>
          </div>
          <div className={styles.formGroup}>
            <label>Titolo *</label>
            <input
              type="text"
              placeholder="Es. Riunione team"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label>Descrizione</label>
            <textarea
              placeholder="Aggiungi una descrizione..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>Data</label>
              <input type="text" value={date} disabled />
            </div>
            {!allDay && (
              <>
                <div className={styles.formGroup}>
                  <label>Ora Inizio</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Ora Fine</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                  />
                </div>
              </>
            )}
          </div>

          <label className={styles.checkRow} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.88rem', fontWeight: 600 }}>
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            {itemType === 'task' ? 'Solo scadenza (senza orario)' : 'Tutto il giorno'}
          </label>

          <div className={styles.formGroup}>
            <label>Categoria</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="general">Generale</option>
              <option value="work">Lavoro</option>
              <option value="personal">Personale</option>
              <option value="meeting">Riunione</option>
              <option value="holiday">Vacanza</option>
              <option value="birthday">Compleanno</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Visibilità</label>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="default">Default</option>
              <option value="public">Pubblica</option>
              <option value="private">Privata</option>
              <option value="confidential">Riservata</option>
            </select>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Annulla
            </button>
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? 'Creazione...' : itemType === 'task' ? 'Crea Task' : 'Crea Evento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
