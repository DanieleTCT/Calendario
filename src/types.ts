export type CalendarItemType = 'event' | 'task' | 'lesson'
export type CalendarView = 'week' | 'month'
export type MemberColor = 'violet' | 'blue' | 'coral' | 'green' | 'amber' | 'pink'

export const MEMBER_COLORS: Record<MemberColor, string> = {
  violet: '#7068d8',
  blue: '#4d86c6',
  coral: '#d87568',
  green: '#3d9b80',
  amber: '#d9953c',
  pink: '#bd68a3',
}

export interface CalendarMember {
  calendar_id: string
  user_id: string
  display_name: string
  color: MemberColor
  role: 'owner' | 'member'
  can_edit: boolean
}

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
  assignee_id: string | null
  created_by: string
  visibility: 'everyone' | 'selected'
  visible_to: string[]
}

export interface FamilyCalendar {
  id: string
  name: string
}

export type MiiPartKey = 'hair' | 'ears' | 'eyes' | 'eyebrows' | 'nose' | 'mouth' | 'beard' | 'glasses' | 'blush' | 'mole'

export interface MiiPlacement {
  x: number
  y: number
  scale: number
  rotate: number
}

export interface MiiConfig {
  background: number
  faceShape: number
  skin: number
  hairStyle: number
  hairColor: number
  earStyle: number
  eyeStyle: number
  eyeColor: number
  eyeSpacing: number
  eyebrowStyle: number
  noseStyle: number
  mouthStyle: number
  lipColor: number
  beard: number
  glasses: number
  blush: boolean
  mole: boolean
  shirt: number
  placements: Record<MiiPartKey, MiiPlacement>
}

export interface UserProfile {
  user_id: string
  bio: string
  avatar: MiiConfig | null
}
