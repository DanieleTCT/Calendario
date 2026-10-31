import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, Shuffle, X } from 'lucide-react'
import {
  MII_BACKGROUNDS,
  MII_BEARDS,
  MII_EAR_STYLES,
  MII_EYE_STYLES,
  MII_EYEBROW_STYLES,
  MII_EYES,
  MII_FACE_SHAPES,
  MII_GLASSES,
  MII_HAIR,
  MII_HAIR_STYLES,
  MII_LIPS,
  MII_MOUTH_STYLES,
  MII_NEUTRAL_PLACEMENT,
  MII_NOSE_STYLES,
  MII_PART_LABELS,
  MII_SHIRTS,
  MII_SKIN,
  MiiPortrait,
  randomMii,
} from './mii'
import type { MiiConfig, MiiPartKey, MiiPlacement } from './types'

type MiiTab = 'face' | 'hair' | 'ears' | 'eyes' | 'eyebrows' | 'nose' | 'mouth' | 'accessories' | 'style'

const TABS: { id: MiiTab; label: string }[] = [
  { id: 'face', label: 'Viso' },
  { id: 'hair', label: 'Capelli' },
  { id: 'ears', label: 'Orecchie' },
  { id: 'eyes', label: 'Occhi' },
  { id: 'eyebrows', label: 'Sopracciglia' },
  { id: 'nose', label: 'Naso' },
  { id: 'mouth', label: 'Bocca' },
  { id: 'accessories', label: 'Accessori' },
  { id: 'style', label: 'Stile' },
]

function Stepper({ label, value, options, onChange }: { label: string; value: number; options: string[]; onChange: (value: number) => void }) {
  const step = (direction: -1 | 1) => onChange((value + direction + options.length) % options.length)
  return (
    <div className="mii-control">
      <span>{label}</span>
      <div className="mii-stepper">
        <button type="button" onClick={() => step(-1)} aria-label={`${label}: precedente`}><ChevronLeft size={16} /></button>
        <strong>{options[value]}</strong>
        <button type="button" onClick={() => step(1)} aria-label={`${label}: successivo`}><ChevronRight size={16} /></button>
      </div>
    </div>
  )
}

