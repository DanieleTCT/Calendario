import { useId } from 'react'
import type { MiiConfig, MiiPartKey, MiiPlacement } from './types'

export const MII_BACKGROUNDS = ['#cde9f8', '#fde2e4', '#e3f5d8', '#fff0c2', '#e6dcff', '#d9f2ef']
export const MII_SKIN = ['#fde4cc', '#f9d3b0', '#eebb93', '#d99c74', '#b87a56', '#8c5a3d']
export const MII_HAIR = ['#2a2220', '#5b3b26', '#9b6b3c', '#e2c379', '#d9d4cf', '#c0502f']
export const MII_EYES = ['#2b2a36', '#3c6ea6', '#4f8a50', '#6e4a2a', '#7656b8']
export const MII_LIPS = ['#c25a60', '#dd7f8c', '#a2474f', '#8a4a4a']
export const MII_SHIRTS = ['#7068d8', '#4d86c6', '#d87568', '#3d9b80', '#d9953c', '#bd68a3', '#404055', '#f2f2f6']

// Le nuove forme sono in coda agli elenchi: così i Mii salvati mantengono lo stesso aspetto.
export const MII_FACE_SHAPES = ['Tonda', 'Ovale', 'Quadrata', 'Larga', 'Allungata', 'A cuore']
export const MII_HAIR_STYLES = ['Calvo', 'Corto', 'Scriminatura', 'Lungo', 'Chignon', 'Riccio', 'Punte', 'Rasato', 'Cresta', 'Mullet', 'Caschetto', 'Codino', 'Afro']
export const MII_EAR_STYLES = ['Normali', 'Piccole', 'Grandi', 'A punta']
export const MII_EYE_STYLES = ['Punto', 'Ovale', 'Tondo', 'Assonnato', 'Stretto', 'Felice', 'Mandorla', 'Goccia', 'Con ciglia', 'Lucido']
export const MII_EYEBROW_STYLES = ['Piatte', 'Arcuate', 'Spesse', 'Inclinate', 'Sottili', 'Cespugliose', 'Preoccupate', 'Ondulate']
export const MII_NOSE_STYLES = ['Nessuno', 'Punto', 'Linea', 'Ampio', 'Patata', 'Adunco', 'Pallina']
export const MII_MOUTH_STYLES = ['Sorriso', 'Aperta', 'Ghigno', 'Piatta', 'Tonda', 'Sorrisetto', 'A cuore', 'Linguetta', 'Dentino', 'Triste']
export const MII_BEARDS = ['Nessuna', 'Baffi', 'Pizzetto', 'Barba piena', 'Baffi arricciati', 'Barba corta']
export const MII_GLASSES = ['Nessuno', 'Tondi', 'Quadrati', 'Da sole', 'Goccia']

export const MII_PART_LABELS: Record<MiiPartKey, string> = {
  hair: 'Capelli',
  ears: 'Orecchie',
  eyes: 'Occhi',
  eyebrows: 'Sopracciglia',
  nose: 'Naso',
  mouth: 'Bocca',
  beard: 'Barba',
  glasses: 'Occhiali',
  blush: 'Guance',
  mole: 'Neo',
}

const INK = '#2b2a36'
const PART_KEYS = Object.keys(MII_PART_LABELS) as MiiPartKey[]

export const MII_NEUTRAL_PLACEMENT: MiiPlacement = { x: 50, y: 50, scale: 50, rotate: 50 }

