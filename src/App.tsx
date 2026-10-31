import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import {
  addDays,
  addMonths,
  addWeeks,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns'
import { it } from 'date-fns/locale'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckSquare,
  CircleHelp,
  Clock3,
  Copy,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { SharedMedia } from './SharedMedia'
import { WatchDecider } from './WatchDecider'
import {
  MEMBER_COLORS,
  type CalendarItem,
  type CalendarItemType,
  type CalendarMember,
  type CalendarView,
  type FamilyCalendar,
  type MemberColor,
} from './types'

type ItemFilter = 'all' | CalendarItemType

const HOURS = Array.from({ length: 16 }, (_, index) => index + 7)
const MEMBER_COLOR_LABELS: Record<MemberColor, string> = {
  violet: 'Viola',
  blue: 'Blu',
  coral: 'Corallo',
  green: 'Verde',
  amber: 'Ambra',
  pink: 'Rosa',
}
const itemLabels: Record<CalendarItemType, string> = {
  event: 'Evento',
  task: 'Task',
  lesson: 'Lezione',
}

function memberDisplayName(member: CalendarMember) {
  return member.display_name.trim() || 'Membro'
}

function memberInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toLocaleUpperCase('it-IT')
}

function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

function getDefaultTimes(day: Date) {
  const start = new Date(day)
  start.setHours(9, 0, 0, 0)
  const end = new Date(day)
  end.setHours(10, 0, 0, 0)
  return { starts_at: localDateTime(start), ends_at: localDateTime(end) }
}

