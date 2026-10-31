import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, Shuffle, X } from 'lucide-react'
import {
  MII_BACKGROUNDS,
  MII_BEARDS,
  MII_EYE_STYLES,
  MII_EYEBROW_STYLES,
  MII_EYES,
  MII_FACE_SHAPES,
  MII_GLASSES,
  MII_HAIR,
  MII_HAIR_STYLES,
  MII_LIPS,
  MII_MOUTH_STYLES,
  MII_NOSE_STYLES,
  MII_SHIRTS,
  MII_SKIN,
  MiiPortrait,
  randomMii,
} from './mii'
import type { MiiConfig } from './types'

type MiiTab = 'face' | 'hair' | 'eyes' | 'extras'

const TABS: { id: MiiTab; label: string }[] = [
  { id: 'face', label: 'Viso' },
  { id: 'hair', label: 'Capelli' },
  { id: 'eyes', label: 'Occhi' },
  { id: 'extras', label: 'Extra' },
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

  const panels: Record<MiiTab, ReactNode> = {
    face: <>
      <Stepper label="Forma del viso" value={config.faceShape} options={MII_FACE_SHAPES} onChange={(value) => update('faceShape', value)} />
      <Swatches label="Colore della pelle" colors={MII_SKIN} value={config.skin} onChange={(value) => update('skin', value)} />
      <Stepper label="Naso" value={config.noseStyle} options={MII_NOSE_STYLES} onChange={(value) => update('noseStyle', value)} />
      <Stepper label="Bocca" value={config.mouthStyle} options={MII_MOUTH_STYLES} onChange={(value) => update('mouthStyle', value)} />
      <Swatches label="Colore labbra" colors={MII_LIPS} value={config.lipColor} onChange={(value) => update('lipColor', value)} />
    </>,
    hair: <>
      <Stepper label="Stile dei capelli" value={config.hairStyle} options={MII_HAIR_STYLES} onChange={(value) => update('hairStyle', value)} />
      <Swatches label="Colore dei capelli" colors={MII_HAIR} value={config.hairColor} onChange={(value) => update('hairColor', value)} />
    </>,
    eyes: <>
      <Stepper label="Stile degli occhi" value={config.eyeStyle} options={MII_EYE_STYLES} onChange={(value) => update('eyeStyle', value)} />
      <Swatches label="Colore dell'iride" colors={MII_EYES} value={config.eyeColor} onChange={(value) => update('eyeColor', value)} />
      <Slider label="Distanza" value={config.eyeSpacing} onChange={(value) => update('eyeSpacing', value)} />
      <Slider label="Dimensione" value={config.eyeSize} onChange={(value) => update('eyeSize', value)} />
      <Slider label="Inclinazione" value={config.eyeTilt} onChange={(value) => update('eyeTilt', value)} />
      <Stepper label="Sopracciglia" value={config.eyebrowStyle} options={MII_EYEBROW_STYLES} onChange={(value) => update('eyebrowStyle', value)} />
    </>,
    extras: <>
      <Stepper label="Barba e baffi" value={config.beard} options={MII_BEARDS} onChange={(value) => update('beard', value)} />
      <Stepper label="Occhiali" value={config.glasses} options={MII_GLASSES} onChange={(value) => update('glasses', value)} />
      <Toggle label="Guance rosee" value={config.blush} onChange={(value) => update('blush', value)} />
      <Toggle label="Neo" value={config.mole} onChange={(value) => update('mole', value)} />
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
