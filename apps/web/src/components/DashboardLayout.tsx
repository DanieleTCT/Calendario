import React from 'react';
import styles from './DashboardLayout.module.css';

interface Props {
  children: React.ReactNode;
  currentDate: Date;
  onDateChange: (date: Date) => void;
  onViewChange: (view: string) => void;
  currentView: string;
  onMenuToggle?: () => void;
  sidebarOpen?: boolean;
}

export function DashboardLayout({ children, currentDate, onDateChange, onMenuToggle, sidebarOpen }: Props) {
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            type="button"
            className={styles.hamburger}
            onClick={onMenuToggle}
            aria-label={sidebarOpen ? 'Chiudi menu laterale' : 'Apri menu laterale'}
            aria-expanded={!!sidebarOpen}
            title={sidebarOpen ? 'Chiudi menu' : 'Apri menu'}
          >
            {sidebarOpen ? '✕' : '☰'}
          </button>
          <div className={styles.headerContent}>
            <h1>📅 Calendario AI</h1>
            <p>Organizza il tuo tempo con l'intelligenza artificiale</p>
          </div>
        </div>
        <div className={styles.dateNavigator}>
          <button onClick={() => onDateChange(new Date(currentDate.getTime() - 86400000))}>←</button>
          <span>{currentDate.toLocaleDateString('it-IT')}</span>
          <button onClick={() => onDateChange(new Date(currentDate.getTime() + 86400000))}>→</button>
        </div>
      </header>
      {children}
    </div>
  );
}
