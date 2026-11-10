/**
 * An element panel's rows, in one place: the rows it opens with, the groups
 * under More, each row's label and its stable name. The panel draws its rows
 * from these, and quick find indexes the same rows by the same names, so a
 * row and its entry never drift apart.
 */
import {
  STYLE_ELEMENTS,
  STYLE_PROPS,
  styleAllows,
  type StyleElement,
  type StyleProp,
  type StyleState,
} from '@/lib/shared/design/style-tokens'
import { SECTIONS } from './properties/words'

/** The rows an element opens with, where it has them: its fill, its text colour and size, its corners. */
export const BASICS: readonly StyleProp[] = ['background', 'color', 'size', 'radius']

/** The groups under More, in order, each with its props. */
export const SECTION_PROPS: ReadonlyArray<{ title: string; props: readonly StyleProp[] }> = [
  { title: SECTIONS.fill, props: ['background'] },
  {
    title: SECTIONS.text,
    props: ['color', 'size', 'weight', 'font', 'case', 'tracking', 'leading', 'underline'],
  },
  { title: SECTIONS.shape, props: ['radius', 'height', 'paddingX', 'paddingY'] },
  { title: SECTIONS.edge, props: ['borderColor', 'borderWidth', 'borderStyle'] },
  { title: SECTIONS.shadow, props: ['shadow'] },
  { title: SECTIONS.lift, props: ['lift'] },
  { title: SECTIONS.focusRing, props: ['ringWidth'] },
]

/** A row's label within its section: Edge's "Edge colour" is its Colour. */
const ROW_LABELS: Partial<Record<StyleProp, string>> = {
  color: 'Text colour',
  size: 'Text size',
  borderColor: 'Colour',
  borderWidth: 'Width',
  borderStyle: 'Style',
  ringWidth: 'Width',
  lift: 'Rise',
}

/** Other names a property's row answers to as well as its label: Background is the element's colour. */
const PROP_AKA: Partial<Record<StyleProp, string>> = {
  background: 'colour fill',
  borderColor: 'edge colour',
  borderWidth: 'edge width',
  borderStyle: 'edge style',
  ringWidth: 'focus ring',
}

/** The group a row's label is short for, which its path names: Edge's Colour. */
const LABEL_GROUP: Partial<Record<StyleProp, string>> = {
  borderColor: SECTIONS.edge,
  borderWidth: SECTIONS.edge,
  borderStyle: SECTIONS.edge,
  ringWidth: SECTIONS.focusRing,
  lift: SECTIONS.lift,
}

/** The words a property's row is also found by, beyond its label. */
const PROP_TERMS: Partial<Record<StyleProp, string>> = {
  background: 'colour color fill',
  color: 'colour color text',
  borderColor: 'border edge colour color',
  borderWidth: 'border edge',
  borderStyle: 'border edge dashed dotted',
  radius: 'corners rounded radius',
  shadow: 'shadow elevation',
  paddingX: 'padding spacing',
  paddingY: 'padding spacing',
  font: 'typeface family',
  size: 'font text size',
  weight: 'bold font',
  case: 'uppercase capitals',
  tracking: 'letter spacing',
  leading: 'line height',
  lift: 'hover rise move',
  ringWidth: 'focus ring outline',
}

/** A property's row label in an element panel. */
export const elementRowLabel = (prop: StyleProp): string =>
  ROW_LABELS[prop] ?? STYLE_PROPS[prop].label

/** Other names a property's row answers to, counted as its label. */
export const elementRowAka = (prop: StyleProp): string | undefined => PROP_AKA[prop]

/** The group its label is short for, named in its path; none where the label says it all. */
export const elementRowGroup = (prop: StyleProp): string | undefined => LABEL_GROUP[prop]

/** The words a property's row is found by, beyond its label. */
export const elementRowTerms = (prop: StyleProp): string =>
  [STYLE_PROPS[prop].label.toLowerCase(), PROP_TERMS[prop]].filter(Boolean).join(' ')

/** A property row's stable name, the same in every element panel it is drawn in. */
export const elementRowFind = (element: StyleElement, prop: StyleProp) =>
  `element-${element}-${prop}`

/** A Style section row's stable name: a brand choice of the element, by its label. */
export const elementStyleFind = (element: StyleElement, label: string) =>
  `element-style-${element}-${label.toLowerCase().replace(/\s+/g, '-')}`

/** The first state a property shows in, Normal where it can: where find opens its row. */
export function firstStateOf(element: StyleElement, prop: StyleProp): StyleState | null {
  return STYLE_ELEMENTS[element].states.find((state) => styleAllows(element, state, prop)) ?? null
}
