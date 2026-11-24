import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Pencil, UsersRound } from 'lucide-react'
import { MII_DEFAULT, MiiPortrait } from './mii'
import { MiiEditor } from './MiiEditor'
import { MEMBER_COLORS, type CalendarMember, type EventBorder, type FamilyCalendar, type MemberColor, type MiiConfig, type UserProfile } from './types'

const MEMBER_COLOR_LABELS: Record<MemberColor, string> = {
  violet: 'Viola',
  blue: 'Blu',
  coral: 'Corallo',
  green: 'Verde',
  amber: 'Ambra',
  pink: 'Rosa',
}
const EVENT_BORDER_LABELS: Record<EventBorder, string> = {
  solid: 'Continuo',
  dashed: 'Tratteggiato',
  double: 'Doppio',
}

function isMemberColor(value: string): value is MemberColor {
  return Object.prototype.hasOwnProperty.call(MEMBER_COLOR_LABELS, value)
}

function initialsOf(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toLocaleUpperCase('it-IT') || 'M'
}

function roleLabel(member: CalendarMember) {
  return member.role === 'owner' ? 'Amministratore' : member.can_edit ? 'Editor calendario' : 'Lettore · eventi personali'
}

function MemberAppearanceEditor({ member, onSave }: {
  member: CalendarMember
  onSave: (userId: string, color: MemberColor, border: EventBorder) => Promise<void>
}) {
  const [color, setColor] = useState<MemberColor>(member.color)
  const [border, setBorder] = useState<EventBorder>(member.style_border)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setColor(member.color)
    setBorder(member.style_border)
  }, [member.color, member.style_border])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    await onSave(member.user_id, color, border)
    setSaving(false)
  }

  return <details className="member-appearance-settings">
    <summary>Aspetto di {member.display_name || 'Membro'}</summary>
    {!member.allow_style_editors
      ? <p>Questo membro ha riservato a sé la modifica del proprio aspetto.</p>
      : <form onSubmit={(event) => void submit(event)}>
        <label>Colore<select value={color} onChange={(event) => {
          const value = event.target.value
          if (isMemberColor(value)) setColor(value)
        }}>{(Object.keys(MEMBER_COLOR_LABELS) as MemberColor[]).map((value) => <option key={value} value={value}>{MEMBER_COLOR_LABELS[value]}</option>)}</select></label>
        <label>Bordo eventi<select value={border} onChange={(event) => {
          const value = event.target.value
          if (value === 'solid' || value === 'dashed' || value === 'double') setBorder(value)
        }}>{(Object.keys(EVENT_BORDER_LABELS) as EventBorder[]).map((value) => <option value={value} key={value}>{EVENT_BORDER_LABELS[value]}</option>)}</select></label>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva aspetto'}</button>
      </form>}
  </details>
}

