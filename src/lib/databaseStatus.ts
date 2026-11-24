export type DatabaseMode = 'checking' | 'online' | 'offline' | 'error'

export type DatabaseStatus = {
  mode: DatabaseMode
  message: string
}

let status: DatabaseStatus = { mode: 'checking', message: '' }
const listeners = new Set<(next: DatabaseStatus) => void>()

export function getDatabaseStatus() {
  return status
}

export function setDatabaseStatus(mode: DatabaseMode, message = '') {
  status = { mode, message }
  for (const listener of listeners) listener(status)
}

export function subscribeDatabaseStatus(listener: (next: DatabaseStatus) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
