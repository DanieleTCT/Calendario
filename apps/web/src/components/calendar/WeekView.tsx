import React, { useMemo, useRef, useEffect } from 'react';
import { getWeek, dateToString, minutesFromMidnight } from '../../utils/dateUtils';
import { isPolito, politoBackground, courseColor } from '../../utils/politoColors';
import { categoryGradient, eventTextColor, EventTextMode, clampOpacity, taskDeadlineGradient } from '../../utils/eventColors';
import styles from './WeekView.module.css';

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

export function WeekView({ currentDate, events, onTimeSlotClick, onEventClick, colorMap, catColors, textMode, opacity, taskDeadlineColor }: Props) {
  const week = getWeek(currentDate);
  const hours = useMemo(() => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollLeft = (8 - START_HOUR) * HOUR_W; }, []);

  const now = new Date();
  const nowLeftMin = (() => {
    const m = now.getHours() * 60 + now.getMinutes();
    if (m < START_HOUR * 60 || m > END_HOUR * 60) return null;
    return (m - START_HOUR * 60) / 60;
  })();
  const totalMin = (END_HOUR - START_HOUR) * 60;

  const allDayByDate: Record<string, any[]> = {};
  for (const d of week) {
    const ds = dateToString(d);
    allDayByDate[ds] = events.filter((e) => e.date === ds && (e.allDay || !e.startTime));
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll} ref={scrollRef}>
        <div className={styles.inner} style={{ width: 168 + hours.length * HOUR_W }}>
          <div className={styles.headRow} style={{ gridTemplateColumns: `168px repeat(${hours.length}, ${HOUR_W}px)` }}>
            <div className={styles.corner}>Giorno / ore</div>
            {hours.map((h) => (
              <div key={h} className={styles.hhead}>
                <span>{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>
          {week.map((d) => {
            const ds = dateToString(d);
            const dayEv = events.filter((e) => e.date === ds && e.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
            const allday = allDayByDate[ds] || [];
            const today = d.toDateString() === now.toDateString();
            return (
              <div key={ds} className={`${styles.dayRow} ${today ? styles.dayToday : ''}`}
                style={{ gridTemplateColumns: `168px repeat(${hours.length}, ${HOUR_W}px)` }}>
                <div className={styles.dayLabel}>
                  <span className={styles.dow}>{d.toLocaleDateString('it-IT', { weekday: 'short' })}</span>
                  <span className={`${styles.dnum} ${today ? styles.dnumToday : ''}`}>{d.getDate()}</span>
                  {allday.length > 0 && <span className={styles.alldayMore}>{allday.length} tutto il giorno</span>}
                </div>
                <div className={styles.timeline} style={{ gridColumn: `2 / span ${hours.length}` }}>
                  {hours.map((h) => (
                    <button key={h} type="button" className={styles.hcell} style={{ width: HOUR_W }}
                      onClick={() => onTimeSlotClick(ds, `${String(h).padStart(2, '0')}:00`)}
                      title={`${String(h).padStart(2, '0')}:00 - Clicca per creare`}>
                      <span className={styles.halfV} aria-hidden="true" />
                    </button>
                  ))}
                  {dayEv.map((e) => {
                    const s = minutesFromMidnight(e.startTime);
                    const en = minutesFromMidnight(e.endTime || e.startTime);
                    const dur = Math.max(en - s, 30);
                    const left = ((s - START_HOUR * 60) / totalMin) * 100;
                    const width = Math.max((dur / totalMin) * 100, 3);
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
                        title={`${e.title} ${e.startTime}-${e.endTime || ''} - clicca per modificare`}
                        onClick={(ev) => { ev.stopPropagation(); onEventClick?.(e); }}>
                        <b>{isTask ? '[task] ' : ''}{e.startTime} {e.title}</b>
                      </div>
                    );
                  })}
                  {today && nowLeftMin !== null && (
                    <div className={styles.now} style={{ left: `${(nowLeftMin * 60 / totalMin) * 100}%` }}><i /></div>
                  )}
                  {allday.slice(0, 3).map((e) => (
                    <button key={`ad-${e.id}`} type="button" className={styles.alldayChip}
                      onClick={() => onEventClick?.(e)}
                      title={`${e.title} - tutto il giorno/scadenza`}>
                      {e.type === 'task' ? '[ ] ' : ''}{e.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