export function ProfileSection({
  calendar,
  calendars,
  currentMember,
  memberships,
  profiles,
  userId,
  canEditCalendar,
  saving,
  onSave,
  onSaveMemberAppearance,
}: {
  calendar: FamilyCalendar
  calendars: FamilyCalendar[]
  currentMember: CalendarMember | undefined
  memberships: CalendarMember[]
  profiles: Record<string, UserProfile>
  userId: string
  canEditCalendar: boolean
  saving: boolean
  onSave: (input: { displayName: string; color: MemberColor; styleBorder: EventBorder; allowStyleEditors: boolean; bio: string; avatar: MiiConfig | null }) => Promise<boolean>
  onSaveMemberAppearance: (targetUserId: string, color: MemberColor, styleBorder: EventBorder) => Promise<void>
}) {
  const ownProfile = profiles[userId]
  const [name, setName] = useState(currentMember?.display_name ?? '')
  const [color, setColor] = useState<MemberColor>(currentMember?.color ?? 'violet')
  const [styleBorder, setStyleBorder] = useState<EventBorder>(currentMember?.style_border ?? 'solid')
  const [allowStyleEditors, setAllowStyleEditors] = useState(currentMember?.allow_style_editors ?? true)
  const [bio, setBio] = useState(ownProfile?.bio ?? '')
  const [mii, setMii] = useState<MiiConfig | null>(ownProfile?.avatar ?? null)
  const [editorOpen, setEditorOpen] = useState(false)

  useEffect(() => {
    setName(currentMember?.display_name ?? '')
    setColor(currentMember?.color ?? 'violet')
    setStyleBorder(currentMember?.style_border ?? 'solid')
    setAllowStyleEditors(currentMember?.allow_style_editors ?? true)
  }, [currentMember?.display_name, currentMember?.color, currentMember?.style_border, currentMember?.allow_style_editors])

  const people = useMemo(() => {
    const groups = new Map<string, CalendarMember[]>()
    for (const member of memberships) groups.set(member.user_id, [...(groups.get(member.user_id) ?? []), member])
    return [...groups.entries()]
      .map(([id, rows]) => ({ id, rows }))
      .sort((a, b) => Number(b.id === userId) - Number(a.id === userId))
  }, [memberships, userId])

  const displayName = name.trim() || 'Membro'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    await onSave({ displayName: name, color, styleBorder, allowStyleEditors, bio: bio.trim(), avatar: mii })
  }

  return (
    <section className="profile-section">
      <div className="profile-hero">
        <div className="profile-face">
          {mii ? <MiiPortrait config={mii} label={`Mii di ${displayName}`} /> : <span style={{ backgroundColor: MEMBER_COLORS[color] }}>{initialsOf(displayName)}</span>}
        </div>
        <div className="profile-hero-copy">
          <p className="eyebrow">IL TUO PROFILO</p>
          <h2>{displayName}</h2>
          <p>{bio.trim() || 'Aggiungi una breve descrizione su di te.'}</p>
          <div className="profile-hero-actions">
            <button type="button" className="primary-button" onClick={() => setEditorOpen(true)}><Pencil size={15} /> Modifica Mii</button>
            {mii && <button type="button" className="text-button" onClick={() => setMii(null)}>Usa le iniziali</button>}
          </div>
        </div>
      </div>

      <form className="profile-card auth-form" onSubmit={(event) => void submit(event)}>
        <h3>Informazioni principali</h3>
        <div className="profile-fields">
          <label>Nome nel calendario<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required /></label>
          <label>Colore<select value={color} onChange={(event) => {
            const value = event.target.value
            if (isMemberColor(value)) setColor(value)
          }}>{(Object.keys(MEMBER_COLOR_LABELS) as MemberColor[]).map((value) => <option key={value} value={value}>{MEMBER_COLOR_LABELS[value]}</option>)}</select></label>
          <label>Bordo dei miei eventi<select value={styleBorder} onChange={(event) => {
            const value = event.target.value
            if (value === 'solid' || value === 'dashed' || value === 'double') setStyleBorder(value)
          }}>{(Object.keys(EVENT_BORDER_LABELS) as EventBorder[]).map((value) => <option value={value} key={value}>{EVENT_BORDER_LABELS[value]}</option>)}</select></label>
        </div>
        <label className="checkbox-field profile-style-permission"><input type="checkbox" checked={allowStyleEditors} onChange={(event) => setAllowStyleEditors(event.target.checked)} /><span>Consenti agli editor del calendario di modificare colore e bordo dei miei eventi</span></label>
        <label>Su di me <small>{bio.length}/140</small><textarea rows={3} value={bio} onChange={(event) => setBio(event.target.value)} maxLength={140} placeholder="Es. Amo cucinare e i film di fantascienza" /></label>
        <p className="profile-note">Nome e colore valgono per il calendario <strong>{calendar.name}</strong>. Il Mii e la descrizione sono visibili a tutti i tuoi calendari condivisi.</p>
        <div className="profile-footer">
          <button className="primary-button save-button" type="submit" disabled={saving}>Salva profilo</button>
        </div>
      </form>

      <section className="profile-card">
        <h3><UsersRound size={16} /> Persone nei tuoi calendari <small>({people.length})</small></h3>
        <div className="people-grid">
          {people.map(({ id, rows }) => {
            const row = rows.find((member) => member.calendar_id === calendar.id) ?? rows[0]
            const personName = row.display_name.trim() || 'Membro'
            const personMii = profiles[id]?.avatar ?? null
            const personBio = profiles[id]?.bio ?? ''
            return (
              <article className="person-card" key={id}>
                <div className="person-card-face">
                  {personMii
                    ? <MiiPortrait config={personMii} label={personName} />
                    : <span style={{ backgroundColor: MEMBER_COLORS[row.color] ?? MEMBER_COLORS.violet }}>{initialsOf(personName)}</span>}
                </div>
                <strong>{personName}{id === userId && <span className="member-you">Tu</span>}</strong>
                {personBio && <p>{personBio}</p>}
                <ul>
                  {rows.map((member) => (
                    <li key={member.calendar_id}>
                      <span className="color-dot" style={{ backgroundColor: MEMBER_COLORS[member.color] }} />
                      <span>{calendars.find((entry) => entry.id === member.calendar_id)?.name ?? 'Calendario'} · {roleLabel(member)}</span>
                    </li>
                  ))}
                </ul>
                {canEditCalendar && id !== userId && row.calendar_id === calendar.id && <MemberAppearanceEditor
                  member={row}
                  onSave={onSaveMemberAppearance}
                />}
              </article>
            )
          })}
        </div>
      </section>

      {editorOpen && <MiiEditor
        initial={mii ?? MII_DEFAULT}
        onClose={() => setEditorOpen(false)}
        onSave={(config) => { setMii(config); setEditorOpen(false) }}
      />}
    </section>
  )
}
