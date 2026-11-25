import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, MouseEvent, PointerEvent } from 'react'
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
  Eye,
  EyeOff,
  LoaderCircle,
  LogOut,
  Menu,
  Music2,
  Plus,
  Settings2,
  Sparkles,
  Tag,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react'
import { setActiveDatabaseUser, supabase } from './lib/supabase'
import { getDatabaseStatus, subscribeDatabaseStatus } from './lib/databaseStatus'
import { SharedMedia } from './SharedMedia'
import { GoogleCalendarSettings } from './GoogleCalendarSettings'
import { UniversitySchedules } from './UniversitySchedules'
import { WatchDecider } from './WatchDecider'
import { ProfileSection } from './ProfileSection'
import { MiiPortrait, normalizeMii } from './mii'
import {
  MEMBER_COLORS,
  type CategoryAppearance,
  type CalendarViewPreferences,
  type CalendarItem,
  type CalendarItemType,
  type CalendarMember,
  type CalendarView,
  type FamilyCalendar,
  type InterfaceTheme,
  type MemberColor,
  type EventTexture,
  type MiiConfig,
  type UserProfile,
} from './types'

type ItemFilter = 'all' | CalendarItemType
type GoogleCalendarEventRow = {
  id: string
  user_id: string
  calendar_id: string
  title: string
  description: string
  starts_at: string
  ends_at: string
  start_date: string | null
  end_date: string | null
  all_day: boolean
  tags: string[]
  source_url: string | null
}

function googleEventAsCalendarItem(row: GoogleCalendarEventRow): CalendarItem {
  const localDateStart = (value: string | null) => {
    if (!value) return row.starts_at
    const [year, month, day] = value.slice(0, 10).split('-').map(Number)
    return new Date(year, month - 1, day).toISOString()
  }
  return {
    id: row.id,
    calendar_id: row.calendar_id,
    title: row.title,
    description: row.description,
    item_type: 'event',
    starts_at: row.all_day ? localDateStart(row.start_date) : row.starts_at,
    ends_at: row.all_day ? localDateStart(row.end_date) : row.ends_at,
    all_day: row.all_day,
    completed: false,
    assignee_id: row.user_id,
    created_by: row.user_id,
    visibility: 'private',
    visible_to: [],
    editable_by: [],
    tags: row.tags,
    source_provider: 'google',
    source_url: row.source_url,
  }
}

const HOURS = Array.from({ length: 24 }, (_, index) => index)
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))
const DEFAULT_WEEK_HOUR_HEIGHT = 24
const MIN_WEEK_HOUR_HEIGHT = 20
const MAX_WEEK_HOUR_HEIGHT = 44
const itemLabels: Record<CalendarItemType, string> = {
  event: 'Evento',
  task: 'Task',
  lesson: 'Lezione',
}
const itemTypes: CalendarItemType[] = ['event', 'task', 'lesson']
const memberColorOptions: Array<[MemberColor, string]> = [
  ['violet', 'Viola'], ['blue', 'Blu'], ['coral', 'Corallo'],
  ['green', 'Verde'], ['amber', 'Ambra'], ['pink', 'Rosa'],
]
const eventTextures: Array<[EventTexture, string]> = [
  ['plain', 'Tinta unita'], ['stripes', 'Righe'], ['dots', 'Punti'], ['grid', 'Griglia'],
]
const itemPalettes: Record<MemberColor, { background: string; foreground: string }> = {
  violet: { background: '#f0efff', foreground: '#514bb1' },
  blue: { background: '#eef2ff', foreground: '#43569b' },
  coral: { background: '#fff0ed', foreground: '#9b5146' },
  green: { background: '#e9f7f2', foreground: '#327b69' },
  amber: { background: '#fff5e8', foreground: '#946126' },
  pink: { background: '#fff0f8', foreground: '#984d7e' },
}
const defaultCategoryStyles: Record<CalendarItemType, CategoryAppearance> = {
  event: { color: 'blue', texture: 'plain' },
  task: { color: 'green', texture: 'dots' },
  lesson: { color: 'amber', texture: 'stripes' },
}
const defaultInterfaceTheme: InterfaceTheme = { mode: 'light', accent: 'violet', density: 'comfortable' }

function isMemberColor(value: unknown): value is MemberColor {
  return typeof value === 'string' && memberColorOptions.some(([color]) => color === value)
}

function isEventTexture(value: unknown): value is EventTexture {
  return typeof value === 'string' && eventTextures.some(([texture]) => texture === value)
}

function normalizeInterfaceTheme(value: unknown): InterfaceTheme {
  if (!value || typeof value !== 'object') return defaultInterfaceTheme
  const theme = value as Partial<InterfaceTheme>
  return {
    mode: theme.mode === 'dark' ? 'dark' : 'light',
    accent: isMemberColor(theme.accent) ? theme.accent : defaultInterfaceTheme.accent,
    density: theme.density === 'compact' ? 'compact' : 'comfortable',
  }
}

function defaultViewPreferences(calendarId: string, userId: string): CalendarViewPreferences {
  return { calendar_id: calendarId, user_id: userId, hidden_item_ids: [], hidden_member_ids: [], category_styles: defaultCategoryStyles }
}