function formatMonthHeading(date: Date) {
  const value = format(date, 'MMMM yyyy', { locale: it })
  return value.charAt(0).toLocaleUpperCase('it-IT') + value.slice(1)
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : 'Si è verificato un errore imprevisto.'
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [calendar, setCalendar] = useState<FamilyCalendar | null>(null)
  const [calendars, setCalendars] = useState<FamilyCalendar[]>([])
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const loadSequence = useRef(0)
  const [members, setMembers] = useState<CalendarMember[]>([])
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [items, setItems] = useState<CalendarItem[]>([])
  const [dataLoading, setDataLoading] = useState(false)
  const [date, setDate] = useState(new Date())
  const [view, setView] = useState<CalendarView>('week')
  const [filter, setFilter] = useState<ItemFilter>('all')
  const [memberFilter, setMemberFilter] = useState<string | null>(null)
  const [editorItem, setEditorItem] = useState<CalendarItem | null | undefined>(undefined)
  const [createDay, setCreateDay] = useState<Date | null>(null)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [section, setSection] = useState<'calendar' | 'media' | 'watch'>('calendar')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const user = session?.user ?? null
  const currentMember = members.find((member) => member.user_id === user?.id)
  const canEdit = currentMember?.role === 'owner' || currentMember?.can_edit === true
  const selectedItems = useMemo(
    () => items.filter((item) =>
      (filter === 'all' || item.item_type === filter)
      && (memberFilter === null || item.assignee_id === memberFilter),
    ),
    [filter, items, memberFilter],
  )

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }

    let active = true
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setSession(data.session)
      setAuthLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, nextSession) => {
      setSession(nextSession)
      setError('')
      setNotice('')
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const loadCalendar = useCallback(async (currentUser: User) => {
    if (!supabase) return
    const sequence = ++loadSequence.current
    setDataLoading(true)
    setError('')
    try {
      const { data: memberships, error: membershipError } = await supabase
        .from('calendar_members')
        .select('calendar_id')
        .eq('user_id', currentUser.id)
      if (membershipError) throw membershipError

      if (!memberships?.length) {
        if (sequence !== loadSequence.current) return
        setCalendars([])
        setCalendar(null)
        setMembers([])
        setInviteCode(null)
        setItems([])
        return
      }

      const { data: calendarRows, error: calendarError } = await supabase
        .from('calendars')
        .select('id, name')
        .in('id', memberships.map((membership) => membership.calendar_id))
        .order('created_at')
      if (calendarError) throw calendarError
      const calendarRow = calendarRows?.find((row) => row.id === selectedCalendarId) ?? calendarRows?.[0]
      if (!calendarRow) throw new Error('Nessun calendario accessibile per gli spazi associati.')

      const { data: calendarMembers, error: membersError } = await supabase
        .from('calendar_members')
        .select('calendar_id, user_id, display_name, color, role, can_edit')
        .eq('calendar_id', calendarRow.id)
        .order('created_at')
      if (membersError) throw membersError

      const { data: calendarItems, error: itemsError } = await supabase
        .from('calendar_items')
        .select('*')
        .eq('calendar_id', calendarRow.id)
        .order('starts_at')
      if (itemsError) throw itemsError
      let code: string | null = null
      if (calendarMembers?.some((member) => member.user_id === currentUser.id && member.role === 'owner')) {
        const { data: invite, error: inviteError } = await supabase.rpc('get_calendar_invite_code', { p_calendar_id: calendarRow.id })
        if (inviteError) throw inviteError
        code = invite
      }

      if (sequence !== loadSequence.current) return
      setCalendars(calendarRows ?? [])
      setCalendar(calendarRow)
      setMembers(calendarMembers ?? [])
      setInviteCode(code)
      setItems(calendarItems ?? [])
    } catch (loadError) {
      if (sequence === loadSequence.current) setError(`Impossibile caricare il calendario: ${readableError(loadError)}`)
    } finally {
      if (sequence === loadSequence.current) setDataLoading(false)
    }
  }, [selectedCalendarId])

  useEffect(() => {
    if (!user || !supabase) {
      loadSequence.current += 1
      setCalendar(null)
      setCalendars([])
      setSelectedCalendarId(null)
      setMembers([])
      setInviteCode(null)
      setItems([])
      return
    }
    void loadCalendar(user)
  }, [loadCalendar, user])

  useEffect(() => {
    if (!calendar || !supabase || !user) return
    const client = supabase
    const channel = client
      .channel(`calendar-${calendar.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_items', filter: `calendar_id=eq.${calendar.id}` },
        () => {
          void loadCalendar(user)
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_members', filter: `calendar_id=eq.${calendar.id}` },
        () => {
          void loadCalendar(user)
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [calendar?.id, loadCalendar, user])

  const handleAuth = async (mode: 'signin' | 'signup', email: string, password: string) => {
    if (!supabase) return
    setError('')
    setNotice('')
    try {
      const result =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password })
      if (result.error) {
        setError(result.error.message)
        return
      }
      if (mode === 'signup' && !result.data.session) {
        setNotice('Controlla la tua email per confermare la registrazione, poi accedi.')
      }
    } catch (authError) {
      setError(`Errore di connessione: ${readableError(authError)}`)
    }
  }

  const navigate = (direction: -1 | 1) => {
    setDate((current) =>
      view === 'week'
        ? direction === 1
          ? addWeeks(current, 1)
          : subWeeks(current, 1)
        : direction === 1
          ? addMonths(current, 1)
          : subMonths(current, 1),
    )
  }

  const openNewItem = (day: Date) => {
    if (!canEdit) {
      setNotice('Hai accesso in sola lettura a questo calendario.')
      return
    }
    setCreateDay(day)
    setEditorItem(null)
  }

  const saveItem = async (form: {
    title: string
    description: string
    item_type: CalendarItemType
    starts_at: string
    ends_at: string
    all_day: boolean
    assignee_id: string | null
    visibility: 'everyone' | 'selected'
    visible_to: string[]
  }) => {
    if (!supabase || !calendar || !user) return false
    setError('')
    const payload = {
      calendar_id: calendar.id,
      title: form.title.trim(),
      description: form.description.trim(),
      item_type: form.item_type,
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: new Date(form.ends_at).toISOString(),
      all_day: form.all_day,
      assignee_id: form.assignee_id,
      visibility: form.visibility,
      visible_to: form.visibility === 'selected' ? form.visible_to : [],
    }
    try {
      const result = editorItem
        ? await supabase.from('calendar_items').update(payload).eq('id', editorItem.id).select('id').maybeSingle()
        : await supabase.from('calendar_items').insert({ ...payload, created_by: user.id })
      if (result.error) {
        setError(`Impossibile salvare: ${result.error.message}`)
        return false
      }
      if (editorItem && !result.data) {
        setError('Elemento non aggiornato: potrebbe non essere più disponibile o modificabile.')
        return false
      }
      setEditorItem(undefined)
      await loadCalendar(user)
      return true
    } catch (saveError) {
      setError(`Impossibile salvare: ${readableError(saveError)}`)
      return false
    }
  }

  const deleteItem = async (id: string) => {
    if (!supabase || !user) return
    try {
      const { data: deleted, error: deleteError } = await supabase.from('calendar_items').delete().eq('id', id).select('id').maybeSingle()
      if (deleteError) {
        setError(`Impossibile eliminare: ${deleteError.message}`)
        return
      }
      if (!deleted) {
        setError('Elemento non eliminato: potrebbe non essere più disponibile o modificabile.')
        return
      }
      setEditorItem(undefined)
      await loadCalendar(user)
    } catch (deleteError) {
      setError(`Impossibile eliminare: ${readableError(deleteError)}`)
    }
  }

  const toggleTask = async (item: CalendarItem) => {
    if (!supabase || !user) return
    if (!canEdit) {
      setNotice('Hai accesso in sola lettura a questo calendario.')
      return
    }
    try {
      const { data: updated, error: updateError } = await supabase
        .from('calendar_items')
        .update({ completed: !item.completed })
        .eq('id', item.id)
        .select('id')
        .maybeSingle()
      if (updateError) {
        setError(`Impossibile aggiornare la task: ${updateError.message}`)
        return
      }
      if (!updated) {
        setError('Task non aggiornata: potrebbe non essere più disponibile o modificabile.')
        return
      }
      await loadCalendar(user)
    } catch (updateError) {
      setError(`Impossibile aggiornare la task: ${readableError(updateError)}`)
    }
  }

  const saveMemberProfile = async (displayName: string, color: MemberColor) => {
    if (!supabase || !calendar || !user) return false
    setError('')
    try {
      const { error: updateError } = await supabase
        .from('calendar_members')
        .update({ display_name: displayName.trim(), color })
        .eq('calendar_id', calendar.id)
        .eq('user_id', user.id)
      if (updateError) {
        setError(`Impossibile aggiornare il profilo: ${updateError.message}`)
        return false
      }

      await loadCalendar(user)
      setNotice('Profilo aggiornato.')
      return true
    } catch (updateError) {
      setError(`Impossibile aggiornare il profilo: ${readableError(updateError)}`)
      return false
    }
  }

  const manageMember = async (member: CalendarMember, remove: boolean) => {
    if (!supabase || !calendar || !user) return
    if (remove && !window.confirm(`Rimuovere ${memberDisplayName(member)}? Il codice invito verrà rigenerato.`)) return
    setError('')
    const { error: manageError } = await supabase.rpc('manage_calendar_member', {
      p_calendar_id: calendar.id,
      p_user_id: member.user_id,
      p_can_edit: !member.can_edit,
      p_remove: remove,
    })
    if (manageError) {
      setError(`Impossibile aggiornare il membro: ${manageError.message}`)
      return
    }
    await loadCalendar(user)
    if (remove) setNotice('Membro rimosso e codice invito rigenerato.')
  }

  if (!supabase) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="brand-mark"><CalendarDays size={23} /></div>
          <p className="eyebrow">Family calendar</p>
          <h1>Configura il collegamento</h1>
          <p>Aggiungi <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> alle variabili d’ambiente.</p>
        </div>
      </main>
    )
  }

  if (authLoading) {
    return <LoadingScreen />
  }

  if (!user) {
    return <AuthScreen onSubmit={handleAuth} error={error} notice={notice} />
  }

  if (!calendar || setupOpen) {
    return (
      <CalendarSetup
        email={user.email ?? ''}
        error={error}
        loading={dataLoading}
        onCreate={async (name) => {
          if (!supabase) return
          setError('')
          try {
            const id = crypto.randomUUID()
            const { error: createError } = await supabase
              .from('calendars')
              .insert({ id, name, created_by: user.id })
            if (createError) {
              setError(`Impossibile creare il calendario: ${createError.message}`)
              return
            }
            setSelectedCalendarId(id)
            setSetupOpen(false)
          } catch (createError) {
            setError(`Impossibile creare il calendario: ${readableError(createError)}`)
          }
        }}
        onJoin={async (code) => {
          if (!supabase) return
          try {
            const { data: joinedId, error: joinError } = await supabase.rpc('join_calendar_with_code', {
              p_invite_code: code,
            })
            if (joinError) {
              setError(`Codice non valido o impossibile unirsi: ${joinError.message}`)
              return
            }
            setSelectedCalendarId(joinedId)
            setSetupOpen(false)
            if (selectedCalendarId === joinedId) await loadCalendar(user)
          } catch (joinError) {
            setError(`Impossibile unirsi al calendario: ${readableError(joinError)}`)
          }
        }}
        onSignOut={async () => { if (supabase) await supabase.auth.signOut() }}
        onCancel={calendar ? () => { setSetupOpen(false); setError('') } : undefined}
      />
    )
  }

  const monthStart = startOfMonth(date)
  const monthDays = Array.from(
    { length: 42 },
    (_, index) => addDays(startOfWeek(monthStart, { weekStartsOn: 1 }), index),
  )
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(date, { weekStartsOn: 1 }), index))

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu" />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><CalendarDays size={21} /></div>
          <span>family<span className="brand-dot">.</span></span>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu"><X size={18} /></button>
        </div>

        <nav className="sidebar-section" aria-label="Sezioni">
          {([
            ['calendar', 'Calendario'],
            ['media', 'File e riproduzione'],
            ['watch', 'Watch-decider'],
          ] as const).map(([value, label]) => <button key={value} className={`filter-row ${section === value ? 'filter-selected' : ''}`} onClick={() => { setSection(value); setSidebarOpen(false) }}>{label}</button>)}
        </nav>
        {section === 'calendar' && <button className="create-button" onClick={() => openNewItem(date)} disabled={!canEdit}>
          <Plus size={19} strokeWidth={2.2} />
          <span>Crea</span>
        </button>}

        {section === 'calendar' && <MiniCalendar
          date={date}
          onDateChange={setDate}
          onMonthChange={(direction) => setDate((current) => direction === 1 ? addMonths(current, 1) : subMonths(current, 1))}
        />}

        <div className="sidebar-section">
          <div className="section-heading">I miei calendari</div>
          {calendars.map((entry) => (
            <button key={entry.id} className={`filter-row ${entry.id === calendar.id ? 'filter-selected' : ''}`} onClick={() => {
              if (entry.id === calendar.id) return
              setSelectedCalendarId(entry.id)
              setMemberFilter(null)
              setEditorItem(undefined)
              setProfileEditorOpen(false)
            }}>
              <span className="color-dot dot-family" />
              <span>{entry.name}</span>
            </button>
          ))}
          <button className="filter-row" onClick={() => { setError(''); setSetupOpen(true) }}><Plus size={15} /><span>Crea o aggiungi calendario</span></button>
          <div className="section-heading">Tipi</div>
          <button className={`filter-row ${filter === 'all' ? 'filter-selected' : ''}`} onClick={() => setFilter('all')}>
            <span className="color-dot dot-everyone" />
            <span>Tutti</span>
          </button>
          <button className={`filter-row ${filter === 'event' ? 'filter-selected' : ''}`} onClick={() => setFilter('event')}>
            <span className="color-dot dot-event" />
            <span>Eventi</span>
          </button>
          <button className={`filter-row ${filter === 'task' ? 'filter-selected' : ''}`} onClick={() => setFilter('task')}>
            <span className="color-dot dot-task" />
            <span>Task</span>
          </button>
          <button className={`filter-row ${filter === 'lesson' ? 'filter-selected' : ''}`} onClick={() => setFilter('lesson')}>
            <span className="color-dot dot-lesson" />
            <span>Lezioni</span>
          </button>
        </div>

        <div className="sidebar-section people-section">
          <div className="people-section-head">
            <div className="section-heading">Persone <span>{members.length}</span></div>
            <button
              className="icon-button profile-edit-button"
              onClick={() => setProfileEditorOpen(true)}
              disabled={!currentMember}
              title="Personalizza il tuo profilo"
              aria-label="Personalizza il tuo profilo"
            ><Settings2 size={15} /></button>
          </div>
          <button
            className={`filter-row ${memberFilter === null ? 'filter-selected' : ''}`}
            onClick={() => setMemberFilter(null)}
          >
            <span className="color-dot dot-everyone" />
            <span>Tutti</span>
          </button>
          {members.map((member) => (
            <div key={member.user_id}>
            <button
              className={`filter-row person-filter-row ${memberFilter === member.user_id ? 'filter-selected' : ''}`}
              onClick={() => setMemberFilter(member.user_id)}
              title={`Mostra gli elementi assegnati a ${memberDisplayName(member)}`}
            >
              <MemberAvatar member={member} small />
              <span className="member-row-name">{memberDisplayName(member)}</span>
              {member.user_id === user.id && <span className="member-you">Tu</span>}
            </button>
            <small>{member.role === 'owner' ? 'Proprietario' : member.can_edit ? 'Può modificare' : 'Sola lettura'}</small>
            {currentMember?.role === 'owner' && member.role !== 'owner' && <div>
              <button className="text-button" onClick={() => void manageMember(member, false)}>{member.can_edit ? 'Rendi lettore' : 'Abilita modifica'}</button>
              <button className="text-button" onClick={() => void manageMember(member, true)}>Rimuovi</button>
            </div>}
            </div>
          ))}
        </div>

        {inviteCode && <div className="invite-card">
          <div className="invite-icon"><UsersRound size={17} /></div>
          <div className="invite-copy">
            <strong>Condividi con la famiglia</strong>
            <span>Codice: <b>{inviteCode}</b></span>
          </div>
          <button
            className="icon-button copy-button"
            title="Copia codice invito"
            onClick={() => {
              if (!navigator.clipboard) {
                setError('Copia non disponibile in questo browser o contesto.')
                return
              }
              void navigator.clipboard.writeText(inviteCode)
                .then(() => setNotice('Codice invito copiato.'))
                .catch((copyError: unknown) => setError(`Non è stato possibile copiare il codice: ${readableError(copyError)}`))
            }}
          ><Copy size={15} /></button>
        </div>}

        <div className="sidebar-bottom">
          <div className="account-row">
            <div className="avatar">{(user.email?.[0] ?? 'F').toLocaleUpperCase('it-IT')}</div>
            <div className="account-copy"><strong>{user.email}</strong><span>Calendario condiviso</span></div>
            <button className="icon-button signout-button" onClick={() => { if (supabase) void supabase.auth.signOut() }} title="Esci"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Apri menu"><Menu size={20} /></button>
            <div className="topbar-brand"><span className="brand-mark small"><CalendarDays size={18} /></span><span>family<span className="brand-dot">.</span></span></div>
            {section === 'calendar' && <><button className="today-button" onClick={() => setDate(new Date())}>Oggi</button>
            <div className="nav-arrows">
              <button className="icon-button" onClick={() => navigate(-1)} aria-label="Periodo precedente"><ArrowLeft size={18} /></button>
              <button className="icon-button" onClick={() => navigate(1)} aria-label="Periodo successivo"><ArrowRight size={18} /></button>
            </div>
            <h1 className="date-heading">{formatMonthHeading(date)}</h1></>}
            {section !== 'calendar' && <h1 className="date-heading">{calendar.name}</h1>}
          </div>
          <div className="topbar-actions">
            {dataLoading && <LoaderCircle className="loading-icon" size={18} />}
            {section === 'calendar' && <><div className="view-switch" role="group" aria-label="Vista calendario">
              <button className={view === 'week' ? 'view-active' : ''} onClick={() => setView('week')}>Settimana</button>
              <button className={view === 'month' ? 'view-active' : ''} onClick={() => setView('month')}>Mese</button>
            </div>
            <button className="icon-button help-button" title="Aiuto" onClick={() => setNotice('Clicca su un giorno o su Crea per aggiungere eventi, task e lezioni.')}><CircleHelp size={19} /></button></>}
            <div className="avatar top-avatar">{(user.email?.[0] ?? 'F').toLocaleUpperCase('it-IT')}</div>
          </div>
        </header>

        {(error || notice) && (
          <div className={`toast ${error ? 'toast-error' : ''}`} role="status">
            <span>{error || notice}</span>
            <button className="icon-button" onClick={() => { setError(''); setNotice('') }} aria-label="Chiudi"><X size={15} /></button>
          </div>
        )}

        {section === 'calendar' && <section className="calendar-content">
          {view === 'week' ? (
            <WeekCalendar
              days={weekDays}
              items={selectedItems}
              members={members}
              onCreate={openNewItem}
              onEdit={(item) => setEditorItem(item)}
              onToggleTask={toggleTask}
            />
          ) : (
            <MonthCalendar
              days={monthDays}
              date={date}
              items={selectedItems}
              members={members}
              onCreate={openNewItem}
              onEdit={(item) => setEditorItem(item)}
              onToggleTask={toggleTask}
            />
          )}
        </section>}
        {section === 'media' && <SharedMedia key={calendar.id} calendarId={calendar.id} canEdit={canEdit} />}
        {section === 'watch' && <WatchDecider key={calendar.id} calendarId={calendar.id} userId={user.id} canEdit={canEdit} members={members} />}
      </main>

      {editorItem !== undefined && (
        <ItemEditor
          item={editorItem}
          initialDate={createDay ?? date}
          members={members}
          currentUserId={user.id}
          canEdit={canEdit}
          onClose={() => setEditorItem(undefined)}
          onSave={saveItem}
          onDelete={editorItem ? () => void deleteItem(editorItem.id) : undefined}
        />
      )}
      {profileEditorOpen && currentMember && (
        <MemberProfileEditor
          member={currentMember}
          onClose={() => setProfileEditorOpen(false)}
          onSave={saveMemberProfile}
        />
      )}
    </div>
  )
}

function LoadingScreen() {
  return <main className="loading-screen"><div className="brand-mark"><CalendarDays size={22} /></div><LoaderCircle className="loading-icon" size={20} /><span>Caricamento calendario…</span></main>
}

function AuthScreen({
  onSubmit,
  error,
  notice,
}: {
  onSubmit: (mode: 'signin' | 'signup', email: string, password: string) => Promise<void>
  error: string
  notice: string
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    await onSubmit(mode, email, password)
    setSubmitting(false)
  }

  return (
    <main className="auth-screen">
      <div className="auth-decoration decoration-one" />
      <div className="auth-decoration decoration-two" />
      <section className="auth-card">
        <div className="auth-brand"><div className="brand-mark"><CalendarDays size={22} /></div><span>family<span className="brand-dot">.</span></span></div>
        <p className="eyebrow">LA VITA, INSIEME</p>
        <h1>{mode === 'signin' ? 'Bentornato.' : 'Inizia a organizzarti.'}</h1>
        <p className="auth-subtitle">Il tempo condiviso comincia da qui.</p>
        <div className="auth-tabs">
          <button className={mode === 'signin' ? 'auth-tab-active' : ''} onClick={() => setMode('signin')}>Accedi</button>
          <button className={mode === 'signup' ? 'auth-tab-active' : ''} onClick={() => setMode('signup')}>Crea account</button>
        </div>
        <form onSubmit={(event) => void submit(event)} className="auth-form">
          <label>Email<input type="email" autoComplete="email" placeholder="nome@esempio.it" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="Almeno 6 caratteri" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required /></label>
          {error && <p className="form-message form-error">{error}</p>}
          {notice && <p className="form-message form-notice">{notice}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={submitting}>
            {submitting ? <LoaderCircle className="loading-icon" size={18} /> : mode === 'signin' ? 'Accedi al calendario' : 'Crea il tuo account'}
          </button>
        </form>
        <div className="auth-footnote"><Sparkles size={14} /> Privato, condiviso solo con chi inviti.</div>
      </section>
    </main>
  )
}

function CalendarSetup({
  email,
  error,
  loading,
  onCreate,
  onJoin,
  onSignOut,
  onCancel,
}: {
  email: string
  error: string
  loading: boolean
  onCreate: (name: string) => Promise<void>
  onJoin: (code: string) => Promise<void>
  onSignOut: () => Promise<void>
  onCancel?: () => void
}) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('Calendario di famiglia')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    if (mode === 'create') await onCreate(name.trim())
    else await onJoin(code.trim())
    setSubmitting(false)
  }

  return (
    <main className="setup-screen">
      <section className="setup-card">
        <div className="setup-topline"><div className="auth-brand"><div className="brand-mark"><CalendarDays size={22} /></div><span>family<span className="brand-dot">.</span></span></div><button className="text-button" onClick={() => void onSignOut()}><LogOut size={15} /> Esci</button></div>
        <p className="eyebrow">QUASI PRONTO</p>
        <h1>Il vostro spazio, insieme.</h1>
        <p className="auth-subtitle">Crea un nuovo calendario condiviso oppure unisciti a uno già esistente.</p>
        <div className="account-chip"><div className="avatar">{(email[0] ?? 'F').toLocaleUpperCase('it-IT')}</div>{email}</div>
        <div className="setup-tabs">
          <button className={mode === 'create' ? 'setup-tab-active' : ''} onClick={() => setMode('create')}><Plus size={16} /> Crea nuovo</button>
          <button className={mode === 'join' ? 'setup-tab-active' : ''} onClick={() => setMode('join')}><UsersRound size={16} /> Ho un codice</button>
        </div>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {mode === 'create' ? (
            <label>Nome del calendario<input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required /></label>
          ) : (
            <label>Codice invito<input className="invite-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ES. FAMIGLIA-AB12CD" required /></label>
          )}
          {error && <p className="form-message form-error">{error}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={submitting || loading}>
            {submitting || loading ? <LoaderCircle className="loading-icon" size={18} /> : mode === 'create' ? 'Crea calendario' : 'Unisciti al calendario'}
          </button>
        </form>
        <p className="privacy-note"><Settings2 size={15} /> Puoi invitare altre persone condividendo il codice del calendario.</p>
        {onCancel && <button className="text-button" type="button" onClick={onCancel}>Torna al calendario</button>}
      </section>
    </main>
  )
}

function MiniCalendar({
  date,
  onDateChange,
  onMonthChange,
}: {
  date: Date
  onDateChange: (date: Date) => void
  onMonthChange: (direction: -1 | 1) => void
}) {
  const first = startOfWeek(startOfMonth(date), { weekStartsOn: 1 })
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index))
  return (
    <div className="mini-calendar">
      <div className="mini-heading"><strong>{formatMonthHeading(date)}</strong><div><button className="icon-button" onClick={() => onMonthChange(-1)} aria-label="Mese precedente"><ArrowLeft size={15} /></button><button className="icon-button" onClick={() => onMonthChange(1)} aria-label="Mese successivo"><ArrowRight size={15} /></button></div></div>
      <div className="mini-grid mini-weekdays">{['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="mini-grid">{days.map((day) => <button key={day.toISOString()} className={`mini-day ${!isSameMonth(day, date) ? 'mini-muted' : ''} ${isSameDay(day, date) ? 'mini-selected' : ''} ${isToday(day) ? 'mini-today' : ''}`} onClick={() => onDateChange(day)}>{format(day, 'd')}</button>)}</div>
    </div>
  )
}

function WeekCalendar({
  days,
  items,
  members,
  onCreate,
  onEdit,
  onToggleTask,
}: {
  days: Date[]
  items: CalendarItem[]
  members: CalendarMember[]
  onCreate: (day: Date) => void
  onEdit: (item: CalendarItem) => void
  onToggleTask: (item: CalendarItem) => void
}) {
  const timedItems = items.filter((item) => !item.all_day && item.item_type !== 'task')
  const allDayItems = items.filter((item) => item.all_day || item.item_type === 'task')

  return (
    <div className="week-calendar">
      <div className="week-header">
        <div className="time-gutter-header">GMT{format(new Date(), 'xxx')}</div>
        {days.map((day) => <div key={day.toISOString()} className={`day-heading ${isToday(day) ? 'day-heading-today' : ''}`}><span>{format(day, 'EEE', { locale: it }).toLocaleUpperCase('it-IT')}</span><strong>{format(day, 'd')}</strong></div>)}
      </div>
      <div className="all-day-row">
        <div className="all-day-label">Tutto<br />il giorno</div>
        {days.map((day) => <div className="all-day-cell" key={day.toISOString()} onDoubleClick={() => onCreate(day)}>
          {allDayItems.filter((item) => isSameDay(parseISO(item.starts_at), day)).map((item) => <CalendarItemChip key={item.id} item={item} members={members} onEdit={onEdit} onToggleTask={onToggleTask} compact />)}
        </div>)}
      </div>
      <div className="week-scroll">
        <div className="time-column">{HOURS.map((hour) => <div className="time-label" key={hour}>{format(new Date(2020, 0, 1, hour), 'HH:mm')}</div>)}</div>
        <div className="week-grid">
          {days.map((day) => (
            <div className={`day-column ${isToday(day) ? 'day-column-today' : ''}`} key={day.toISOString()} onDoubleClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              const offset = Math.max(0, event.clientY - rect.top)
              const hour = Math.min(22, 7 + Math.floor(offset / 64))
              const newDate = new Date(day)
              newDate.setHours(hour, 0, 0, 0)
              onCreate(newDate)
            }}>
              {HOURS.map((hour) => <div className="hour-cell" key={hour} />)}
              {timedItems.filter((item) => isSameDay(parseISO(item.starts_at), day)).map((item) => {
                const start = parseISO(item.starts_at)
                const end = parseISO(item.ends_at)
                const assignee = members.find((member) => member.user_id === item.assignee_id)
                const top = (start.getHours() - 7 + start.getMinutes() / 60) * 64
                const height = Math.max(30, Math.min(16, (end.getTime() - start.getTime()) / 3_600_000) * 64)
                return <button key={item.id} className={`week-event event-${item.item_type}`} style={{ top: `${top}px`, height: `${height}px`, borderLeftColor: assignee ? MEMBER_COLORS[assignee.color] : undefined }} title={assignee ? `${item.title} · ${memberDisplayName(assignee)}` : item.title} onClick={(event) => { event.stopPropagation(); onEdit(item) }}>
                  <strong>{item.title}</strong><span>{format(start, 'HH:mm')} – {format(end, 'HH:mm')}{assignee ? ` · ${memberDisplayName(assignee)}` : ''}</span>
                </button>
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MonthCalendar({
  days,
  date,
  items,
  members,
  onCreate,
  onEdit,
  onToggleTask,
}: {
  days: Date[]
  date: Date
  items: CalendarItem[]
  members: CalendarMember[]
  onCreate: (day: Date) => void
  onEdit: (item: CalendarItem) => void
  onToggleTask: (item: CalendarItem) => void
}) {
  return (
    <div className="month-calendar">
      <div className="month-weekdays">{['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'].map((day) => <div key={day}>{day}</div>)}</div>
      <div className="month-grid">
        {days.map((day) => (
          <div key={day.toISOString()} className={`month-cell ${!isSameMonth(day, date) ? 'month-cell-muted' : ''} ${isToday(day) ? 'month-cell-today' : ''}`} onDoubleClick={() => onCreate(day)}>
            <div className="month-cell-top"><button className={`month-date ${isToday(day) ? 'month-date-today' : ''}`} onClick={() => onCreate(day)}>{format(day, 'd')}</button><button className="month-add" onClick={() => onCreate(day)} aria-label={`Aggiungi il ${format(day, 'd MMMM', { locale: it })}`}><Plus size={14} /></button></div>
            <div className="month-items">
              {items.filter((item) => isSameDay(parseISO(item.starts_at), day)).slice(0, 4).map((item) => <CalendarItemChip key={item.id} item={item} members={members} onEdit={onEdit} onToggleTask={onToggleTask} compact />)}
              {items.filter((item) => isSameDay(parseISO(item.starts_at), day)).length > 4 && <span className="more-items">+ altri</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CalendarItemChip({
  item,
  members,
  onEdit,
  onToggleTask,
  compact = false,
}: {
  item: CalendarItem
  members: CalendarMember[]
  onEdit: (item: CalendarItem) => void
  onToggleTask: (item: CalendarItem) => void
  compact?: boolean
}) {
  const assignee = members.find((member) => member.user_id === item.assignee_id)
  return (
    <div
      className={`item-chip event-${item.item_type} ${item.completed ? 'item-completed' : ''} ${compact ? 'item-chip-compact' : ''}`}
      title={assignee ? `${item.title} · ${memberDisplayName(assignee)}` : item.title}
    >
      {item.item_type === 'task' ? (
        <button className="task-check" onClick={(event) => { event.stopPropagation(); void onToggleTask(item) }} aria-label={item.completed ? 'Segna come da fare' : 'Segna come completata'}>
          {item.completed && <Check size={11} />}
        </button>
      ) : <span className="item-time-dot" />}
      {assignee && <span className="assigned-color-dot" style={{ backgroundColor: MEMBER_COLORS[assignee.color] }} />}
      <button className="item-title" onClick={() => onEdit(item)} title={item.title}>{item.title}</button>
    </div>
  )
}

function MemberAvatar({ member, small = false }: { member: CalendarMember; small?: boolean }) {
  const name = memberDisplayName(member)
  return (
    <span
      className={`person-avatar ${small ? 'person-avatar-small' : ''}`}
      style={{ backgroundColor: MEMBER_COLORS[member.color] ?? MEMBER_COLORS.violet }}
      aria-label={name}
    >
      {memberInitials(name)}
    </span>
  )
}

function ItemEditor({
  item,
  initialDate,
  members,
  currentUserId,
  canEdit,
  onClose,
  onSave,
  onDelete,
}: {
  item: CalendarItem | null
  initialDate: Date
  members: CalendarMember[]
  currentUserId: string
  canEdit: boolean
  onClose: () => void
  onSave: (form: { title: string; description: string; item_type: CalendarItemType; starts_at: string; ends_at: string; all_day: boolean; assignee_id: string | null; visibility: 'everyone' | 'selected'; visible_to: string[] }) => Promise<boolean>
  onDelete?: () => void
}) {
  const defaults = getDefaultTimes(initialDate)
  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [itemType, setItemType] = useState<CalendarItemType>(item?.item_type ?? 'event')
  const [startsAt, setStartsAt] = useState(item ? localDateTime(parseISO(item.starts_at)) : defaults.starts_at)
  const [endsAt, setEndsAt] = useState(item ? localDateTime(parseISO(item.ends_at)) : defaults.ends_at)
  const [allDay, setAllDay] = useState(item?.all_day ?? false)
  const [assigneeId, setAssigneeId] = useState(item ? item.assignee_id ?? '' : currentUserId)
  const [visibility, setVisibility] = useState<'everyone' | 'selected'>(item?.visibility ?? 'everyone')
  const [visibleTo, setVisibleTo] = useState<string[]>(item?.visible_to ?? [])
  const [validationError, setValidationError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    if (new Date(endsAt) < new Date(startsAt)) {
      setValidationError('L’orario di fine deve essere successivo all’orario di inizio.')
      return
    }
    setValidationError('')
    setSaving(true)
    const recipients = [...new Set([...visibleTo, currentUserId])]
    const saved = await onSave({ title, description, item_type: itemType, starts_at: startsAt, ends_at: endsAt, all_day: allDay || itemType === 'task', assignee_id: assigneeId || null, visibility, visible_to: recipients })
    setSaving(false)
    if (saved) onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="item-modal" role="dialog" aria-modal="true" aria-labelledby="item-modal-title">
        <div className="modal-top"><span className="eyebrow">{item ? 'MODIFICA ELEMENTO' : 'NUOVO ELEMENTO'}</span><button className="icon-button" onClick={onClose} aria-label="Chiudi"><X size={19} /></button></div>
        <h2 id="item-modal-title">{item ? 'Aggiorna il calendario' : 'Aggiungi al calendario'}</h2>
        {!canEdit && <p>Accesso in sola lettura</p>}
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
          <input className="title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Aggiungi un titolo" maxLength={120} required autoFocus />
          <div className="type-selector" role="group" aria-label="Tipo di elemento">
            {(['event', 'task', 'lesson'] as const).map((type) => <button type="button" className={`type-option ${itemType === type ? `type-active type-${type}` : ''}`} key={type} onClick={() => { setItemType(type); if (type === 'task') setAllDay(true) }}><span className={`type-icon type-icon-${type}`}>{type === 'event' ? <CalendarDays size={15} /> : type === 'task' ? <CheckSquare size={15} /> : <BookOpen size={15} />}</span>{itemLabels[type]}</button>)}
          </div>
          <label className="modal-field"><span><Clock3 size={16} /> Inizio</span><input type="datetime-local" value={startsAt} onChange={(event) => { setStartsAt(event.target.value); setValidationError('') }} required /></label>
          {itemType !== 'task' && <label className="modal-field"><span><Clock3 size={16} /> Fine</span><input type="datetime-local" value={endsAt} onChange={(event) => { setEndsAt(event.target.value); setValidationError('') }} required /></label>}
          {itemType !== 'task' && <label className="checkbox-field"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} /><span>Tutto il giorno</span></label>}
          <label className="description-field"><span>Assegnato a</span><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Nessuno</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{memberDisplayName(member)}</option>)}</select></label>
          <label className="description-field"><span>Visibilità</span><select value={visibility} onChange={(event) => setVisibility(event.target.value === 'selected' ? 'selected' : 'everyone')}><option value="everyone">Tutti i membri</option><option value="selected">Solo persone selezionate</option></select></label>
          {visibility === 'selected' && <div>
            <p>Tu e il creatore vedete sempre questo elemento. Seleziona altre persone:</p>
            {members.filter((member) => member.user_id !== currentUserId && member.user_id !== item?.created_by).map((member) => <label className="checkbox-field" key={member.user_id}><input type="checkbox" checked={visibleTo.includes(member.user_id)} onChange={(event) => setVisibleTo((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} /><span>{memberDisplayName(member)}</span></label>)}
          </div>}
          <label className="description-field"><span>Descrizione <small>Facoltativa</small></span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Aggiungi dettagli..." maxLength={1000} /></label>
          </fieldset>
          {validationError && <p className="form-message form-error">{validationError}</p>}
          <div className="modal-footer">{onDelete && canEdit ? <button type="button" className="delete-button" onClick={onDelete}><Trash2 size={16} /> Elimina</button> : <span />}
            <div><button type="button" className="cancel-button" onClick={onClose}>{canEdit ? 'Annulla' : 'Chiudi'}</button>{canEdit && <button className="primary-button save-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="loading-icon" size={17} /> : item ? 'Salva modifiche' : 'Crea'}</button>}</div>
          </div>
        </form>
      </section>
    </div>
  )
}

function MemberProfileEditor({ member, onClose, onSave }: {
  member: CalendarMember
  onClose: () => void
  onSave: (displayName: string, color: MemberColor) => Promise<boolean>
}) {
  const [name, setName] = useState(member.display_name)
  const [color, setColor] = useState<MemberColor>(member.color)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const saved = await onSave(name, color)
    setSaving(false)
    if (saved) onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="item-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
        <div className="modal-top"><span className="eyebrow">PROFILO</span><button className="icon-button" onClick={onClose} aria-label="Chiudi"><X size={19} /></button></div>
        <h2 id="profile-modal-title">Personalizza il tuo profilo</h2>
        <form onSubmit={(event) => void submit(event)} className="auth-form">
          <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required /></label>
          <label>Colore<select value={color} onChange={(event) => setColor(event.target.value as MemberColor)}>{(Object.keys(MEMBER_COLOR_LABELS) as MemberColor[]).map((value) => <option key={value} value={value}>{MEMBER_COLOR_LABELS[value]}</option>)}</select></label>
          <div className="modal-footer"><span /><div><button type="button" className="cancel-button" onClick={onClose}>Annulla</button><button type="submit" className="primary-button save-button" disabled={saving}>Salva</button></div></div>
        </form>
      </section>
    </div>
  )
}

export default App