const CHOICE_COUNTS = {
  background: MII_BACKGROUNDS.length,
  faceShape: MII_FACE_SHAPES.length,
  skin: MII_SKIN.length,
  hairStyle: MII_HAIR_STYLES.length,
  hairColor: MII_HAIR.length,
  earStyle: MII_EAR_STYLES.length,
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

type ChoiceKey = keyof typeof CHOICE_COUNTS

export const MII_DEFAULT: MiiConfig = {
  background: 0,
  faceShape: 0,
  skin: 1,
  hairStyle: 1,
  hairColor: 1,
  earStyle: 0,
  eyeStyle: 0,
  eyeColor: 0,
  eyeSpacing: 50,
  eyebrowStyle: 1,
  noseStyle: 1,
  mouthStyle: 0,
  lipColor: 0,
  beard: 0,
  glasses: 0,
  blush: false,
  mole: false,
  shirt: 0,
  placements: Object.fromEntries(PART_KEYS.map((key) => [key, { ...MII_NEUTRAL_PLACEMENT }])) as Record<MiiPartKey, MiiPlacement>,
}

function pickIndex(value: unknown, count: number, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count ? value : fallback
}

function pickSlider(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback
}

function normalizePlacement(value: unknown, fallback: MiiPlacement): MiiPlacement {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    x: pickSlider(source.x, fallback.x),
    y: pickSlider(source.y, fallback.y),
    scale: pickSlider(source.scale, fallback.scale),
    rotate: pickSlider(source.rotate, fallback.rotate),
  }
}

export function normalizeMii(value: unknown): MiiConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const result: MiiConfig = { ...MII_DEFAULT, placements: { ...MII_DEFAULT.placements } }
  for (const key of Object.keys(CHOICE_COUNTS) as ChoiceKey[]) {
    result[key] = pickIndex(source[key], CHOICE_COUNTS[key], MII_DEFAULT[key])
  }
  result.eyeSpacing = pickSlider(source.eyeSpacing, MII_DEFAULT.eyeSpacing)
  result.blush = source.blush === true
  result.mole = source.mole === true

  const rawPlacements = (typeof source.placements === 'object' && source.placements !== null ? source.placements : {}) as Record<string, unknown>
  for (const key of PART_KEYS) {
    result.placements[key] = normalizePlacement(rawPlacements[key], MII_DEFAULT.placements[key])
  }
  // Compatibilità con i Mii salvati prima delle posizioni per parte: dimensione e inclinazione degli occhi.
  if (!('placements' in source) && ('eyeSize' in source || 'eyeTilt' in source)) {
    result.placements.eyes = {
      ...MII_NEUTRAL_PLACEMENT,
      scale: pickSlider(source.eyeSize, 50),
      rotate: pickSlider(source.eyeTilt, 50),
    }
  }
  return result
}

export function randomMii(): MiiConfig {
  const pick = (count: number) => Math.floor(Math.random() * count)
  const range = (min: number, max: number) => min + pick(max - min + 1)
  const result: MiiConfig = { ...MII_DEFAULT }
  for (const key of Object.keys(CHOICE_COUNTS) as ChoiceKey[]) result[key] = pick(CHOICE_COUNTS[key])
  result.eyeSpacing = range(20, 80)
  result.blush = Math.random() < 0.35
  result.mole = Math.random() < 0.2
  result.placements = Object.fromEntries(PART_KEYS.map((key) => [key, {
    x: range(40, 60),
    y: range(40, 60),
    scale: range(35, 65),
    rotate: range(40, 60),
  }])) as Record<MiiPartKey, MiiPlacement>
  return result
}

function mixHex(from: string, to: string, amount: number) {
  const channels = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
  const start = channels(from)
  const end = channels(to)
  return `#${start.map((value, index) => Math.round(value + (end[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`
}

// Sposta, ridimensiona e ruota una parte attorno al suo punto di ancoraggio (le coordinate sono quelle del viso 120×120).
function placementTransform(placement: MiiPlacement, anchorX: number, anchorY: number, rotates = true, mirror = 1) {
  const dx = ((placement.x - 50) / 50) * 20 * mirror
  const dy = ((placement.y - 50) / 50) * 20
  const scale = 0.5 + placement.scale / 100
  const rotation = rotates ? ((placement.rotate - 50) / 50) * 30 * mirror : 0
  return `translate(${anchorX + dx} ${anchorY + dy}) rotate(${rotation}) scale(${scale}) translate(${-anchorX} ${-anchorY})`
}

