export type CalendarItemType = 'event' | 'task' | 'lesson'
export type CalendarView = 'week' | 'month'

export interface CalendarItem {
  id: string
  calendar_id: string
  title: string
  description: string
  item_type: CalendarItemType
  starts_at: string
  ends_at: string
  all_day: boolean
  completed: boolean
  created_by: string
}

export interface FamilyCalendar {
  id: string
  name: string
  invite_code: string
}