function Swatches({ label, colors, value, onChange }: { label: string; colors: string[]; value: number; onChange: (value: number) => void }) {
  return (
    <div className="mii-control">
      <span>{label}</span>
      <div className="mii-swatches">
        {colors.map((color, index) => (
          <button
            type="button"
            key={color}
            className={index === value ? 'swatch-active' : ''}
            style={{ backgroundColor: color }}
            onClick={() => onChange(index)}
            aria-label={`${label} ${index + 1}`}
            aria-pressed={index === value}
          />
        ))}
      </div>
    </div>
  )
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="mii-control mii-slider">
      <span>{label}</span>
      <input type="range" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="checkbox-field">
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function Placement({ part, value, onChange }: { part: MiiPartKey; value: MiiPlacement; onChange: (value: MiiPlacement) => void }) {
  const set = (field: keyof MiiPlacement, next: number) => onChange({ ...value, [field]: next })
  return (
    <div className="mii-placement">
      <span className="mii-placement-title">Posizione e misura: {MII_PART_LABELS[part].toLocaleLowerCase('it-IT')}</span>
      <Slider label="Orizzontale" value={value.x} onChange={(next) => set('x', next)} />
      <Slider label="Verticale" value={value.y} onChange={(next) => set('y', next)} />
      <Slider label="Dimensione" value={value.scale} onChange={(next) => set('scale', next)} />
      <Slider label="Rotazione" value={value.rotate} onChange={(next) => set('rotate', next)} />
      <button type="button" className="text-button" onClick={() => onChange({ ...MII_NEUTRAL_PLACEMENT })}>Ripristina</button>
    </div>
  )
}

export function MiiEditor({
  initial,
  saving = false,
  onClose,
  onSave,
}: {
  initial: MiiConfig
  saving?: boolean
  onClose: () => void
  onSave: (config: MiiConfig) => void
}) {
  const [config, setConfig] = useState<MiiConfig>(initial)
  const [tab, setTab] = useState<MiiTab>('face')
  const update = <K extends keyof MiiConfig>(key: K, value: MiiConfig[K]) => setConfig((current) => ({ ...current, [key]: value }))
  const setPlacement = (part: MiiPartKey, value: MiiPlacement) => setConfig((current) => ({ ...current, placements: { ...current.placements, [part]: value } }))

  const panels: Record<MiiTab, ReactNode> = {
    face: <>
      <Stepper label="Forma del viso" value={config.faceShape} options={MII_FACE_SHAPES} onChange={(value) => update('faceShape', value)} />
      <Swatches label="Colore della pelle" colors={MII_SKIN} value={config.skin} onChange={(value) => update('skin', value)} />
    </>,
    hair: <>
      <Stepper label="Stile dei capelli" value={config.hairStyle} options={MII_HAIR_STYLES} onChange={(value) => update('hairStyle', value)} />
      <Swatches label="Colore dei capelli" colors={MII_HAIR} value={config.hairColor} onChange={(value) => update('hairColor', value)} />
      <Placement part="hair" value={config.placements.hair} onChange={(value) => setPlacement('hair', value)} />
    </>,
    ears: <>
      <Stepper label="Forma delle orecchie" value={config.earStyle} options={MII_EAR_STYLES} onChange={(value) => update('earStyle', value)} />
      <Placement part="ears" value={config.placements.ears} onChange={(value) => setPlacement('ears', value)} />
    </>,
    eyes: <>
      <Stepper label="Stile degli occhi" value={config.eyeStyle} options={MII_EYE_STYLES} onChange={(value) => update('eyeStyle', value)} />
      <Swatches label="Colore dell'iride" colors={MII_EYES} value={config.eyeColor} onChange={(value) => update('eyeColor', value)} />
      <Slider label="Distanza tra gli occhi" value={config.eyeSpacing} onChange={(value) => update('eyeSpacing', value)} />
      <Placement part="eyes" value={config.placements.eyes} onChange={(value) => setPlacement('eyes', value)} />
    </>,
    eyebrows: <>
      <Stepper label="Forma delle sopracciglia" value={config.eyebrowStyle} options={MII_EYEBROW_STYLES} onChange={(value) => update('eyebrowStyle', value)} />
      <Placement part="eyebrows" value={config.placements.eyebrows} onChange={(value) => setPlacement('eyebrows', value)} />
    </>,
    nose: <>
      <Stepper label="Forma del naso" value={config.noseStyle} options={MII_NOSE_STYLES} onChange={(value) => update('noseStyle', value)} />
      <Placement part="nose" value={config.placements.nose} onChange={(value) => setPlacement('nose', value)} />
    </>,
    mouth: <>
      <Stepper label="Forma della bocca" value={config.mouthStyle} options={MII_MOUTH_STYLES} onChange={(value) => update('mouthStyle', value)} />
      <Swatches label="Colore labbra" colors={MII_LIPS} value={config.lipColor} onChange={(value) => update('lipColor', value)} />
      <Placement part="mouth" value={config.placements.mouth} onChange={(value) => setPlacement('mouth', value)} />
    </>,
    accessories: <>
      <Stepper label="Barba e baffi" value={config.beard} options={MII_BEARDS} onChange={(value) => update('beard', value)} />
      <Placement part="beard" value={config.placements.beard} onChange={(value) => setPlacement('beard', value)} />
      <Stepper label="Occhiali" value={config.glasses} options={MII_GLASSES} onChange={(value) => update('glasses', value)} />
      <Placement part="glasses" value={config.placements.glasses} onChange={(value) => setPlacement('glasses', value)} />
      <Toggle label="Guance rosee" value={config.blush} onChange={(value) => update('blush', value)} />
      {config.blush && <Placement part="blush" value={config.placements.blush} onChange={(value) => setPlacement('blush', value)} />}
      <Toggle label="Neo" value={config.mole} onChange={(value) => update('mole', value)} />
      {config.mole && <Placement part="mole" value={config.placements.mole} onChange={(value) => setPlacement('mole', value)} />}
    </>,
    style: <>
      <Swatches label="Maglia" colors={MII_SHIRTS} value={config.shirt} onChange={(value) => update('shirt', value)} />
      <Swatches label="Sfondo" colors={MII_BACKGROUNDS} value={config.background} onChange={(value) => update('background', value)} />
    </>,
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="item-modal mii-modal" role="dialog" aria-modal="true" aria-labelledby="mii-modal-title">
        <div className="modal-top"><span className="eyebrow">MII</span><button className="icon-button" onClick={onClose} aria-label="Chiudi"><X size={19} /></button></div>
        <h2 id="mii-modal-title">Crea il tuo Mii</h2>
        <div className="mii-editor">
          <div className="mii-preview">
            <div className="mii-preview-face"><MiiPortrait config={config} label="Anteprima del Mii" /></div>
            <button type="button" className="text-button mii-random" onClick={() => setConfig(randomMii())}><Shuffle size={15} /> Casuale</button>
          </div>
          <div className="mii-panel">
            <div className="mii-tabs" role="tablist" aria-label="Parti del Mii">
              {TABS.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} key={item.id} className={tab === item.id ? 'mii-tab-active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
            </div>
            <div className="mii-controls">{panels[tab]}</div>
          </div>
        </div>
        <div className="modal-footer">
          <span />
          <div>
            <button type="button" className="cancel-button" onClick={onClose}>Annulla</button>
            <button type="button" className="primary-button save-button" disabled={saving} onClick={() => onSave(config)}>
              {saving ? <LoaderCircle className="loading-icon" size={17} /> : 'Usa questo Mii'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
