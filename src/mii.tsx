import { useId } from 'react'
import type { MiiConfig } from './types'

export const MII_BACKGROUNDS = ['#cde9f8', '#fde2e4', '#e3f5d8', '#fff0c2', '#e6dcff', '#d9f2ef']
export const MII_SKIN = ['#fde4cc', '#f9d3b0', '#eebb93', '#d99c74', '#b87a56', '#8c5a3d']
export const MII_HAIR = ['#2a2220', '#5b3b26', '#9b6b3c', '#e2c379', '#d9d4cf', '#c0502f']
export const MII_EYES = ['#2b2a36', '#3c6ea6', '#4f8a50', '#6e4a2a', '#7656b8']
export const MII_LIPS = ['#c25a60', '#dd7f8c', '#a2474f', '#8a4a4a']
export const MII_SHIRTS = ['#7068d8', '#4d86c6', '#d87568', '#3d9b80', '#d9953c', '#bd68a3', '#404055', '#f2f2f6']

export const MII_FACE_SHAPES = ['Tonda', 'Ovale', 'Quadrata', 'Larga']
export const MII_HAIR_STYLES = ['Calvo', 'Corto', 'Scriminatura', 'Lungo', 'Chignon', 'Riccio', 'Punte', 'Rasato']
export const MII_EYE_STYLES = ['Punto', 'Ovale', 'Tondo', 'Assonnato', 'Stretto', 'Felice']
export const MII_EYEBROW_STYLES = ['Piatte', 'Arcuate', 'Spesse', 'Inclinate', 'Sottili']
export const MII_NOSE_STYLES = ['Nessuno', 'Punto', 'Linea', 'Ampio']
export const MII_MOUTH_STYLES = ['Sorriso', 'Aperta', 'Ghigno', 'Piatta', 'Tonda', 'Sorrisetto']
export const MII_BEARDS = ['Nessuna', 'Baffi', 'Pizzetto', 'Barba piena']
export const MII_GLASSES = ['Nessuno', 'Tondi', 'Quadrati']

const INK = '#2b2a36'

const CHOICE_COUNTS = {
  background: MII_BACKGROUNDS.length,
  faceShape: MII_FACE_SHAPES.length,
  skin: MII_SKIN.length,
  hairStyle: MII_HAIR_STYLES.length,
  hairColor: MII_HAIR.length,
  eyeStyle: MII_EYE_STYLES.length,
  eyeColor: MII_EYES.length,
  eyebrowStyle: MII_EYEBROW_STYLES.length,
  noseStyle: MII_NOSE_STYLES.length,
  mouthStyle: MII_MOUTH_STYLES.length,
  lipColor: MII_LIPS.length,
  beard: MII_BEARDS.length,
  glasses: MII_GLASSES.length,
  shirt: MII_SHIRTS.length,
} as const

export type MiiChoiceKey = keyof typeof CHOICE_COUNTS

export const MII_DEFAULT: MiiConfig = {
  background: 0,
  faceShape: 0,
  skin: 1,
  hairStyle: 1,
  hairColor: 1,
  eyeStyle: 0,
  eyeColor: 0,
  eyeSpacing: 50,
  eyeSize: 50,
  eyeTilt: 50,
  eyebrowStyle: 1,
  noseStyle: 1,
  mouthStyle: 0,
  lipColor: 0,
  beard: 0,
  glasses: 0,
  blush: false,
  mole: false,
  shirt: 0,
}

function pickIndex(value: unknown, count: number, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count ? value : fallback
}

function pickSlider(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback
}

export function normalizeMii(value: unknown): MiiConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source = value as Partial<Record<keyof MiiConfig, unknown>>
  const result: MiiConfig = { ...MII_DEFAULT }
  for (const key of Object.keys(CHOICE_COUNTS) as MiiChoiceKey[]) {
    result[key] = pickIndex(source[key], CHOICE_COUNTS[key], MII_DEFAULT[key])
  }
  result.eyeSpacing = pickSlider(source.eyeSpacing, MII_DEFAULT.eyeSpacing)
  result.eyeSize = pickSlider(source.eyeSize, MII_DEFAULT.eyeSize)
  result.eyeTilt = pickSlider(source.eyeTilt, MII_DEFAULT.eyeTilt)
  result.blush = source.blush === true
  result.mole = source.mole === true
  return result
}

