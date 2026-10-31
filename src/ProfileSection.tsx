import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Pencil, UsersRound } from 'lucide-react'
import { MII_DEFAULT, MiiPortrait } from './mii'
import { MiiEditor } from './MiiEditor'
import { MEMBER_COLORS, type CalendarMember, type FamilyCalendar, type MemberColor, type MiiConfig, type UserProfile } from './types'

const MEMBER_COLOR_LABELS: Record<MemberColor, string> = {
  violet: 'Viola',
  blue: 'Blu',
  coral: 'Corallo',
  green: 'Verde',
  amber: 'Ambra',
  pink: 'Rosa',
}

function initialsOf(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toLocaleUpperCase('it-IT') || 'M'
}

function roleLabel(member: CalendarMember) {
  return member.role === 'owner' ? 'Amministratore' : member.can_edit ? 'Può modificare' : 'Sola lettura'
}

export function ProfileSection({
  calendar,
  calendars,
  currentMember,
  memberships,
  profiles,
  userId,
  saving,
  onSave,
}: {
  calendar: FamilyCalendar
  calendars: FamilyCalendar[]
  currentMember: CalendarMember | undefined
  memberships: CalendarMember[]
  profiles: Record<string, UserProfile>
  userId: string
  saving: boolean
  onSave: (input: { displayName: string; color: MemberColor; bio: string; avatar: MiiConfig | null }) => Promise<boolean>
}) {
  const ownProfile = profiles[userId]
  const [name, setName] = useState(currentMember?.display_name ?? '')
  const [color, setColor] = useState<MemberColor>(currentMember?.color ?? 'violet')
  const [bio, setBio] = useState(ownProfile?.bio ?? '')
  const [mii, setMii] = useState<MiiConfig | null>(ownProfile?.avatar ?? null)
  const [editorOpen, setEditorOpen] = useState(false)

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
    await onSave({ displayName: name, color, bio: bio.trim(), avatar: mii })
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
          <label>Colore<select value={color} onChange={(event) => setColor(event.target.value as MemberColor)}>{(Object.keys(MEMBER_COLOR_LABELS) as MemberColor[]).map((value) => <option key={value} value={value}>{MEMBER_COLOR_LABELS[value]}</option>)}</select></label>
        </div>
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
