import React from 'react';
import { LegendCourse } from '../../utils/politoColors';
import { DEFAULT_TASK_DEADLINE_COLOR } from '../../utils/eventColors';
import styles from './Legend.module.css';

interface Props {
  courses: LegendCourse[];
  /** Corsi attualmente nascosti (clique per attivare/disattivare) */
  hidden: Set<string>;
  onToggleCourse: (name: string) => void;
  /** Mostra/nascondi tutte le lezioni PoliTO */
  showPolito: boolean;
  onToggleShow: () => void;
  /** Colore scadenza task (per la legenda) */
  taskDeadlineColor?: string;
}

const TYPES = [
  { label: 'Lezione', style: 'lesson' },
  { label: 'Esercitazione', style: 'exercise' },
];

export function Legend({ courses, hidden, onToggleCourse, showPolito, onToggleShow, taskDeadlineColor }: Props) {
  return (
    <div className={styles.legend}>
      <button
        type="button"
        className={`${styles.master} ${showPolito ? styles.on : ''}`}
        onClick={onToggleShow}
        title={showPolito ? 'Nascondi le lezioni PoliTO' : 'Mostra le lezioni PoliTO'}
      >
        🎓 PoliTO
      </button>

      {showPolito && courses.length > 0 && (
        <>
          <span className={styles.sep} />
          <div className={styles.courses}>
            {courses.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`${styles.chip} ${hidden.has(c.name) ? styles.chipOff : ''}`}
                onClick={() => onToggleCourse(c.name)}
                title={`${hidden.has(c.name) ? 'Mostra' : 'Nascondi'} ${c.name} (${c.count})`}
              >
                <span className={styles.dot} style={{ background: c.color }} />
                <span className={styles.name}>{c.name}</span>
                <span className={styles.count}>{c.count}</span>
              </button>
            ))}
          </div>
          <span className={styles.sep} />
          <div className={styles.types}>
            <span className={styles.type}><span className={`${styles.sq} ${styles.sqLesson}`} /> Lezione</span>
            <span className={styles.type}><span className={`${styles.sq} ${styles.sqEx}`} /> Esercitazione</span>
            <span className={styles.type} title="Scadenza dei task (non completati)">
              <span className={styles.sqDeadline} style={{ borderColor: taskDeadlineColor || DEFAULT_TASK_DEADLINE_COLOR }} /> Scadenza task
            </span>
          </div>
        </>
      )}
    </div>
  );
}