export function randomMii(): MiiConfig {
  const pick = (count: number) => Math.floor(Math.random() * count)
  const result = { ...MII_DEFAULT }
  for (const key of Object.keys(CHOICE_COUNTS) as MiiChoiceKey[]) result[key] = pick(CHOICE_COUNTS[key])
  result.eyeSpacing = pick(101)
  result.eyeSize = pick(101)
  result.eyeTilt = pick(101)
  result.blush = Math.random() < 0.35
  result.mole = Math.random() < 0.2
  return result
}

function mixHex(from: string, to: string, amount: number) {
  const channels = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
  const start = channels(from)
  const end = channels(to)
  return `#${start.map((value, index) => Math.round(value + (end[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`
}

export function MiiPortrait({ config, label = 'Mii' }: { config: MiiConfig; label?: string }) {
  const clipId = `mii-clip-${useId().replace(/:/g, '')}`
  const skin = MII_SKIN[config.skin]
  const shade = mixHex(skin, '#5a2a10', 0.16)
  const hair = MII_HAIR[config.hairColor]
  const iris = MII_EYES[config.eyeColor]
  const lip = MII_LIPS[config.lipColor]
  const spacing = 13 + (config.eyeSpacing / 100) * 11
  const eyeScale = 0.8 + (config.eyeSize / 100) * 0.5
  const tilt = ((config.eyeTilt - 50) / 50) * 14
  const eyeY = 55
  const eyes = [-1, 1].map((side) => ({ side, x: 60 + side * spacing }))
  const lensEdge = spacing - 8.5

  const head = [
    <ellipse key="head" cx="60" cy="56" rx="27" ry="29" fill={skin} />,
    <ellipse key="head" cx="60" cy="56" rx="24" ry="31" fill={skin} />,
    <rect key="head" x="34" y="27" width="52" height="58" rx="22" fill={skin} />,
    <ellipse key="head" cx="60" cy="57" rx="31" ry="26" fill={skin} />,
  ][config.faceShape]

  const cap = 'M31 54 C27 24 93 24 89 54 C84 42 74 37 60 37 C46 37 36 42 31 54 Z'
  const frontHair = [
    null,
    <path d={cap} fill={hair} />,
    <path d="M30 56 C26 24 94 22 90 56 C84 40 64 30 44 34 C36 36 32 44 30 56 Z" fill={hair} />,
    <path d={cap} fill={hair} />,
    <g fill={hair}><path d={cap} /><circle cx="60" cy="18" r="11" /></g>,
    <g fill={hair}>
      <path d={cap} />
      <circle cx="36" cy="44" r="8" /><circle cx="44" cy="34" r="9" /><circle cx="56" cy="28" r="9" />
      <circle cx="68" cy="30" r="9" /><circle cx="80" cy="38" r="9" /><circle cx="88" cy="48" r="8" />
    </g>,
    <path d="M31 52 L26 30 L40 40 L44 20 L54 33 L60 16 L66 33 L76 20 L80 40 L94 30 L89 52 C84 42 74 37 60 37 C46 37 36 42 31 52 Z" fill={hair} />,
    <path d="M32 50 C30 32 90 32 88 50 C82 42 38 42 32 50 Z" fill={hair} />,
  ][config.hairStyle]

  const eyeArt = (style: number) => [
    <circle r="3.6" fill={iris} />,
    <ellipse rx="3.2" ry="5.2" fill={iris} />,
    <>
      <circle r="6.5" fill="#fff" stroke={INK} strokeWidth="1.2" />
      <circle r="3.8" fill={iris} />
      <circle cx="1.3" cy="-1.4" r="1.1" fill="#fff" />
    </>,
    <path d="M-5 -1 Q0 4 5 -1" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />,
    <ellipse rx="4.6" ry="2.2" fill={iris} />,
    <path d="M-5 2 Q0 -4.5 5 2" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />,
  ][style]

  const brow = (side: number, style: number) => {
    const angle = side === -1 ? -2 : 2
    const path = [
      'M-7 0 L7 0',
      'M-7 2 Q0 -4 7 1',
      'M-8 0 L8 0',
      `M-7 ${angle} L7 ${-angle}`,
      'M-7 1 Q0 -3 7 1',
    ][style]
    const width = [3, 2.8, 5.5, 3, 1.8][style]
    return { path, width }
  }

  const nose = [
    null,
    <circle cx="60" cy="66" r="2" fill={shade} />,
    <path d="M58 61 Q55 67 59 68 Q61 68 62 66" fill="none" stroke={shade} strokeWidth="1.6" strokeLinecap="round" />,
    <path d="M55 67 Q60 71 65 67" fill="none" stroke={shade} strokeWidth="1.8" strokeLinecap="round" />,
  ][config.noseStyle]

  const mouth = [
    <path d="M50 76 Q60 86 70 76" fill="none" stroke={lip} strokeWidth="3" strokeLinecap="round" />,
    <path d="M50 76 Q60 74 70 76 Q68 88 60 88 Q52 88 50 76 Z" fill="#7a2f3a" stroke={lip} strokeWidth="2" strokeLinejoin="round" />,
    <path d="M48 75 Q60 90 72 75 Z" fill="#8a3440" stroke="#7a2f3a" strokeWidth="1.5" strokeLinejoin="round" />,
    <path d="M52 80 Q60 81 68 80" fill="none" stroke={lip} strokeWidth="3" strokeLinecap="round" />,
    <ellipse cx="60" cy="81" rx="3.8" ry="4.8" fill={lip} />,
    <path d="M52 79 Q60 84 68 76" fill="none" stroke={lip} strokeWidth="2.8" strokeLinecap="round" />,
  ][config.mouthStyle]

  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={label} className="mii-portrait">
      <defs>
        <clipPath id={clipId}><circle cx="60" cy="60" r="60" /></clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="120" height="120" fill={MII_BACKGROUNDS[config.background]} />
        {config.hairStyle === 3 && <path d="M30 46 L27 100 Q60 108 93 100 L90 46 Z" fill={hair} />}
        <path d="M12 124 C12 98 34 88 60 88 C86 88 108 98 108 124 Z" fill={MII_SHIRTS[config.shirt]} />
        <rect x="50" y="74" width="20" height="18" fill={shade} />
        <circle cx="33" cy="57" r="6" fill={skin} />
        <circle cx="87" cy="57" r="6" fill={skin} />
        {head}
        <ellipse cx="46" cy="36" rx="11" ry="6" fill="#fff" opacity=".22" transform="rotate(-20 46 36)" />
        {frontHair}
        {config.glasses === 1 && <g fill="#ffffff22" stroke={INK} strokeWidth="1.8">
          {eyes.map(({ side, x }) => <circle key={side} cx={x} cy={eyeY - 1} r="8.5" />)}
          <line x1={60 - lensEdge} y1={eyeY - 1} x2={60 + lensEdge} y2={eyeY - 1} />
        </g>}
        {config.glasses === 2 && <g fill="#ffffff22" stroke={INK} strokeWidth="1.8">
          {eyes.map(({ side, x }) => <rect key={side} x={x - 8.5} y={eyeY - 7} width="17" height="14" rx="3" />)}
          <line x1={60 - lensEdge} y1={eyeY - 1} x2={60 + lensEdge} y2={eyeY - 1} />
        </g>}
        {eyes.map(({ side, x }) => {
          const { path, width } = brow(side, config.eyebrowStyle)
          return <path key={`brow-${side}`} d={path} transform={`translate(${x} 43)`} fill="none" stroke={hair} strokeWidth={width} strokeLinecap="round" />
        })}
        {eyes.map(({ side, x }) => (
          <g key={`eye-${side}`} transform={`translate(${x} ${eyeY}) rotate(${side * tilt}) scale(${eyeScale})`}>
            {eyeArt(config.eyeStyle)}
          </g>
        ))}
        {config.blush && eyes.map(({ side, x }) => <circle key={`blush-${side}`} cx={x} cy="67" r="5" fill="#ff6f7d" opacity=".35" />)}
        {nose}
        {config.beard === 2 && <ellipse cx="60" cy="91" rx="6" ry="4.5" fill={hair} />}
        {config.beard === 3 && <path d="M33 58 Q34 94 60 96 Q86 94 87 58 Q84 78 60 80 Q36 78 33 58 Z" fill={hair} />}
        {mouth}
        {config.beard === 1 && <path d="M50 73 Q55 70 60 72 Q65 70 70 73 Q65 76 60 75 Q55 76 50 73 Z" fill={hair} />}
        {config.mole && <circle cx="69" cy="71" r="1.2" fill="#3a2a22" />}
      </g>
    </svg>
  )
}
