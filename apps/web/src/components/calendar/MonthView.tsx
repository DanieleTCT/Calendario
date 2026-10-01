import React from 'react';
import { getDaysInMonth, getFirstDayOfMonth } from '../../utils/dateUtils';
import { isPolito, politoDotColor } from '../../utils/politoColors';
import { categoryDot, EventTextMode, clampOpacity, DEFAULT_TASK_DEADLINE_COLOR } from '../../utils/eventColors';
import styles from './MonthView.module.css';

interface Props {
  currentDate: Date;
  events: any[];
  onDateClick: (date: string) => void;
  onDayOpen: (date: string) => void;
  onEventClick?: (item: any) => void;
  colorMap?: Record<string, string>;
  catColors?: Record<string, string>;
  textMode?: EventTextMode;
  opacity?: number;
  taskDeadlineColor?: string;
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export function MonthView({ currentDate, events, onDateClick, onDayOpen, onEventClick, colorMap, catColors, textMode, opacity, taskDeadlineColor }: Props) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(currentDate);
  // convert Sunday-first -> Monday-first
  const firstDay = (getFirstDayOfMonth(currentDate) + 6) % 7;
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  const cells: (number | null)[] = [...Array(firstDay).fill(null)];
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);

  const byDate = (day: number) => events.filter((e) => e.date === `${year}-${pad(month + 1)}-${pad(day)}`);
  const isToday = (day: number) => day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  const isWeekend = (idx: number) => idx % 7 >= 5;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={`${styles.hcell} ${i >= 5 ? styles.weekendH : ''}`}>{d}</div>
        ))}
      </div>
      <div className={styles.grid}>
        {cells.map((day, idx) => {
          if (day === null) return <div key={`x-${idx}`} className={`${styles.cell} ${styles.out}`} />;
          const list = byDate(day);
          const cur = isToday(day);
          return (
            <div key={day} className={`${styles.cell} ${cur ? styles.today : ''} ${isWeekend(idx) ? styles.weekend : ''}`}
              onClick={() => onDateClick(`${year}-${pad(month + 1)}-${pad(day)}`)}
              onDoubleClick={() => onDayOpen(`${year}-${pad(month + 1)}-${pad(day)}`)}>
              <div className={styles.top}>
                <span className={`${styles.num} ${cur ? styles.numToday : ''}`}>{day}</span>
                {list.length > 0 && <span className={styles.badge}>{list.length}</span>}
              </div>
              <div className={styles.evts}>
                {list.slice(0, 3).map((e) => {
                  const polito = isPolito(e);
                  const isTask = e.type === 'task';
                  const dot = polito ? politoDotColor(e, colorMap) : isTask
                    ? (taskDeadlineColor || DEFAULT_TASK_DEADLINE_COLOR)
                    : categoryDot(e.category, catColors);
                  const op = clampOpacity(opacity);
                  return (
                    <div key={e.id} className={`${styles.evt} ${e.type === 'task' ? styles.taskEvt : ''} ${e.completed ? styles.doneEvt : ''} ${polito ? styles.politoEvt : ''} ${isTask && !e.completed ? styles.deadlineEvt : ''}`}
                      style={{ opacity: op, ...(isTask && !e.completed ? { ['--deadline' as any]: taskDeadlineColor || DEFAULT_TASK_DEADLINE_COLOR } : {}) }}
                      title={`${e.title} ${e.startTime || ''}${polito ? ` — ${e.polito?.lessonType || 'Lezione'}${e.location ? ' · ' + e.location : ''}` : ' — clicca per modificare'}`}
                      onClick={(ev) => { ev.stopPropagation(); onEventClick?.(e); }}>
                      <span className={styles.dot} style={{ background: dot }} />
                      <span className={styles.t}>{e.type === 'task' ? (e.completed ? '☑ ' : '☐ ') : ''}{e.startTime ? `${e.startTime} ` : ''}{e.title}{polito && e.category === 'exercise' ? ' (es.)' : ''}</span>
                    </div>
                  );
                })}
                {list.length > 3 && (
                  <button className={styles.more} onClick={(ev) => { ev.stopPropagation(); onDayOpen(`${year}-${pad(month + 1)}-${pad(day)}`); }}>
                    +{list.length - 3} altri
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