function normalizeViewPreferences(value: unknown, calendarId: string, userId: string): CalendarViewPreferences {
  const defaults = defaultViewPreferences(calendarId, userId)
  if (!value || typeof value !== 'object') return defaults
  const row = value as Partial<CalendarViewPreferences>
  const styles: CalendarViewPreferences['category_styles'] = { ...defaultCategoryStyles }
  for (const type of itemTypes) {
    const style = row.category_styles?.[type]
    if (style && isMemberColor(style.color) && isEventTexture(style.texture)) {
      styles[type] = { color: style.color, texture: style.texture }
    }
  }
  return {
    ...defaults,
    hidden_item_ids: Array.isArray(row.hidden_item_ids) ? row.hidden_item_ids.filter((id): id is string => typeof id === 'string') : [],
    hidden_member_ids: Array.isArray(row.hidden_member_ids) ? row.hidden_member_ids.filter((id): id is string => typeof id === 'string') : [],
    category_styles: styles,
  }
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
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return 'Si è verificato un errore imprevisto.'
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
  const [editInviteCode, setEditInviteCode] = useState<string | null>(null)
  const [items, setItems] = useState<CalendarItem[]>([])
  const [dataLoading, setDataLoading] = useState(false)
  const [date, setDate] = useState(new Date())
  const [view, setView] = useState<CalendarView>('week')
  const [filter, setFilter] = useState<ItemFilter>('all')
  const [memberFilter, setMemberFilter] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [viewPreferences, setViewPreferences] = useState<{ key: string; value: CalendarViewPreferences; exists: boolean } | null>(null)
  const [editorItem, setEditorItem] = useState<CalendarItem | null | undefined>(undefined)
  const [draftItem, setDraftItem] = useState<CalendarItem | null>(null)
  const [createDay, setCreateDay] = useState<Date | null>(null)
  const [allMembers, setAllMembers] = useState<CalendarMember[]>([])
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({})
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [section, setSection] = useState<'calendar' | 'media' | 'watch' | 'schedules' | 'google-calendar' | 'profile'>('calendar')
  const [googleItems, setGoogleItems] = useState<CalendarItem[]>([])
  const googleEventLoadSequence = useRef(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [databaseStatus, setDatabaseStatusState] = useState(getDatabaseStatus)

  const user = session?.user ?? null
  const viewPreferencesKey = calendar && user ? `${calendar.id}:${user.id}` : ''
  const activeViewPreferences = viewPreferences?.key === viewPreferencesKey
    ? viewPreferences.value
    : calendar && user ? defaultViewPreferences(calendar.id, user.id) : null
  const currentMember = members.find((member) => member.user_id === user?.id)
  const myMii = user ? profiles[user.id]?.avatar ?? null : null
  const interfaceTheme = user ? normalizeInterfaceTheme(profiles[user.id]?.interface_theme) : defaultInterfaceTheme
  const canEdit = currentMember?.role === 'owner' || currentMember?.can_edit === true
  const canEditItem = (item: CalendarItem) => Boolean(user && (
    item.source_provider !== 'google' && (item.created_by === user.id || item.editable_by?.includes(user.id))
  ))
  const allCalendarItems = useMemo(() => [...items, ...googleItems], [googleItems, items])
  const selectedItems = useMemo(
    () => {
      const query = filterText.trim().toLocaleLowerCase('it-IT')
      const hiddenItems = activeViewPreferences?.hidden_item_ids ?? []
      const hiddenMembers = activeViewPreferences?.hidden_member_ids ?? []
      return allCalendarItems.filter((item) =>
        (filter === 'all' || item.item_type === filter)
        && (memberFilter === null || item.assignee_id === memberFilter)
        && !hiddenItems.includes(item.id)
        && !hiddenMembers.includes(item.created_by)
        && (!query || [item.title, item.description, ...(item.tags ?? [])]
          .some((value) => value.toLocaleLowerCase('it-IT').includes(query))),
      )
    },
    [activeViewPreferences, allCalendarItems, filter, filterText, memberFilter],
  )

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = interfaceTheme.mode
    root.dataset.accent = interfaceTheme.accent
    root.dataset.density = interfaceTheme.density
  }, [interfaceTheme.mode, interfaceTheme.accent, interfaceTheme.density])

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }

    let active = true
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setActiveDatabaseUser(data.session?.user ?? null)
      setSession(data.session)
      setAuthLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, nextSession) => {
      setActiveDatabaseUser(nextSession?.user ?? null)
      setSession(nextSession)
      setError('')
      setNotice('')
    })

    return () => {
      active = false
      setActiveDatabaseUser(null)
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => subscribeDatabaseStatus(setDatabaseStatusState), [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const googleStatus = params.get('google_calendar')
    if (!googleStatus) return
    setSection('google-calendar')
    const linkedCalendarId = params.get('calendar_id')
    if (linkedCalendarId) setSelectedCalendarId(linkedCalendarId)
    if (googleStatus === 'connected') setNotice('Account Google collegato. Scegli i calendari da mostrare.')
    else if (googleStatus === 'denied') setError('Autorizzazione Google annullata.')
    else if (googleStatus === 'not_configured') setError('Google Calendar non è ancora configurato sul server.')
    else setError('Collegamento Google Calendar non riuscito. Riprova.')
    params.delete('google_calendar')
    params.delete('calendar_id')
    const query = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
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
        setAllMembers([])
        setProfiles({})
        setInviteCode(null)
        setEditInviteCode(null)
        setItems([])
        setViewPreferences(null)
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

      const { data: membershipRows, error: membersError } = await supabase
        .from('calendar_members')
        .select('calendar_id, user_id, display_name, color, role, can_edit, style_border, allow_style_editors')
        .in('calendar_id', (calendarRows ?? []).map((row) => row.id))
        .order('created_at')
      if (membersError) throw membersError
      const allCalendarMembers = (membershipRows ?? []) as CalendarMember[]
      const calendarMembers = allCalendarMembers.filter((member) => member.calendar_id === calendarRow.id)

      const profileUserIds = [...new Set(allCalendarMembers.map((member) => member.user_id))]
      const profileResult = profileUserIds.length
        ? await supabase.from('user_profiles').select('user_id, bio, avatar, interface_theme').in('user_id', profileUserIds)
        : null
      if (profileResult?.error) throw profileResult.error
      const loadedProfiles = Object.fromEntries((profileResult?.data ?? []).map((row) => [row.user_id, {
        user_id: row.user_id as string,
        bio: (row.bio as string) ?? '',
        avatar: normalizeMii(row.avatar),
        interface_theme: normalizeInterfaceTheme(row.interface_theme),
      }]))

      const [itemsResult, preferencesResult] = await Promise.all([
        supabase
          .from('calendar_items')
          .select('*')
          .eq('calendar_id', calendarRow.id)
          .order('starts_at'),
        supabase
          .from('calendar_view_preferences')
          .select('calendar_id, user_id, hidden_item_ids, hidden_member_ids, category_styles')
          .eq('calendar_id', calendarRow.id)
          .eq('user_id', currentUser.id),
      ])
      if (itemsResult.error) throw itemsResult.error
      if (preferencesResult.error) throw preferencesResult.error
      let code: string | null = null
      let editCode: string | null = null
      if (calendarMembers?.some((member) => member.user_id === currentUser.id && member.role === 'owner')) {
        const [viewInvite, editInvite] = await Promise.all([
          supabase.rpc('get_calendar_invite_code', { p_calendar_id: calendarRow.id }),
          supabase.rpc('get_calendar_edit_invite_code', { p_calendar_id: calendarRow.id }),
        ])
        if (viewInvite.error) throw viewInvite.error
        if (editInvite.error) throw editInvite.error
        code = viewInvite.data
        editCode = editInvite.data
      }

      if (sequence !== loadSequence.current) return
      setCalendars(calendarRows ?? [])
      setCalendar(calendarRow)
      setMembers(calendarMembers)
      setAllMembers(allCalendarMembers)
      setProfiles(loadedProfiles)
      setInviteCode(code)
      setEditInviteCode(editCode)
      setItems((itemsResult.data ?? []) as CalendarItem[])
      setViewPreferences({
        key: `${calendarRow.id}:${currentUser.id}`,
        value: normalizeViewPreferences(preferencesResult.data?.[0], calendarRow.id, currentUser.id),
        exists: Boolean(preferencesResult.data?.length),
      })
    } catch (loadError) {
      if (sequence === loadSequence.current) setError(`Impossibile caricare il calendario: ${readableError(loadError)}`)
    } finally {
      if (sequence === loadSequence.current) setDataLoading(false)
    }
  }, [selectedCalendarId])

  const refreshCalendarAfterScheduleSync = useCallback(() => {
    if (user) void loadCalendar(user)
  }, [loadCalendar, user])

  const refreshGoogleCalendarEvents = useCallback(async () => {
    const request = ++googleEventLoadSequence.current
    if (!supabase || !calendar || !user) {
      setGoogleItems([])
      return
    }
    const visibleStart = view === 'week'
      ? startOfWeek(date, { weekStartsOn: 1 })
      : startOfWeek(startOfMonth(date), { weekStartsOn: 1 })
    const visibleEnd = addDays(visibleStart, view === 'week' ? 7 : 42)
    const from = visibleStart.toISOString()
    const until = visibleEnd.toISOString()
    const fromDate = format(visibleStart, 'yyyy-MM-dd')
    const untilDate = format(visibleEnd, 'yyyy-MM-dd')
    const [timedResult, allDayResult] = await Promise.all([
      supabase.from('google_calendar_events').select('*')
        .eq('calendar_id', calendar.id).eq('user_id', user.id).eq('all_day', false)
        .lt('starts_at', until).gt('ends_at', from),
      supabase.from('google_calendar_events').select('*')
        .eq('calendar_id', calendar.id).eq('user_id', user.id).eq('all_day', true)
        .lt('start_date', untilDate).gt('end_date', fromDate),
    ])
    if (timedResult.error) throw timedResult.error
    if (allDayResult.error) throw allDayResult.error
    if (request === googleEventLoadSequence.current) {
      setGoogleItems([...(timedResult.data ?? []), ...(allDayResult.data ?? [])]
        .map((row) => googleEventAsCalendarItem(row as GoogleCalendarEventRow)))
    }
  }, [calendar, date, user, view])

  useEffect(() => {
    let active = true
    let syncRunning = false
    const syncGoogleCalendar = async () => {
      if (!supabase || !calendar || !user || syncRunning) return
      syncRunning = true
      try {
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session) return
        const response = await fetch('/api/google-calendar?action=sync', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ calendarId: calendar.id }),
        })
        const result = await response.json() as { connected?: boolean; error?: string; code?: string }
        if (!response.ok) {
          if (result.code === 'GOOGLE_CALENDAR_NOT_CONFIGURED') return
          throw new Error(result.error || `Richiesta non riuscita (HTTP ${response.status}).`)
        }
        if (active && result.connected) await refreshGoogleCalendarEvents()
      } catch (syncError) {
        if (active) setError(`Sincronizzazione Google Calendar non riuscita: ${readableError(syncError)}`)
      } finally {
        syncRunning = false
      }
    }
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') void syncGoogleCalendar()
    }
    void syncGoogleCalendar()
    const timer = window.setInterval(() => { void syncGoogleCalendar() }, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', syncWhenVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', syncWhenVisible)
    }
  }, [calendar, refreshGoogleCalendarEvents, user])

  useEffect(() => {
    let active = true
    void refreshGoogleCalendarEvents().catch((loadError: unknown) => {
      if (active) setError(`Impossibile caricare gli eventi Google Calendar: ${readableError(loadError)}`)
    })
    return () => { active = false }
  }, [refreshGoogleCalendarEvents])

  const saveViewPreferences = async (next: CalendarViewPreferences) => {
    if (!supabase || !calendar || !user) return
    const key = `${calendar.id}:${user.id}`
    const row = {
      calendar_id: calendar.id,
      user_id: user.id,
      hidden_item_ids: next.hidden_item_ids,
      hidden_member_ids: next.hidden_member_ids,
      category_styles: next.category_styles,
    }
    const previous = viewPreferences?.key === key
      ? viewPreferences
      : { key, value: defaultViewPreferences(calendar.id, user.id), exists: false }
    const exists = previous.exists
    setViewPreferences({ key, value: next, exists: true })
    const result = exists
      ? await supabase.from('calendar_view_preferences').update(row).eq('calendar_id', calendar.id).eq('user_id', user.id)
      : await supabase.from('calendar_view_preferences').insert(row)
    if (result.error) {
      setViewPreferences(previous)
      setError(`Impossibile salvare le preferenze personali: ${result.error.message}`)
      return
    }
    if (!exists) setViewPreferences({ key, value: next, exists: true })
  }

  const toggleHiddenItem = (itemId: string) => {
    if (!activeViewPreferences) return
    const hidden = activeViewPreferences.hidden_item_ids.includes(itemId)
    void saveViewPreferences({
      ...activeViewPreferences,
      hidden_item_ids: hidden
        ? activeViewPreferences.hidden_item_ids.filter((id) => id !== itemId)
        : [...activeViewPreferences.hidden_item_ids, itemId],
    })
  }

  const toggleHiddenMember = (memberId: string) => {
    if (!activeViewPreferences) return
    const hidden = activeViewPreferences.hidden_member_ids.includes(memberId)
    void saveViewPreferences({
      ...activeViewPreferences,
      hidden_member_ids: hidden
        ? activeViewPreferences.hidden_member_ids.filter((id) => id !== memberId)
        : [...activeViewPreferences.hidden_member_ids, memberId],
    })
  }

  const updateCategoryStyle = (itemType: CalendarItemType, change: Partial<{ color: MemberColor; texture: EventTexture }>) => {
    if (!activeViewPreferences) return
    const current = activeViewPreferences.category_styles?.[itemType] ?? defaultCategoryStyles[itemType]
    void saveViewPreferences({
      ...activeViewPreferences,
      category_styles: {
        ...defaultCategoryStyles,
        ...activeViewPreferences.category_styles,
        [itemType]: { ...current, ...change },
      },
    })
  }

  useEffect(() => {
    if (!user || !supabase) {
      loadSequence.current += 1
      setCalendar(null)
      setCalendars([])
      setSelectedCalendarId(null)
      setMembers([])
      setInviteCode(null)
      setEditInviteCode(null)
      setItems([])
      setViewPreferences(null)
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_view_preferences', filter: `calendar_id=eq.${calendar.id}` },
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
    if (!user || !calendar) {
      setNotice('Accedi a un calendario prima di creare un evento.')
      return
    }
    setCreateDay(day)
    setDraftItem(null)
    setEditorItem(null)
  }

  const createTimedDraft = (day: Date, minuteOfDay: number) => {
    if (!user || !calendar) {
      setNotice('Accedi a un calendario prima di creare un evento.')
      return
    }
    const startsAt = new Date(day)
    startsAt.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0)
    const endsAt = new Date(startsAt)
    endsAt.setMinutes(endsAt.getMinutes() + 60)
    const draft: CalendarItem = {
      id: `draft:${crypto.randomUUID()}`,
      calendar_id: calendar.id,
      title: 'Nuovo evento',
      description: '',
      item_type: 'event',
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      all_day: false,
      completed: false,
      assignee_id: user.id,
      created_by: user.id,
      visibility: 'everyone',
      visible_to: [],
      editable_by: [],
      tags: [],
    }
    setCreateDay(startsAt)
    setDraftItem(draft)
    setEditorItem(undefined)
    setNotice('Bozza creata. Trascinala per spostarla o regola le estremità; selezionala per aggiungere titolo e descrizione.')
  }

  const updateTimedItem = async (item: CalendarItem, startsAt: Date, endsAt: Date) => {
    if (!supabase || !user || !canEditItem(item)) return
    const isDraft = item.id.startsWith('draft:')
    if (isDraft) {
      setDraftItem({ ...item, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() })
      return
    }
    setError('')
    const { data: updated, error: updateError } = await supabase
      .from('calendar_items')
      .update({ starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() })
      .eq('id', item.id)
      .select('id')
      .maybeSingle()
    if (updateError) {
      setError(`Impossibile spostare l'evento: ${updateError.message}`)
      return
    }
    if (!updated) {
      setError('Evento non aggiornato: potrebbe non essere più disponibile o modificabile.')
      return
    }
    await loadCalendar(user)
  }

  const saveItem = async (form: {
    title: string
    description: string
    item_type: CalendarItemType
    starts_at: string
    ends_at: string
    all_day: boolean
    assignee_id: string | null
    visibility: 'private' | 'everyone' | 'selected'
    visible_to: string[]
    editable_by: string[]
    tags: string[]
  }) => {
    if (!supabase || !calendar || !user) return false
    setError('')
    const isDraft = editorItem?.id.startsWith('draft:') ?? false
    const canManageSharing = !editorItem || isDraft || editorItem.created_by === user.id
    const content = {
      calendar_id: calendar.id,
      title: form.title.trim(),
      description: form.description.trim(),
      item_type: form.item_type,
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: new Date(form.ends_at).toISOString(),
      all_day: form.all_day,
      assignee_id: form.assignee_id,
      tags: form.tags,
    }
    const sharing = canManageSharing ? {
      visibility: form.visibility,
      visible_to: form.visibility === 'selected' ? form.visible_to : [],
      editable_by: form.editable_by,
    } : {}
    try {
      const result = editorItem && !isDraft
        ? await supabase.from('calendar_items').update({ ...content, ...sharing }).eq('id', editorItem.id).select('id').maybeSingle()
        : await supabase.from('calendar_items').insert({
          ...content,
          ...sharing,
          created_by: user.id,
          visibility: form.visibility,
          visible_to: form.visibility === 'selected' ? form.visible_to : [],
          editable_by: form.editable_by,
        })
      if (result.error) {
        setError(`Impossibile salvare: ${result.error.message}`)
        return false
      }
      if (editorItem && !result.data) {
        setError('Elemento non aggiornato: potrebbe non essere più disponibile o modificabile.')
        return false
      }
      setEditorItem(undefined)
      if (isDraft) setDraftItem(null)
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
    if (!canEditItem(item)) {
      setNotice('Il creatore non ti ha autorizzato a modificare questa task.')
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

  const saveProfile = async (input: {
    displayName: string
    color: MemberColor
    styleBorder: CalendarMember['style_border']
    allowStyleEditors: boolean
    bio: string
    avatar: MiiConfig | null
  }) => {
    if (!supabase || !calendar || !user) return false
    setError('')
    try {
      const { error: updateError } = await supabase
        .from('calendar_members')
        .update({
          display_name: input.displayName.trim(),
          color: input.color,
          style_border: input.styleBorder,
          allow_style_editors: input.allowStyleEditors,
        })
        .eq('calendar_id', calendar.id)
        .eq('user_id', user.id)
      if (updateError) {
        setError(`Impossibile aggiornare il profilo: ${updateError.message}`)
        return false
      }

      const { error: profileError } = await supabase
        .from('user_profiles')
        .upsert({ user_id: user.id, bio: input.bio, avatar: input.avatar, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (profileError) {
        setError(`Impossibile salvare Mii e descrizione: ${profileError.message}`)
        await loadCalendar(user)
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

  const saveInterfaceTheme = async (theme: InterfaceTheme) => {
    if (!supabase || !user) return false
    setError('')
    try {
      const { error: themeError } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: user.id,
          interface_theme: theme,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
      if (themeError) throw themeError
      setProfiles((current) => ({
        ...current,
        [user.id]: {
          user_id: user.id,
          bio: current[user.id]?.bio ?? '',
          avatar: current[user.id]?.avatar ?? null,
          interface_theme: theme,
        },
      }))
      setNotice('Aspetto aggiornato.')
      return true
    } catch (themeError) {
      setError(`Impossibile salvare il tema: ${readableError(themeError)}`)
      return false
    }
  }

  const updateMemberAppearance = async (
    targetUserId: string,
    color: MemberColor,
    styleBorder: CalendarMember['style_border'],
  ) => {
    if (!supabase || !calendar || !user) return
    setError('')
    const { data: updated, error: updateError } = await supabase
      .from('calendar_members')
      .update({ color, style_border: styleBorder })
      .eq('calendar_id', calendar.id)
      .eq('user_id', targetUserId)
      .select('user_id')
      .maybeSingle()
    if (updateError) {
      setError(`Impossibile aggiornare l’aspetto del membro: ${updateError.message}`)
      return
    }
    if (!updated) {
      setError('Aspetto non aggiornato: il membro non ha consentito le modifiche degli editor.')
      return
    }
    await loadCalendar(user)
    setNotice('Aspetto del calendario aggiornato.')
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

  const rotateInvites = async () => {
    if (!supabase || !calendar || !user || !window.confirm('Revocare entrambi i codici? I membri attuali manterranno il loro accesso.')) return
    const { error: rotateError } = await supabase.rpc('rotate_calendar_invites', { p_calendar_id: calendar.id })
    if (rotateError) { setError(`Impossibile revocare gli inviti: ${rotateError.message}`); return }
    await loadCalendar(user)
    setNotice('Codici invito rigenerati.')
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

        <nav className="sidebar-navigation" aria-label="Navigazione principale">
          <button className={`sidebar-nav-link ${section === 'calendar' ? 'sidebar-nav-selected' : ''}`} onClick={() => { setSection('calendar'); setSidebarOpen(false) }}>
            <CalendarDays size={16} /><span>Calendario</span>
          </button>
          <details className="sidebar-nav-group" open>
            <summary><BookOpen size={16} /><span>Organizza</span></summary>
            <button className={`sidebar-nav-link ${section === 'schedules' ? 'sidebar-nav-selected' : ''}`} onClick={() => { setSection('schedules'); setSidebarOpen(false) }}>
              <Clock3 size={15} /><span>Orari universitari</span>
            </button>
            <button className={`sidebar-nav-link ${section === 'google-calendar' ? 'sidebar-nav-selected' : ''}`} onClick={() => { setSection('google-calendar'); setSidebarOpen(false) }}>
              <CalendarDays size={15} /><span>Google Calendar</span>
            </button>
          </details>
          <details className="sidebar-nav-group">
            <summary><Sparkles size={16} /><span>Tempo libero</span></summary>
            <button className={`sidebar-nav-link ${section === 'media' ? 'sidebar-nav-selected' : ''}`} onClick={() => { setSection('media'); setSidebarOpen(false) }}>
              <Music2 size={15} /><span>Audio player</span>
            </button>
            <button className={`sidebar-nav-link ${section === 'watch' ? 'sidebar-nav-selected' : ''}`} onClick={() => { setSection('watch'); setSidebarOpen(false) }}>
              <Eye size={15} /><span>Watch-decider</span>
            </button>
          </details>
          <details className="sidebar-nav-group">
            <summary><UsersRound size={16} /><span>Account</span></summary>
            <button className={`sidebar-nav-link ${section === 'profile' ? 'sidebar-nav-selected' : ''}`} onClick={() => { setSection('profile'); setSidebarOpen(false) }}>
              <Settings2 size={15} /><span>Profilo</span>
            </button>
          </details>
        </nav>
        {section === 'calendar' && <>
          <button className="create-button" onClick={() => openNewItem(date)}>
            <Plus size={19} strokeWidth={2.2} />
            <span>Crea</span>
          </button>

          <MiniCalendar
            date={date}
            onDateChange={setDate}
            onMonthChange={(direction) => setDate((current) => direction === 1 ? addMonths(current, 1) : subMonths(current, 1))}
          />

        <details className="sidebar-section" open>
          <summary className="section-heading">I miei calendari</summary>
          {calendars.map((entry) => (
            <button key={entry.id} className={`filter-row ${entry.id === calendar.id ? 'filter-selected' : ''}`} onClick={() => {
              if (entry.id === calendar.id) return
              setSelectedCalendarId(entry.id)
              setMemberFilter(null)
              setEditorItem(undefined)
            }}>
              <span className="color-dot dot-family" />
              <span>{entry.name}</span>
            </button>
          ))}
          <button className="filter-row" onClick={() => { setError(''); setSetupOpen(true) }}><Plus size={15} /><span>Crea o aggiungi calendario</span></button>
        </details>
        <details className="sidebar-section">
          <summary className="section-heading">Filtri calendario</summary>
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
        </details>
        {activeViewPreferences && <details className="sidebar-section calendar-view-settings">
          <summary className="section-heading">La mia visualizzazione</summary>
          <label className="calendar-search"><Tag size={14} /><input value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder="Cerca tag, titolo o descrizione" /></label>
          <strong className="settings-subheading">Aspetto per categoria</strong>
          {itemTypes.map((type) => {
            const style = activeViewPreferences.category_styles?.[type] ?? defaultCategoryStyles[type]
            return <div className="category-style-row" key={type}>
              <span>{itemLabels[type]}</span>
              <select aria-label={`Colore categoria ${itemLabels[type]}`} value={style.color} onChange={(event) => {
                if (isMemberColor(event.target.value)) updateCategoryStyle(type, { color: event.target.value })
              }}>
                {memberColorOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
              <select aria-label={`Texture categoria ${itemLabels[type]}`} value={style.texture} onChange={(event) => {
                if (isEventTexture(event.target.value)) updateCategoryStyle(type, { texture: event.target.value })
              }}>
                {eventTextures.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </div>
          })}
          <strong className="settings-subheading">Eventi nascosti</strong>
          {allCalendarItems.filter((item) => activeViewPreferences.hidden_item_ids.includes(item.id)).length
            ? allCalendarItems.filter((item) => activeViewPreferences.hidden_item_ids.includes(item.id)).map((item) => <button key={item.id} className="hidden-event-row" onClick={() => toggleHiddenItem(item.id)}><Eye size={14} /><span>{item.title}</span></button>)
            : <span className="settings-empty">Nessun evento nascosto.</span>}
        </details>}
        <details className="sidebar-section people-section">
          <summary className="section-heading">Persone ({members.length})</summary>
          <div className="people-section-head">
            <button
              className="icon-button profile-edit-button"
              onClick={() => setSection('profile')}
              disabled={!currentMember}
              title="Apri il tuo profilo"
              aria-label="Apri il tuo profilo"
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
            <div className="person-filter-controls">
              <button
                className={`filter-row person-filter-row ${memberFilter === member.user_id ? 'filter-selected' : ''}`}
                onClick={() => setMemberFilter(member.user_id)}
                title={`Mostra gli elementi assegnati a ${memberDisplayName(member)}`}
              >
                <MemberAvatar member={member} mii={profiles[member.user_id]?.avatar} small />
                <span className="member-row-name">{memberDisplayName(member)}</span>
                {member.user_id === user.id && <span className="member-you">Tu</span>}
              </button>
              {section === 'calendar' && activeViewPreferences && <button
                type="button"
                className={`member-visibility-toggle ${activeViewPreferences.hidden_member_ids.includes(member.user_id) ? 'member-hidden' : ''}`}
                aria-label={`${activeViewPreferences.hidden_member_ids.includes(member.user_id) ? 'Mostra' : 'Nascondi'} gli eventi creati da ${memberDisplayName(member)}`}
                title={`${activeViewPreferences.hidden_member_ids.includes(member.user_id) ? 'Mostra' : 'Nascondi'} gli eventi creati da ${memberDisplayName(member)}`}
                onClick={() => toggleHiddenMember(member.user_id)}
              >{activeViewPreferences.hidden_member_ids.includes(member.user_id) ? <EyeOff size={15} /> : <Eye size={15} />}</button>}
            </div>
            <small>{member.role === 'owner' ? 'Amministratore' : member.can_edit ? 'Editor calendario' : 'Lettore · eventi personali'}</small>
            {currentMember?.role === 'owner' && member.role !== 'owner' && <div>
              <button className="text-button" onClick={() => void manageMember(member, false)}>{member.can_edit ? 'Rendi lettore' : 'Abilita modifica'}</button>
              <button className="text-button" onClick={() => void manageMember(member, true)}>Rimuovi</button>
            </div>}
            </div>
          ))}
        </details>

        {inviteCode && editInviteCode && <details className="sidebar-section">
          <summary className="section-heading">Invita persone</summary>
          {([['Sola lettura', inviteCode], ['Può modificare', editInviteCode]] as const).map(([label, code]) => <div className="invite-card" key={label}>
          <div className="invite-icon"><UsersRound size={17} /></div>
          <div className="invite-copy"><strong>{label}</strong><span>Codice: <b>{code}</b></span></div>
          <button
            className="icon-button copy-button"
            title={`Copia codice ${label}`}
            onClick={() => {
              if (!navigator.clipboard) {
                setError('Copia non disponibile in questo browser o contesto.')
                return
              }
              void navigator.clipboard.writeText(code)
                .then(() => setNotice('Codice invito copiato.'))
                .catch((copyError: unknown) => setError(`Non è stato possibile copiare il codice: ${readableError(copyError)}`))
            }}
          ><Copy size={15} /></button>
          </div>)}
          <button className="text-button" onClick={() => void rotateInvites()}>Revoca e rigenera i codici</button>
        </details>}
        </>}

        <div className="sidebar-bottom">
          <div className="account-row">
            <button className="avatar account-avatar" onClick={() => setSection('profile')} aria-label="Apri il tuo profilo" title="Apri il tuo profilo">
              {myMii ? <MiiPortrait config={myMii} label="Il tuo Mii" /> : (user.email?.[0] ?? 'F').toLocaleUpperCase('it-IT')}
            </button>
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
            {section !== 'calendar' && <h1 className="date-heading">{section === 'profile' ? 'Profilo' : section === 'schedules' ? 'Orari universitari' : section === 'google-calendar' ? 'Google Calendar' : calendar.name}</h1>}
          </div>
          <div className="topbar-actions">
            {dataLoading && <LoaderCircle className="loading-icon" size={18} />}
            {section === 'calendar' && <><div className="view-switch" role="group" aria-label="Vista calendario">
              <button className={view === 'week' ? 'view-active' : ''} onClick={() => setView('week')}>Settimana</button>
              <button className={view === 'month' ? 'view-active' : ''} onClick={() => setView('month')}>Mese</button>
            </div>
            <button className="icon-button help-button" title="Aiuto" onClick={() => setNotice('Nella vista settimana fai doppio clic su uno spazio vuoto per creare una bozza; trascina l’evento per spostarlo e i bordi per regolarne la durata.')}><CircleHelp size={19} /></button></>}
            <button className="avatar top-avatar account-avatar" onClick={() => setSection('profile')} aria-label="Apri il tuo profilo" title="Apri il tuo profilo">
              {myMii ? <MiiPortrait config={myMii} label="Il tuo Mii" /> : (user.email?.[0] ?? 'F').toLocaleUpperCase('it-IT')}
            </button>
          </div>
        </header>

        {['offline', 'error'].includes(databaseStatus.mode) && (
          <div className={`connection-banner ${databaseStatus.mode === 'error' ? 'connection-banner-error' : ''}`} role="status">
            <strong>{databaseStatus.mode === 'offline' ? 'Connessione Supabase' : 'Stato database'}</strong>
            <span>{databaseStatus.message}</span>
          </div>
        )}

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
              items={draftItem ? [...selectedItems, draftItem] : selectedItems}
              members={members}
              categoryStyles={activeViewPreferences?.category_styles ?? defaultCategoryStyles}
              canEditItem={canEditItem}
              onCreate={openNewItem}
              onCreateTimedDraft={createTimedDraft}
              onEdit={(item) => setEditorItem(item)}
              onToggleTask={toggleTask}
              onUpdateTime={updateTimedItem}
            />
          ) : (
            <MonthCalendar
              days={monthDays}
              date={date}
              items={selectedItems}
              members={members}
              categoryStyles={activeViewPreferences?.category_styles ?? defaultCategoryStyles}
              canEditItem={canEditItem}
              onCreate={openNewItem}
              onEdit={(item) => setEditorItem(item)}
              onToggleTask={toggleTask}
            />
          )}
        </section>}
        {section === 'media' && <SharedMedia
          key={calendar.id}
          calendarId={calendar.id}
          canEdit={canEdit}
          userId={user.id}
          memberName={currentMember?.display_name || user?.email?.split('@')[0] || 'Membro'}
        />}
        {section === 'schedules' && <UniversitySchedules
          key={calendar.id}
          calendarId={calendar.id}
          userId={user.id}
          canEdit={canEdit}
          onSynced={refreshCalendarAfterScheduleSync}
        />}
        {section === 'google-calendar' && <GoogleCalendarSettings
          key={calendar.id}
          calendarId={calendar.id}
          onSynced={() => { void refreshGoogleCalendarEvents() }}
        />}
        {section === 'watch' && <WatchDecider key={calendar.id} calendarId={calendar.id} userId={user.id} canEdit={canEdit} members={members} />}
        {section === 'profile' && <ProfileSection
          key={calendar.id}
          calendar={calendar}
          calendars={calendars}
          currentMember={currentMember}
          memberships={allMembers}
          profiles={profiles}
          userId={user.id}
          canEditCalendar={canEdit}
          saving={dataLoading}
          interfaceTheme={interfaceTheme}
          onSave={saveProfile}
          onSaveInterfaceTheme={saveInterfaceTheme}
          onSaveMemberAppearance={updateMemberAppearance}
        />}
      </main>

      {editorItem !== undefined && (
        <ItemEditor
          item={editorItem}
          initialDate={createDay ?? date}
          members={members}
          currentUserId={user.id}
          canEdit={editorItem ? canEditItem(editorItem) : true}
          canManageSharing={!editorItem || editorItem.created_by === user.id}
          isHidden={Boolean(editorItem && activeViewPreferences?.hidden_item_ids.includes(editorItem.id))}
          onToggleHidden={() => {
            if (editorItem) toggleHiddenItem(editorItem.id)
            setEditorItem(undefined)
          }}
          onClose={() => {
            if (editorItem?.id.startsWith('draft:')) setDraftItem(null)
            setEditorItem(undefined)
          }}
          onSave={saveItem}
          onDelete={editorItem
            ? () => {
              if (editorItem.id.startsWith('draft:')) {
                setDraftItem(null)
                setEditorItem(undefined)
              } else void deleteItem(editorItem.id)
            }
            : undefined}
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
  categoryStyles,
  canEditItem,
  onCreate,
  onCreateTimedDraft,
  onEdit,
  onToggleTask,
  onUpdateTime,
}: {
  days: Date[]
  items: CalendarItem[]
  members: CalendarMember[]
  categoryStyles: CalendarViewPreferences['category_styles']
  canEditItem: (item: CalendarItem) => boolean
  onCreate: (day: Date) => void
  onCreateTimedDraft: (day: Date, minuteOfDay: number) => void
  onEdit: (item: CalendarItem) => void
  onToggleTask: (item: CalendarItem) => void
  onUpdateTime: (item: CalendarItem, startsAt: Date, endsAt: Date) => Promise<void>
}) {
  const timedItems = items.filter((item) => !item.all_day && item.item_type !== 'task')
  const allDayItems = items.filter((item) => item.all_day || item.item_type === 'task')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [hourHeight, setHourHeight] = useState(DEFAULT_WEEK_HOUR_HEIGHT)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const updateHourHeight = () => {
      const available = element.clientHeight - 16
      if (available <= 0) return
      const next = Math.max(MIN_WEEK_HOUR_HEIGHT, Math.min(MAX_WEEK_HOUR_HEIGHT, Math.floor(available / 24)))
      setHourHeight((current) => (current === next ? current : next))
    }
    updateHourHeight()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateHourHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="week-calendar" style={{ '--week-hour-height': `${hourHeight}px` } as CSSProperties}>
      <div className="week-header">
        <div className="time-gutter-header">GMT{format(new Date(), 'xxx')}</div>
        {days.map((day) => <div key={day.toISOString()} className={`day-heading ${isToday(day) ? 'day-heading-today' : ''}`}><span>{format(day, 'EEE', { locale: it }).toLocaleUpperCase('it-IT')}</span><strong>{format(day, 'd')}</strong></div>)}
      </div>
      <div className="all-day-row">
        <div className="all-day-label">Tutto<br />il giorno</div>
        {days.map((day) => <div className="all-day-cell" key={day.toISOString()} onDoubleClick={() => onCreate(day)}>
          {allDayItems.filter((item) => isSameDay(parseISO(item.starts_at), day)).map((item) => <CalendarItemChip key={item.id} item={item} members={members} categoryStyles={categoryStyles} canEditItem={canEditItem} onEdit={onEdit} onToggleTask={onToggleTask} compact />)}
        </div>)}
      </div>
      <div className="week-scroll" ref={scrollRef}>
        <div className="time-column">
          {HOURS.map((hour) => <div className="time-label" key={hour}>{format(new Date(2020, 0, 1, hour), 'HH:mm')}</div>)}
          <div className="time-label time-label-end">24:00</div>
        </div>
        <div className="week-grid">
          {days.map((day) => {
            const dayStart = new Date(day)
            dayStart.setHours(0, 0, 0, 0)
            const dayEnd = new Date(dayStart)
            dayEnd.setDate(dayEnd.getDate() + 1)
            const isTodayColumn = isToday(day)
            const currentHour = now.getHours()
            const nowTop = (currentHour * 60 + now.getMinutes()) / 60 * hourHeight
            const dayItems = timedItems.filter((item) => {
              const startsAt = parseISO(item.starts_at)
              const endsAt = parseISO(item.ends_at)
              return startsAt < dayEnd && endsAt > dayStart
            })

            return <div
              className={`day-column ${isTodayColumn ? 'day-column-today' : ''}`}
              key={day.toISOString()}
              onDoubleClick={(event) => {
                if (event.target instanceof Element && event.target.closest('.week-event')) return
                const rect = event.currentTarget.getBoundingClientRect()
                const offset = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
                const minuteOfDay = Math.min(23 * 60 + 45, Math.floor(offset / hourHeight * 4) * 15)
                onCreateTimedDraft(day, minuteOfDay)
              }}
            >
              {HOURS.map((hour) => <div className={`hour-cell ${isTodayColumn && hour === currentHour ? 'hour-cell-current' : ''}`} key={hour} />)}
              {isTodayColumn && (
                <div className="current-time-line" style={{ top: `${nowTop}px` }} aria-hidden="true">
                  <span className="current-time-dot" />
                </div>
              )}
              {dayItems.map((item) => {
                const startsAt = parseISO(item.starts_at)
                const endsAt = parseISO(item.ends_at)
                const startsToday = isSameDay(startsAt, day)
                const segmentStartMinute = startsToday ? startsAt.getHours() * 60 + startsAt.getMinutes() : 0
                const segmentEndMinute = endsAt >= dayEnd ? 1440 : endsAt.getHours() * 60 + endsAt.getMinutes()
                const startTime = startsToday ? startsAt : dayStart
                const endTime = endsAt >= dayEnd ? dayEnd : endsAt
                const height = Math.max(15, segmentEndMinute - segmentStartMinute) / 60 * hourHeight
                const person = members.find((member) => member.user_id === (item.assignee_id ?? item.created_by))
                  ?? members.find((member) => member.user_id === item.created_by)
                return <TimedCalendarEvent
                  key={item.id}
                  item={item}
                  day={day}
                  hourHeight={hourHeight}
                  top={segmentStartMinute / 60 * hourHeight}
                  height={height}
                  startLabel={format(startTime, 'HH:mm')}
                  endLabel={endsAt >= dayEnd ? '24:00' : format(endTime, 'HH:mm')}
                  categoryStyle={categoryStyles?.[item.item_type] ?? defaultCategoryStyles[item.item_type]}
                  borderColor={person ? MEMBER_COLORS[person.color] : undefined}
                  personBorder={person?.style_border ?? 'solid'}
                  canMove={startsToday && canEditItem(item)}
                  onEdit={onEdit}
                  onUpdateTime={onUpdateTime}
                />
              })}
            </div>
          })}
        </div>
      </div>
    </div>
  )
}

function dateAtDayMinute(day: Date, minuteOfDay: number) {
  const result = new Date(day)
  result.setHours(0, 0, 0, 0)
  result.setMinutes(minuteOfDay)
  return result
}

function wallMinutesFromDay(day: Date, value: Date) {
  const dateDelta = Math.round((new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
    - new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) / 86_400_000)
  return dateDelta * 1440 + value.getHours() * 60 + value.getMinutes()
}

function TimedCalendarEvent({
  item,
  day,
  hourHeight,
  top,
  height,
  categoryStyle,
  startLabel,
  endLabel,
  borderColor,
  personBorder,
  canMove,
  onEdit,
  onUpdateTime,
}: {
  item: CalendarItem
  day: Date
  hourHeight: number
  top: number
  height: number
  categoryStyle: CategoryAppearance
  startLabel: string
  endLabel: string
  borderColor?: string
  personBorder: CalendarMember['style_border']
  canMove: boolean
  onEdit: (item: CalendarItem) => void
  onUpdateTime: (item: CalendarItem, startsAt: Date, endsAt: Date) => Promise<void>
}) {
  const [preview, setPreview] = useState<{ startsAt: Date; endsAt: Date } | null>(null)
  const gesture = useRef<{
    pointerId: number
    mode: 'move' | 'start' | 'end'
    clientY: number
    startMinute: number
    endMinute: number
    moved: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const startsAt = preview?.startsAt ?? parseISO(item.starts_at)
  const endsAt = preview?.endsAt ?? parseISO(item.ends_at)

  const beginGesture = (event: PointerEvent<HTMLElement>, mode: 'move' | 'start' | 'end') => {
    if (!canMove || event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      pointerId: event.pointerId,
      mode,
      clientY: event.clientY,
      startMinute: wallMinutesFromDay(day, startsAt),
      endMinute: wallMinutesFromDay(day, endsAt),
      moved: false,
    }
  }

  const moveGesture = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const delta = Math.round((event.clientY - active.clientY) / hourHeight * 4) * 15
    if (delta === 0) return
    active.moved = true
    let startMinute = active.startMinute
    let endMinute = active.endMinute
    if (active.mode === 'move') {
      const duration = active.endMinute - active.startMinute
      startMinute = Math.max(0, Math.min(1425, active.startMinute + delta))
      endMinute = startMinute + duration
    } else if (active.mode === 'start') {
      startMinute = Math.max(0, Math.min(1425, active.endMinute - 15, active.startMinute + delta))
    } else {
      endMinute = Math.max(active.startMinute + 15, Math.min(1440, active.endMinute + delta))
    }
    setPreview({ startsAt: dateAtDayMinute(day, startMinute), endsAt: dateAtDayMinute(day, endMinute) })
  }

  const endGesture = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    gesture.current = null
    if (!active.moved || !preview) {
      setPreview(null)
      return
    }
    suppressClick.current = true
    const next = preview
    setPreview(null)
    void onUpdateTime(item, next.startsAt, next.endsAt).finally(() => setPreview(null))
  }

  const selectEvent = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    onEdit(item)
  }
  const adjustEdge = (edge: 'start' | 'end', event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const startMinute = wallMinutesFromDay(day, startsAt)
    const endMinute = wallMinutesFromDay(day, endsAt)
    if (edge === 'start' && startMinute >= 15) {
      void onUpdateTime(item, dateAtDayMinute(day, startMinute - 15), endsAt)
    } else if (edge === 'end' && endMinute < 1440) {
      void onUpdateTime(item, startsAt, dateAtDayMinute(day, endMinute + 15))
    }
  }
  const timeLabel = preview
    ? `${format(startsAt, 'HH:mm')} – ${wallMinutesFromDay(day, endsAt) >= 1440 ? '24:00' : format(endsAt, 'HH:mm')}`
    : `${startLabel} – ${endLabel}`
  const palette = itemPalettes[categoryStyle.color]

  return <div
    className={`week-event event-${item.item_type} event-texture-${categoryStyle.texture} event-person-border-${personBorder} ${item.id.startsWith('draft:') ? 'week-event-draft' : ''} ${preview ? 'week-event-dragging' : ''}`}
    style={{
      top: `${preview ? wallMinutesFromDay(day, preview.startsAt) / 60 * hourHeight : top}px`,
      height: `${preview ? (wallMinutesFromDay(day, preview.endsAt) - wallMinutesFromDay(day, preview.startsAt)) / 60 * hourHeight : height}px`,
      borderLeftColor: borderColor ?? palette.foreground,
      backgroundColor: palette.background,
      color: palette.foreground,
      borderLeftStyle: personBorder,
    }}
    title={`${item.title}${item.tags?.length ? ` · ${item.tags.map((tag) => `#${tag}`).join(' ')}` : ''}, ${startLabel}–${endLabel}.`}
    role="group"
    aria-label={`${item.title}, ${startLabel}–${endLabel}`}
    onPointerDown={(event) => beginGesture(event, 'move')}
    onPointerMove={moveGesture}
    onPointerUp={endGesture}
    onPointerCancel={() => { gesture.current = null; setPreview(null) }}
    onClick={selectEvent}
  >
    <button type="button" className="event-resize-handle event-resize-start" aria-label="Bordo superiore: anticipa di 15 minuti; trascina per ridimensionare" onPointerDown={(event) => beginGesture(event, 'start')} onClick={(event) => adjustEdge('start', event)} />
    <button type="button" className="week-event-title" onClick={(event) => { event.stopPropagation(); selectEvent() }}>{item.title}</button>
    <span className="week-event-time">{timeLabel}{item.id.startsWith('draft:') ? ' · bozza' : ''}</span>
    {item.tags?.length > 0 && <span className="week-event-tags">{item.tags.slice(0, 2).map((tag) => `#${tag}`).join(' ')}</span>}
    <button type="button" className="event-resize-handle event-resize-end" aria-label="Bordo inferiore: allunga di 15 minuti; trascina per ridimensionare" onPointerDown={(event) => beginGesture(event, 'end')} onClick={(event) => adjustEdge('end', event)} />
  </div>
}

function MonthCalendar({
  days,
  date,
  items,
  members,
  categoryStyles,
  canEditItem,
  onCreate,
  onEdit,
  onToggleTask,
}: {
  days: Date[]
  date: Date
  items: CalendarItem[]
  members: CalendarMember[]
  categoryStyles: CalendarViewPreferences['category_styles']
  canEditItem: (item: CalendarItem) => boolean
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
              {items.filter((item) => isSameDay(parseISO(item.starts_at), day)).slice(0, 4).map((item) => <CalendarItemChip key={item.id} item={item} members={members} categoryStyles={categoryStyles} canEditItem={canEditItem} onEdit={onEdit} onToggleTask={onToggleTask} compact />)}
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
  categoryStyles,
  canEditItem,
  onEdit,
  onToggleTask,
  compact = false,
}: {
  item: CalendarItem
  members: CalendarMember[]
  categoryStyles: CalendarViewPreferences['category_styles']
  canEditItem: (item: CalendarItem) => boolean
  onEdit: (item: CalendarItem) => void
  onToggleTask: (item: CalendarItem) => void
  compact?: boolean
}) {
  const person = members.find((member) => member.user_id === (item.assignee_id ?? item.created_by))
    ?? members.find((member) => member.user_id === item.created_by)
  const categoryStyle = categoryStyles?.[item.item_type] ?? defaultCategoryStyles[item.item_type]
  const palette = itemPalettes[categoryStyle.color]
  return (
    <div
      className={`item-chip event-${item.item_type} event-texture-${categoryStyle.texture} event-person-border-${person?.style_border ?? 'solid'} ${item.completed ? 'item-completed' : ''} ${compact ? 'item-chip-compact' : ''}`}
      style={{ backgroundColor: palette.background, color: palette.foreground, borderLeftColor: person ? MEMBER_COLORS[person.color] : palette.foreground }}
      title={`${item.title}${person ? ` · ${memberDisplayName(person)}` : ''}${item.tags?.length ? ` · ${item.tags.map((tag) => `#${tag}`).join(' ')}` : ''}`}
    >
      {item.item_type === 'task' ? (
        <button className="task-check" disabled={!canEditItem(item)} onClick={(event) => { event.stopPropagation(); void onToggleTask(item) }} aria-label={item.completed ? 'Segna come da fare' : 'Segna come completata'}>
          {item.completed && <Check size={11} />}
        </button>
      ) : <span className="item-time-dot" />}
      {person && <span className="assigned-color-dot" style={{ backgroundColor: MEMBER_COLORS[person.color] }} />}
      <button className="item-title" onClick={() => onEdit(item)} title={item.title}>{item.title}</button>
      {item.tags?.[0] && <span className="item-tag-label">#{item.tags[0]}</span>}
    </div>
  )
}

function MemberAvatar({ member, mii, small = false }: { member: CalendarMember; mii?: MiiConfig | null; small?: boolean }) {
  const name = memberDisplayName(member)
  return (
    <span
      className={`person-avatar ${small ? 'person-avatar-small' : ''}`}
      style={mii ? undefined : { backgroundColor: MEMBER_COLORS[member.color] ?? MEMBER_COLORS.violet }}
      aria-label={name}
    >
      {mii ? <MiiPortrait config={mii} label={name} /> : memberInitials(name)}
    </span>
  )
}

function ItemEditor({
  item,
  initialDate,
  members,
  currentUserId,
  canEdit,
  canManageSharing,
  isHidden,
  onClose,
  onToggleHidden,
  onSave,
  onDelete,
}: {
  item: CalendarItem | null
  initialDate: Date
  members: CalendarMember[]
  currentUserId: string
  canEdit: boolean
  canManageSharing: boolean
  isHidden: boolean
  onClose: () => void
  onToggleHidden: () => void
  onSave: (form: {
    title: string
    description: string
    item_type: CalendarItemType
    starts_at: string
    ends_at: string
    all_day: boolean
    assignee_id: string | null
    visibility: CalendarItem['visibility']
    visible_to: string[]
    editable_by: string[]
    tags: string[]
  }) => Promise<boolean>
  onDelete?: () => void
}) {
  const defaults = getDefaultTimes(initialDate)
  const isDraft = item?.id.startsWith('draft:') ?? false
  const [title, setTitle] = useState(isDraft ? '' : item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [itemType, setItemType] = useState<CalendarItemType>(item?.item_type ?? 'event')
  const [startsAt, setStartsAt] = useState(item ? localDateTime(parseISO(item.starts_at)) : defaults.starts_at)
  const [endsAt, setEndsAt] = useState(item ? localDateTime(parseISO(item.ends_at)) : defaults.ends_at)
  const [allDay, setAllDay] = useState(item?.all_day ?? false)
  const [assigneeId, setAssigneeId] = useState(item ? item.assignee_id ?? '' : currentUserId)
  const [visibility, setVisibility] = useState<CalendarItem['visibility']>(item?.visibility ?? 'everyone')
  const [visibleTo, setVisibleTo] = useState<string[]>(item?.visible_to ?? [])
  const [editableBy, setEditableBy] = useState<string[]>(item?.editable_by ?? [])
  const [tagText, setTagText] = useState((item?.tags ?? []).join(', '))
  const [validationError, setValidationError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    if (new Date(endsAt) < new Date(startsAt)) {
      setValidationError('L’orario di fine deve essere successivo all’orario di inizio.')
      return
    }
    const tags = [...new Set(tagText.split(',').map((tag) => tag.trim()).filter(Boolean))]
    if (tags.length > 12 || tags.some((tag) => tag.length > 32)) {
      setValidationError('Inserisci al massimo 12 tag, ciascuno da 32 caratteri.')
      return
    }
    setValidationError('')
    setSaving(true)
    const recipients = visibility === 'selected' ? [...new Set([...visibleTo, currentUserId])] : []
    const saved = await onSave({
      title,
      description,
      item_type: itemType,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: allDay || itemType === 'task',
      assignee_id: assigneeId || null,
      visibility,
      visible_to: recipients,
      editable_by: canManageSharing ? editableBy : item?.editable_by ?? [],
      tags,
    })
    setSaving(false)
    if (saved) onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="item-modal" role="dialog" aria-modal="true" aria-labelledby="item-modal-title">
        <div className="modal-top"><span className="eyebrow">{item?.source_provider === 'google' ? 'GOOGLE CALENDAR · SOLA LETTURA' : item && !isDraft ? 'MODIFICA ELEMENTO' : 'NUOVO EVENTO'}</span><button className="icon-button" onClick={onClose} aria-label="Chiudi"><X size={19} /></button></div>
        <h2 id="item-modal-title">{item?.source_provider === 'google' ? 'Evento importato da Google' : item && !isDraft ? 'Aggiorna il calendario' : 'Completa il nuovo evento'}</h2>
        {item?.source_provider === 'google' && <p>Per modificare questo evento, aprilo in Google Calendar. Le modifiche verranno sincronizzate automaticamente.</p>}
        {item?.source_provider === 'google' && item.source_url && <p><a href={item.source_url} target="_blank" rel="noreferrer">Apri evento su Google Calendar</a></p>}
        {!canEdit && <p>Accesso in sola lettura</p>}
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
          <input className="title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Aggiungi un titolo" maxLength={120} required autoFocus />
          <div className="type-selector" role="group" aria-label="Tipo di elemento">
            {(['event', 'task', 'lesson'] as const).map((type) => <button type="button" className={`type-option ${itemType === type ? `type-active type-${type}` : ''}`} key={type} onClick={() => { setItemType(type); if (type === 'task') setAllDay(true) }}><span className={`type-icon type-icon-${type}`}>{type === 'event' ? <CalendarDays size={15} /> : type === 'task' ? <CheckSquare size={15} /> : <BookOpen size={15} />}</span>{itemLabels[type]}</button>)}
          </div>
          <label className="modal-field"><span><Clock3 size={16} /> Inizio</span><DateTime24Input value={startsAt} showTime={!allDay && itemType !== 'task'} onChange={(next) => { setStartsAt(next); setValidationError('') }} required /></label>
          {itemType !== 'task' && <label className="modal-field"><span><Clock3 size={16} /> Fine</span><DateTime24Input value={endsAt} showTime={!allDay} onChange={(next) => { setEndsAt(next); setValidationError('') }} required /></label>}
          {itemType !== 'task' && <label className="checkbox-field"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} /><span>Tutto il giorno</span></label>}
          <label className="description-field"><span>Assegnato a</span><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Nessuno</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{memberDisplayName(member)}</option>)}</select></label>
          <label className="description-field"><span>Tag <small>Separati da virgola, max 12</small></span><input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="es. famiglia, viaggio, urgente" maxLength={420} /></label>
          <label className="description-field"><span>Descrizione <small>Facoltativa</small></span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Aggiungi dettagli..." maxLength={1000} /></label>
          </fieldset>
          <fieldset className="sharing-fieldset" disabled={!canManageSharing || !canEdit}>
            <legend>Condivisione e autorizzazioni</legend>
            {!canManageSharing && <p>Solo il creatore può cambiare la condivisione e scegliere chi può modificare.</p>}
            <label className="description-field"><span>Chi può vedere?</span><select value={visibility} onChange={(event) => {
              const value = event.target.value
              if (value === 'private' || value === 'everyone' || value === 'selected') setVisibility(value)
            }}><option value="private">Personale: solo tu</option><option value="everyone">Condiviso con tutti i membri</option><option value="selected">Condiviso con persone selezionate</option></select></label>
            {visibility === 'selected' && <div>
              <p>Tu vedi sempre l’evento. Scegli gli altri destinatari:</p>
              {members.filter((member) => member.user_id !== currentUserId && member.user_id !== item?.created_by).map((member) => <label className="checkbox-field" key={member.user_id}><input type="checkbox" checked={visibleTo.includes(member.user_id)} onChange={(event) => setVisibleTo((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} /><span>{memberDisplayName(member)}</span></label>)}
            </div>}
            <div className="description-field"><span>Chi può modificare?</span><p>Tu puoi sempre modificare il tuo evento. Gli altri membri restano in sola lettura salvo autorizzazione esplicita:</p>
              {members.filter((member) => member.user_id !== currentUserId && member.user_id !== item?.created_by).map((member) => <label className="checkbox-field" key={member.user_id}><input type="checkbox" checked={editableBy.includes(member.user_id)} onChange={(event) => setEditableBy((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} /><span>{memberDisplayName(member)}</span></label>)}
            </div>
          </fieldset>
          {item && !isDraft && <button type="button" className="personal-event-toggle" onClick={onToggleHidden}>{isHidden ? <Eye size={15} /> : <EyeOff size={15} />}{isHidden ? 'Mostra nel mio calendario' : 'Nascondi solo nel mio calendario'}</button>}
          {validationError && <p className="form-message form-error">{validationError}</p>}
          <div className="modal-footer">{onDelete && canEdit ? <button type="button" className="delete-button" onClick={onDelete}><Trash2 size={16} /> Elimina</button> : <span />}
            <div><button type="button" className="cancel-button" onClick={onClose}>{canEdit ? 'Annulla' : 'Chiudi'}</button>{canEdit && <button className="primary-button save-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="loading-icon" size={17} /> : item && !isDraft ? 'Salva modifiche' : 'Crea evento'}</button>}</div>
          </div>
        </form>
      </section>
    </div>
  )
}

function DateTime24Input({
  value,
  onChange,
  required = false,
  showTime = true,
}: {
  value: string
  onChange: (next: string) => void
  required?: boolean
  showTime?: boolean
}) {
  const datePart = value.slice(0, 10)
  const timePart = value.slice(11, 16) || '09:00'
  const hourPart = timePart.slice(0, 2)
  const minutePart = timePart.slice(3, 5)

  return (
    <div className="datetime-24-group">
      <input
        type="date"
        value={datePart}
        onChange={(event) => onChange(`${event.target.value}T${hourPart}:${minutePart}`)}
        required={required}
      />
      {showTime && (
        <div className="time-24-selects" aria-label="Orario (formato 24 ore)">
          <select
            aria-label="Ora"
            value={hourPart}
            onChange={(event) => onChange(`${datePart}T${event.target.value}:${minutePart}`)}
          >
            {HOURS.map((hour) => {
              const label = String(hour).padStart(2, '0')
              return <option key={label} value={label}>{label}</option>
            })}
          </select>
          <span>:</span>
          <select
            aria-label="Minuti"
            value={minutePart}
            onChange={(event) => onChange(`${datePart}T${hourPart}:${event.target.value}`)}
          >
            {MINUTES.map((minute) => <option key={minute} value={minute}>{minute}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

export default App
