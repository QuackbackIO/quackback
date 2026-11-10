/**
 * A design's exact values (its tune), as the schema bounds them: what each
 * group holds, setting one, and the brand colours an exact colour links to.
 * The element panel shows them as its rows' brand values (element-brand.ts).
 */
import { designRoles } from '@/lib/shared/design/colour-roles'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { TUNE_COLOUR_ROLES, tuneRoleHex, type Tune } from '@/lib/shared/design/tune'
import type { ColourToken } from '@/components/designer/properties/tokens'
import { COLOUR_NAMES } from '@/components/designer/properties/words'

export type TuneGroupName = keyof Tune

type Field =
  | {
      key: string
      label: string
      kind: 'number'
      min: number
      max: number
      step?: number
      unit?: string
    }
  | { key: string; label: string; kind: 'colour' }
  /** A weight of the face that draws it. */
  | { key: string; label: string; kind: 'weight' }
  | { key: string; label: string; kind: 'choice'; options: Array<[string, string]> }

const SIZE = { kind: 'number', min: 10, max: 200, unit: 'px' } as const
const WEIGHT = { kind: 'weight' } as const
const TRACKING = { kind: 'number', min: -0.1, max: 0.3, step: 0.005, unit: 'em' } as const
const LEADING = { kind: 'number', min: 0.8, max: 2.2, step: 0.05 } as const

/** Every exact value a design holds, by group, as the schema bounds them. */
export const TUNE_GROUPS: Record<TuneGroupName, { title: string; fields: Field[] }> = {
  headline: {
    title: 'Headline',
    fields: [
      { key: 'size', label: 'Size', ...SIZE },
      { key: 'weight', label: 'Weight', ...WEIGHT },
      { key: 'tracking', label: 'Letter spacing', ...TRACKING },
      { key: 'leading', label: 'Line height', ...LEADING },
      { key: 'colour', label: 'Colour', kind: 'colour' },
    ],
  },
  subtitle: {
    title: 'Subtitle',
    fields: [
      { key: 'size', label: 'Size', kind: 'number', min: 12, max: 32, unit: 'px' },
      { key: 'weight', label: 'Weight', ...WEIGHT },
      { key: 'colour', label: 'Colour', kind: 'colour' },
    ],
  },
  heading: {
    title: 'Section headings',
    fields: [
      { key: 'size', label: 'Size', ...SIZE },
      { key: 'weight', label: 'Weight', ...WEIGHT },
      { key: 'tracking', label: 'Letter spacing', ...TRACKING },
      { key: 'leading', label: 'Line height', ...LEADING },
      { key: 'colour', label: 'Colour', kind: 'colour' },
    ],
  },
  label: {
    title: 'Menu and button labels',
    fields: [
      { key: 'size', label: 'Size', ...SIZE },
      { key: 'weight', label: 'Weight', ...WEIGHT },
      { key: 'tracking', label: 'Letter spacing', ...TRACKING },
    ],
  },
  button: {
    title: 'Buttons',
    fields: [
      { key: 'radius', label: 'Corners', kind: 'number', min: 0, max: 999, unit: 'px' },
      { key: 'height', label: 'Height', kind: 'number', min: 24, max: 72, unit: 'px' },
      { key: 'fill', label: 'Fill', kind: 'colour' },
      { key: 'ink', label: 'Label', kind: 'colour' },
      { key: 'weight', label: 'Label weight', ...WEIGHT },
      {
        key: 'case',
        label: 'Capitals',
        kind: 'choice',
        options: [
          ['sentence', 'As written'],
          ['upper', 'All capitals'],
        ],
      },
    ],
  },
  card: {
    title: 'Cards',
    fields: [
      { key: 'radius', label: 'Corners', kind: 'number', min: 0, max: 48, unit: 'px' },
      { key: 'border', label: 'Edge', kind: 'number', min: 0, max: 4, unit: 'px' },
      {
        key: 'shadow',
        label: 'Shadow',
        kind: 'choice',
        options: [
          ['none', 'None'],
          ['soft', 'Soft'],
          ['lifted', 'Lifted'],
          ['floating', 'Floating'],
          ['deep', 'Deep'],
        ],
      },
      { key: 'titleSize', label: 'Title size', kind: 'number', min: 12, max: 28, unit: 'px' },
      { key: 'titleWeight', label: 'Title weight', ...WEIGHT },
    ],
  },
  field: {
    title: 'Fields',
    fields: [{ key: 'radius', label: 'Corners', kind: 'number', min: 0, max: 999, unit: 'px' }],
  },
  link: {
    title: 'Links',
    fields: [
      { key: 'colour', label: 'Colour', kind: 'colour' },
      {
        key: 'underline',
        label: 'Underline',
        kind: 'choice',
        options: [
          ['always', 'Always'],
          ['hover', 'On pointer over'],
          ['never', 'Never'],
        ],
      },
      { key: 'weight', label: 'Weight', ...WEIGHT },
    ],
  },
  secondary: {
    title: 'Secondary buttons',
    fields: [
      {
        key: 'style',
        label: 'Style',
        kind: 'choice',
        options: [
          ['outline', 'Outline in the brand colour'],
          ['tint', 'Tint of the brand colour'],
          ['text', 'Text only'],
        ],
      },
    ],
  },
  body: {
    title: 'Body text',
    fields: [
      { key: 'size', label: 'Size', kind: 'number', min: 12, max: 20, unit: 'px' },
      { key: 'leading', label: 'Line height', kind: 'number', min: 1.2, max: 2, step: 0.05 },
    ],
  },
}

/** Sets or clears one exact value, dropping a group, and the whole tune, once empty. */
export function setTune(
  draft: PortalDesign,
  group: TuneGroupName,
  key: string,
  value: unknown
): void {
  const next = { ...(draft.tune ?? {}) } as Record<string, Record<string, unknown> | undefined>
  const fields = { ...(next[group] ?? {}) }
  if (value === undefined) delete fields[key]
  else fields[key] = value
  if (Object.keys(fields).length) next[group] = fields
  else delete next[group]
  if (Object.keys(next).length) draft.tune = next as Tune
  else delete draft.tune
}

/**
 * The brand colours an exact colour links to, each as it draws: a tune
 * stores the role's name, so it follows the brand (tune.ts).
 */
export function tuneTokens(design: PortalDesign): ColourToken[] {
  const has = designRoles(design)
  return TUNE_COLOUR_ROLES.filter(
    (role) => role === 'ink' || role === 'page' || has.includes(role)
  ).map((role) => ({ id: role, name: COLOUR_NAMES[role], light: tuneRoleHex(design, role) }))
}