export function MiiPortrait({ config, label = 'Mii' }: { config: MiiConfig; label?: string }) {
  const clipId = `mii-clip-${useId().replace(/:/g, '')}`
  const skin = MII_SKIN[config.skin]
  const shade = mixHex(skin, '#5a2a10', 0.16)
  const hair = MII_HAIR[config.hairColor]
  const iris = MII_EYES[config.eyeColor]
  const lip = MII_LIPS[config.lipColor]
  const P = config.placements
  const spacing = 13 + (config.eyeSpacing / 100) * 11
  const eyeY = 55
  const eyeTilt = ((P.eyes.rotate - 50) / 50) * 20
  const eyes = [-1, 1].map((side) => ({ side, x: 60 + side * spacing }))
  const lensEdge = spacing - 8.5

  const hairT = placementTransform(P.hair, 60, 40)
  const eyesT = placementTransform(P.eyes, 60, eyeY, false)
  const browT = placementTransform(P.eyebrows, 60, 43)
  const noseT = placementTransform(P.nose, 60, 66)
  const mouthT = placementTransform(P.mouth, 60, 80)
  const beardT = placementTransform(P.beard, 60, 80)
  const glassesT = placementTransform(P.glasses, 60, eyeY)
  const blushT = placementTransform(P.blush, 60, 67)
  const moleT = placementTransform(P.mole, 69, 71)

  const head = [
    <ellipse cx="60" cy="56" rx="27" ry="29" />,
    <ellipse cx="60" cy="56" rx="24" ry="31" />,
    <rect x="34" y="27" width="52" height="58" rx="22" />,
    <ellipse cx="60" cy="57" rx="31" ry="26" />,
    <ellipse cx="60" cy="56" rx="22" ry="33" />,
    <path d="M60 84 C40 72 30 60 32 44 C34 28 50 24 60 36 C70 24 86 28 88 44 C90 60 80 72 60 84 Z" />,
  ][config.faceShape]

  const ear = (side: -1 | 1) => [
    <circle cx={side === -1 ? 33 : 87} cy="57" r="6" />,
    <circle cx={side === -1 ? 34 : 86} cy="57" r="4" />,
    <circle cx={side === -1 ? 30 : 90} cy="57" r="9" />,
    <path d={side === -1 ? 'M36 50 Q20 48 18 40 Q28 58 36 62 Z' : 'M84 50 Q100 48 102 40 Q92 58 84 62 Z'} />,
  ][config.earStyle]

  const cap = 'M31 54 C27 24 93 24 89 54 C84 42 74 37 60 37 C46 37 36 42 31 54 Z'
  const hairBack = [
    null, null, null,
    <path d="M30 46 L27 100 Q60 108 93 100 L90 46 Z" />,
    null, null, null, null, null,
    <path d="M32 46 L30 84 Q60 92 90 84 L88 46 Z" />,
    <path d="M30 46 L28 74 Q60 80 92 74 L90 46 Z" />,
    <path d="M82 40 C104 48 102 80 92 94 C94 76 90 62 80 54 Z" />,
    <circle cx="60" cy="38" r="38" />,
  ][config.hairStyle]
  const hairFront = [
    null,
    <path d={cap} />,
    <path d="M30 56 C26 24 94 22 90 56 C84 40 64 30 44 34 C36 36 32 44 30 56 Z" />,
    <path d={cap} />,
    <><path d={cap} /><circle cx="60" cy="18" r="11" /></>,
    <>
      <path d={cap} />
      <circle cx="36" cy="44" r="8" /><circle cx="44" cy="34" r="9" /><circle cx="56" cy="28" r="9" />
      <circle cx="68" cy="30" r="9" /><circle cx="80" cy="38" r="9" /><circle cx="88" cy="48" r="8" />
    </>,
    <path d="M31 52 L26 30 L40 40 L44 20 L54 33 L60 16 L66 33 L76 20 L80 40 L94 30 L89 52 C84 42 74 37 60 37 C46 37 36 42 31 52 Z" />,
    <path d="M32 50 C30 32 90 32 88 50 C82 42 38 42 32 50 Z" />,
    <><path d="M32 50 C30 32 90 32 88 50 C82 42 38 42 32 50 Z" /><path d="M47 44 L52 14 L60 8 L68 14 L73 44 C68 36 52 36 47 44 Z" /></>,
    <path d={cap} />,
    <path d={cap} />,
    <path d={cap} />,
    <path d={cap} />,
  ][config.hairStyle]

  const eyeArt = [
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
    <>
      <path d="M-7 0 Q0 -6 7 0 Q0 6 -7 0 Z" fill="#fff" stroke={INK} strokeWidth="1.1" />
      <circle r="2.8" fill={iris} />
    </>,
    <path d="M0 -6 C4 -1 5 3 0 5 C-5 3 -4 -1 0 -6 Z" fill={iris} />,
    <>
      <ellipse rx="3.2" ry="4.8" fill={iris} />
      <path d="M-5 -3 L-7 -5 M-2 -4.5 L-3 -7 M1.5 -4.5 L2 -7" stroke={INK} strokeWidth="1" strokeLinecap="round" />
    </>,
    <>
      <circle r="7" fill={iris} />
      <circle r="3.5" fill={INK} />
      <circle cx="2" cy="-2" r="1.8" fill="#fff" />
    </>,
  ][config.eyeStyle]

  const brow = (side: number, style: number): [string, number] => {
    const angle = side === -1 ? -2 : 2
    return [
      ['M-7 0 L7 0', 3],
      ['M-7 2 Q0 -4 7 1', 2.8],
      ['M-8 0 L8 0', 5.5],
      [`M-7 ${angle} L7 ${-angle}`, 3],
      ['M-7 1 Q0 -3 7 1', 1.8],
      ['M-7 1 Q-4 -3 -1 1 Q2 -3 7 1', 3.2],
      [`M-7 ${-angle} L7 ${angle}`, 2.8],
      ['M-8 1 Q-4 -3 0 1 T8 1', 2.2],
    ][style] as [string, number]
  }

  const nose = [
    null,
    <circle cx="60" cy="66" r="2" fill={shade} />,
    <path d="M58 61 Q55 67 59 68 Q61 68 62 66" fill="none" stroke={shade} strokeWidth="1.6" strokeLinecap="round" />,
    <path d="M55 67 Q60 71 65 67" fill="none" stroke={shade} strokeWidth="1.8" strokeLinecap="round" />,
    <path d="M55 64 Q60 60 65 64 Q67 70 60 70 Q53 70 55 64 Z" fill={shade} opacity=".5" />,
    <path d="M57 60 Q60 62 60 68 Q60 71 56 69" fill="none" stroke={shade} strokeWidth="1.8" strokeLinecap="round" />,
    <circle cx="60" cy="67" r="3.2" fill={skin} stroke={shade} strokeWidth="1.2" />,
  ][config.noseStyle]

  const smile = <path d="M50 76 Q60 86 70 76" fill="none" stroke={lip} strokeWidth="3" strokeLinecap="round" />
  const mouth = [
    smile,
    <path d="M50 76 Q60 74 70 76 Q68 88 60 88 Q52 88 50 76 Z" fill="#7a2f3a" stroke={lip} strokeWidth="2" strokeLinejoin="round" />,
    <path d="M48 75 Q60 90 72 75 Z" fill="#8a3440" stroke="#7a2f3a" strokeWidth="1.5" strokeLinejoin="round" />,
    <path d="M52 80 Q60 81 68 80" fill="none" stroke={lip} strokeWidth="3" strokeLinecap="round" />,
    <ellipse cx="60" cy="81" rx="3.8" ry="4.8" fill={lip} />,
    <path d="M52 79 Q60 84 68 76" fill="none" stroke={lip} strokeWidth="2.8" strokeLinecap="round" />,
    <path d="M50 76 Q55 72 60 76 Q65 72 70 76 Q66 84 60 84 Q54 84 50 76 Z" fill={lip} />,
    <>
      {smile}
      <path d="M55 81 Q60 90 65 81 Z" fill="#e46d7c" />
    </>,
    <>
      {smile}
      <rect x="57" y="80" width="5" height="5" rx="1" fill="#fff" stroke={INK} strokeWidth=".8" />
    </>,
    <path d="M50 84 Q60 74 70 84" fill="none" stroke={lip} strokeWidth="3" strokeLinecap="round" />,
  ][config.mouthStyle]

  const lensShape = (style: number, x: number) => {
    if (style === 1) return <circle key={x} cx={x} cy={eyeY - 1} r="8.5" />
    if (style === 4) return <path key={x} d={`M${x - 9} ${eyeY - 6} Q${x} ${eyeY - 8} ${x + 9} ${eyeY - 6} Q${x + 8} ${eyeY + 8} ${x} ${eyeY + 8} Q${x - 8} ${eyeY + 8} ${x - 9} ${eyeY - 6} Z`} />
    return <rect key={x} x={x - 8.5} y={eyeY - 7} width="17" height="14" rx="3" />
  }

  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={label} className="mii-portrait">
      <defs>
        <clipPath id={clipId}><circle cx="60" cy="60" r="60" /></clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="120" height="120" fill={MII_BACKGROUNDS[config.background]} />
        {hairBack && <g transform={hairT} fill={hair}>{hairBack}</g>}
        <path d="M12 124 C12 98 34 88 60 88 C86 88 108 98 108 124 Z" fill={MII_SHIRTS[config.shirt]} />
        <rect x="50" y="74" width="20" height="18" fill={shade} />
        <g transform={placementTransform(P.ears, 33, 57, true, 1)} fill={skin}>{ear(-1)}</g>
        <g transform={placementTransform(P.ears, 87, 57, true, -1)} fill={skin}>{ear(1)}</g>
        <g fill={skin}>{head}</g>
        <ellipse cx="46" cy="36" rx="11" ry="6" fill="#fff" opacity=".22" transform="rotate(-20 46 36)" />
        {hairFront && <g transform={hairT} fill={hair}>{hairFront}</g>}
        {config.glasses > 0 && <g transform={glassesT} stroke={INK} strokeWidth="1.8" fill={config.glasses === 3 ? INK : '#ffffff22'}>
          {eyes.map(({ x }) => lensShape(config.glasses, x))}
          <line x1={60 - lensEdge} y1={eyeY - 1} x2={60 + lensEdge} y2={eyeY - 1} />
        </g>}
        <g transform={browT} fill="none" stroke={hair} strokeLinecap="round">
          {eyes.map(({ side, x }) => {
            const [d, width] = brow(side, config.eyebrowStyle)
            return <path key={side} d={d} transform={`translate(${x} 43)`} strokeWidth={width} />
          })}
        </g>
        <g transform={eyesT}>
          {eyes.map(({ side, x }) => (
            <g key={side} transform={`translate(${x} ${eyeY}) rotate(${side * eyeTilt})`}>
              {eyeArt}
            </g>
          ))}
        </g>
        {config.blush && <g transform={blushT}>
          {eyes.map(({ side, x }) => <circle key={side} cx={x} cy="67" r="5" fill="#ff6f7d" opacity=".35" />)}
        </g>}
        <g transform={noseT}>{nose}</g>
        <g transform={beardT}>
          {config.beard === 2 && <ellipse cx="60" cy="91" rx="6" ry="4.5" fill={hair} />}
          {(config.beard === 3 || config.beard === 5) && <path d="M33 58 Q34 94 60 96 Q86 94 87 58 Q84 78 60 80 Q36 78 33 58 Z" fill={hair} opacity={config.beard === 5 ? 0.5 : 1} />}
        </g>
        <g transform={mouthT}>{mouth}</g>
        <g transform={beardT}>
          {config.beard === 1 && <path d="M50 73 Q55 70 60 72 Q65 70 70 73 Q65 76 60 75 Q55 76 50 73 Z" fill={hair} />}
          {config.beard === 4 && <path d="M46 72 Q53 74 60 73 Q67 74 74 72 Q68 68 60 72 Q52 68 46 72 Z" fill={hair} />}
        </g>
        {config.mole && <circle cx="69" cy="71" r="1.2" fill="#3a2a22" transform={moleT} />}
      </g>
    </svg>
  )
}
