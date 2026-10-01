import React, { useMemo, useRef, useEffect } from 'react';
import { dateToString, getDayName, minutesFromMidnight } from '../../utils/dateUtils';
import { isPolito, politoBackground, politoDotColor, courseColor } from '../../utils/politoColors';
import { categoryGradient, categoryDot, eventTextColor, EventTextMode, clampOpacity, taskDeadlineGradient } from '../../utils/eventColors';
import styles from './DayView.module.css';

interface Props {
  currentDate: Date;
  events: any[];
  onTimeSlotClick: (date: string, time: string) => void;
  onEventClick?: (item: any) => void;
  colorMap?: Record<string, string>;
  catColors?: Record<string, string>;
  textMode?: EventTextMode;
  opacity?: number;
  taskDeadlineColor?: string;
}

const START_HOUR = 6;
const END_HOUR = 24;
const HOUR_W = 64;

export function DayView({ currentDate, events, onTimeSlotClick, onEventClick, colorMap, catColors, textMode, opacity, taskDeadlineColor }: Props) {
  const dateStr = dateToString(currentDate);
  const hours = useMemo(() => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollLeft = (8 - START_HOUR) * HOUR_W; }, [dateStr]);

  // FIX: tutto il giorno + scadenze task (senza startTime) in una fascia dedicata, mai scartati
  const allDayItems = events.filter((e) => e.date === dateStr && (e.allDay || !e.startTime));
  const dayEvents = events.filter((e) => e.date === dateStr && e.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const isToday = new Date().toDateString() === currentDate.toDateString();
  const now = new Date();
  const nowLeftMin = isToday ? (() => {
    const m = now.getHours() * 60 + now.getMinutes();
    if (m < START_HOUR * 60 || m > END_HOUR * 60) return null;
    return (m - START_HOUR * 60) / 60;
  })() : null;
  const totalMin = (END_HOUR - START_HOUR) * 60;

  const allDayCount = allDayItems.length;
  const timedCount = dayEvents.length;

  return (
    <div className={styles.wrap}>
      <div className={styles.banner}>
        <div>
          <div className={styles.dow}>{getDayName(currentDate)}{isToday ? ' · Oggi' : ''}</div>
          <div className={styles.dfull}>{currentDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        <div className={styles.count}>{timedCount} eventi{allDayCount > 0 ? ` + ${allDayCount} tutto il giorno/scadenze` : ''}</div>
      </div>
      {allDayCount > 0 && (
        <div className={styles.alldayStrip}>
          <span className={styles.alldayLabel}>Tutto il giorno / scadenze ({allDayCount})</span>
          <div className={styles.alldayList}>
            {allDayItems.map((e) => {
              const polito = isPolito(e);
              const isTask = e.type === 'task';
              const bg = polito ? politoBackground(e, colorMap) : isTask && !e.completed
                ? taskDeadlineGradient(taskDeadlineColor)
                : categoryGradient(e.category, catColors);
              const fg = isTask && !e.completed ? '#0f172a' : eventTextColor(bg, textMode);
              return (
                <button key={e.id}
                  className={`${styles.alldayChip} ${isTask && !e.completed ? styles.deadlineEvt : ''} ${e.completed ? styles.alldayDone : ''}`}
                  style={{ background: bg, color: fg, opacity: clampOpacity(opacity), ...(isTask && !e.completed ? { borderColor: taskDeadlineColor } : {}) }}
                  onClick={() => onEventClick?.(e)}
                  title={`${e.title} — ${e.allDay ? 'tutto il giorno' : 'scadenza task'} — clicca per modificare`}>
                  {e.type === 'task' ? (e.completed ? '☑ ' : '⏳ ') : '📅 '}{e.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className={styles.body} ref={scrollRef}>
        <div className={styles.hinner} style={{ width: 150 + hours.length * HOUR_W }}>
          <div className={styles.hhead} style={{ gridTemplateColumns: `150px repeat(${hours.length}, ${HOUR_W}px)` }}>
            <div className={styles.hcorner}>Ore</div>
            {hours.map((h) => (
              <div key={h} className={styles.hhcell}><span>{String(h).padStart(2, '0')}:00</span></div>
            ))}
          </div>
          <div className={styles.hrow} style={{ gridTemplateColumns: `150px repeat(${hours.length}, ${HOUR_W}px)` }}>
            <div className={styles.hdayLabel}>
              <span className={styles.hdow}>{getDayName(currentDate)}</span>
              <span className={styles.hcount}>{timedCount} eventi</span>
            </div>
            <div className={styles.htimeline} style={{ gridColumn: `2 / span ${hours.length}` }}>
            {hours.map((h) => (
              <button key={h} type="button" className={styles.hcellH} style={{ width: HOUR_W }}
                onClick={() => onTimeSlotClick(dateStr, `${String(h).padStart(2, '0')}:00`)}
                title={`${String(h).padStart(2, '0')}:00`}>
                <span className={styles.plus}>+</span>
                <span className={styles.halfV} aria-hidden="true" />
              </button>
            ))}
            {dayEvents.map((e) => {
              const s = minutesFromMidnight(e.startTime);
              const en = minutesFromMidnight(e.endTime || e.startTime);
              const left = ((s - START_HOUR * 60) / totalMin) * 100;
              const width = Math.max(((Math.max(en - s, 30)) / totalMin) * 100, 3);
              if (s < START_HOUR * 60) return null;
              const polito = isPolito(e);
              const isTask = e.type === 'task' && !e.completed;
              const bg = polito ? politoBackground(e, colorMap) : isTask
                ? taskDeadlineGradient(taskDeadlineColor)
                : categoryGradient(e.category, catColors);
              const accent = polito
                ? { borderTopColor: courseColor(e.polito?.courseName || e.title, colorMap) }
                : isTask ? { borderTopColor: taskDeadlineColor } : undefined;
              const fg = isTask ? '#0f172a' : eventTextColor(bg, textMode);
              return (
                <div key={e.id} className={`${styles.evt} ${polito ? styles.politoEvt : ''} ${polito && e.category === 'exercise' ? styles.exEvt : ''} ${isTask ? styles.deadlineEvt : ''}`}
                  style={{ left: `${left}%`, width: `calc(${width}% - 4px)`, background: bg, color: fg, opacity: clampOpacity(opacity), ...accent }}
                  onClick={(ev) => { ev.stopPropagation(); onEventClick?.(e); }}
                  title="Clicca per modificare">
                  <div className={styles.etime}>{isTask ? '[task] ' : ''}{e.startTime}{e.endTime ? ` - ${e.endTime}` : ''}</div>
                  <div className={styles.etitle}>{e.title}</div>
                </div>
              );
            })}
            {nowLeftMin !== null && (
              <div className={styles.now} style={{ left: `${(nowLeftMin * 60 / totalMin) * 100}%` }}><i /></div>
            )}
            </div>
          </div>
        </div>
      </div>
      <div className={styles.program}>
        <h4>In programma ({timedCount + allDayCount})</h4>
            {allDayItems.map((e) => {
              const polito = isPolito(e);
              const bar = polito ? politoDotColor(e, colorMap) : categoryDot(e.category, catColors);
              return (
                <div key={`ad-${e.id}`} className={styles.item} onClick={() => onEventClick?.(e)} style={{ cursor: 'pointer' }} title={e.type === 'task' ? 'Scadenza task — clicca per modificare' : 'Tutto il giorno — clicca per modificare'}>
                  <span className={styles.bar} style={{ background: bar }} />
                  <div><b>{e.type === 'task' ? '⏳' : '📅'} · {e.title}</b><small>{e.type === 'task' ? 'scadenza' : 'tutto il giorno'} · {(e.category || '')}{e.location ? ` · ${e.location}` : ''}</small></div>
                </div>
              );
            })}
            {dayEvents.length === 0 && allDayCount === 0 && <p className={styles.empty}>Nessun evento. Clicca sulla timeline per crearne uno.</p>}
            {dayEvents.map((e) => {
              const polito = isPolito(e);
              const bar = polito ? politoDotColor(e, colorMap) : categoryDot(e.category, catColors);
              return (
                <div key={e.id} className={styles.item} onClick={() => onEventClick?.(e)} style={{ cursor: 'pointer' }} title={polito ? `${e.polito?.lessonType || 'Lezione'}${e.location ? ' · ' + e.location : ''}` : 'Clicca per modificare'}>
                  <span className={styles.bar} style={{ background: bar }} />
                  <div><b>{e.startTime} · {e.title}</b><small>{e.endTime ? `${e.startTime}–${e.endTime}` : ''} {polito ? (e.polito?.lessonType || '') : (e.category || '')}{e.location ? ` · ${e.location}` : ''}</small></div>
                </div>
              );
            })}
        </div>
    </div>
  );
}

