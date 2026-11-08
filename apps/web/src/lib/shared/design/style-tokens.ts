/**
 * The style token registry: every element kind of the portal, the states it
 * has, and the properties each state can set, with their values, what they
 * look like and what they are when left out. One source of truth, read by
 * the schema (what a design may hold), the resolver (the CSS it draws), the
 * Theme's Style editor (its fields and previews), Quackback AI's contract
 * (what it is told and which operations it may write) and the edit eval.
 *
 * Layers, lowest first: global tokens (palette roles, the type scale, the
 * corners, density, shadows: the rest of the design) feed the portal's own
 * look; `style` sets an element kind's look in a state over it; a Home
 * block's `look.style` sets the look of its container and of what sits in
 * it over that; the workspace's CSS stays the escape hatch over everything.
 *
 * Pure: no imports beyond zod, so the browser, the server and the rig can
 * all read it.
 */
import { z } from 'zod'

/* States */

export const STYLE_STATES = ['base', 'hover', 'active', 'focus', 'current', 'disabled'] as const
export type StyleState = (typeof STYLE_STATES)[number]

export const STATE_INFO: Record<StyleState, { label: string; about: string }> = {
  base: { label: 'Normal', about: 'as it rests' },
  hover: { label: 'Hover', about: 'under the pointer' },
  active: { label: 'Pressed', about: 'while pressed' },
  focus: {
    label: 'Focus',
    about: 'when reached by keyboard; the focus ring is always neutral grey',
  },
  current: {
    label: 'Current',
    about: 'selected: the current page in the menu, a vote cast, a chosen filter',
  },
  disabled: { label: 'Disabled', about: 'when it cannot be used' },
}

/* Values */

/**
 * The colours a style may name: a role of the palette, drawn in each mode
 * as that mode's own (so dark mode follows by itself), or an exact hex.
 */
export const COLOUR_ROLES = [
  'accent',
  'support',
  'extra1',
  'extra2',
  'ink',
  'muted',
  'page',
  'surface',
  'raised',
  'border',
  'accent-text',
  'on-accent',
  'white',
  'black',
  'transparent',
] as const
export type ColourRoleName = (typeof COLOUR_ROLES)[number]

export const COLOUR_ROLE_INFO: Record<ColourRoleName, string> = {
  accent: 'the brand colour',
  support: 'the second brand colour',
  extra1: 'the first extra brand colour',
  extra2: 'the second extra brand colour',
  ink: 'the text colour',
  muted: 'the secondary text colour',
  page: 'the page colour',
  surface: 'the card colour, usually white or near the page',
  raised: 'the raised grey: a light grey a step off the page (chips, the vote box)',
  border: 'the edge colour',
  'accent-text': 'the brand colour as readable text',
  'on-accent': 'text on the brand colour',
  white: 'white',
  black: 'black',
  transparent: 'none, see-through',
}

const HEX = /^#[0-9a-f]{6}$/i
export const styleColour = z.union([z.enum(COLOUR_ROLES), z.string().regex(HEX)])
export type StyleColour = z.output<typeof styleColour>

/** A background: a colour, or a gradient between two. */
export const stylePaint = z.union([
  styleColour,
  z
    .object({
      from: styleColour,
      to: styleColour,
      /** Degrees; 180 runs top to bottom. */
      angle: z.number().int().min(0).max(360).optional(),
    })
    .strict(),
])
export type StylePaint = z.output<typeof stylePaint>

/** Shadows, shallowest first; glow is a soft ring of the brand colour. */
export const STYLE_SHADOWS = ['none', 'soft', 'lifted', 'floating', 'deep', 'glow'] as const

/* Properties */

type PropKind =
  | { kind: 'colour' }
  | { kind: 'paint' }
  | { kind: 'number'; min: number; max: number; step: number; unit: 'px' | 'em' | '' }
  | { kind: 'choice'; looks: Readonly<Record<string, string>> }

export type StylePropInfo = PropKind & {
  label: string
  about: string
  /** Only in these states, where it means something only there. */
  states?: readonly StyleState[]
}

const num = (min: number, max: number, step: number, unit: 'px' | 'em' | '' = 'px') =>
  ({ kind: 'number', min, max, step, unit }) as const

export const STYLE_PROPS = {
  background: { kind: 'paint', label: 'Background', about: 'its fill: a colour or a gradient' },
  color: { kind: 'colour', label: 'Text', about: 'its text colour; moved until it reads' },
  borderColor: { kind: 'colour', label: 'Edge colour', about: 'the colour of its edge' },
  borderWidth: { ...num(0, 8, 1), label: 'Edge width', about: 'its edge, 0 for none' },
  borderStyle: {
    kind: 'choice',
    looks: { solid: 'a solid line', dashed: 'dashes', dotted: 'dots', none: 'no edge' },
    label: 'Edge style',
    about: 'how its edge is drawn',
  },
  radius: { ...num(0, 999, 1), label: 'Corners', about: 'corner radius; 999 is fully round' },
  shadow: {
    kind: 'choice',
    looks: {
      none: 'flat',
      soft: 'a hairline shadow',
      lifted: 'a small shadow below',
      floating: 'a soft shadow below, floating',
      deep: 'a wide, deep shadow well below',
      glow: 'a soft ring of the brand colour',
    },
    label: 'Shadow',
    about: 'how far it floats',
  },
  paddingX: { ...num(0, 64, 1), label: 'Padding across', about: 'room at its sides' },
  paddingY: { ...num(0, 64, 1), label: 'Padding down', about: 'room above and below' },
  font: {
    kind: 'choice',
    looks: { heading: 'the heading font', body: 'the body font', display: 'the headline font' },
    label: 'Font',
    about: 'which of the design’s fonts',
  },
  size: { ...num(10, 200, 1), label: 'Size', about: 'text size' },
  weight: { ...num(100, 900, 100, ''), label: 'Weight', about: 'how heavy the text is' },
  case: {
    kind: 'choice',
    looks: {
      none: 'as written',
      upper: 'ALL CAPITALS',
      lower: 'all lower case',
      capitalize: 'Each Word Capitalised',
    },
    label: 'Capitals',
    about: 'text case',
  },
  tracking: { ...num(-0.1, 0.3, 0.005, 'em'), label: 'Letter spacing', about: 'in em' },
  leading: { ...num(0.8, 2.2, 0.05, ''), label: 'Line height', about: 'as a multiple of size' },
  underline: {
    kind: 'choice',
    looks: { none: 'no underline', underline: 'underlined' },
    label: 'Underline',
    about: 'a line under the text',
  },
  height: {
    ...num(24, 72, 1),
    label: 'Height',
    about: 'its least height',
  },
  lift: {
    ...num(0, 8, 1),
    label: 'Lift',
    about: 'how far it rises, in px',
    states: ['hover', 'active'],
  },
  opacity: { ...num(0.2, 1, 0.05, ''), label: 'Opacity', about: '1 is solid' },
  ringWidth: {
    ...num(1, 6, 1),
    label: 'Focus ring width',
    about: 'the focus ring’s width; its colour is always the neutral grey',
    states: ['focus'],
  },
} as const satisfies Record<string, StylePropInfo>

export type StyleProp = keyof typeof STYLE_PROPS
export const STYLE_PROP_NAMES = Object.keys(STYLE_PROPS) as StyleProp[]

/* Elements */

const BOX: readonly StyleProp[] = [
  'background',
  'color',
  'borderColor',
  'borderWidth',
  'borderStyle',
  'radius',
  'shadow',
  'paddingX',
  'paddingY',
]
const TYPE: readonly StyleProp[] = ['font', 'size', 'weight', 'case', 'tracking', 'leading']
const CONTROL: readonly StyleProp[] = [
  ...BOX,
  ...TYPE.filter((p) => p !== 'leading'),
  'underline',
  'lift',
  'opacity',
  'ringWidth',
]

export interface StyleElementInfo {
  label: string
  about: string
  /** Where it is in the portal: a selector under the portal's root. */
  selector: string
  /** The selector of its `current` state, where it has one; its own state attribute. */
  current?: string
  states: readonly StyleState[]
  props: readonly StyleProp[]
  /**
   * What most people change on it, shown first; the rest of its properties
   * sit under More. In the order they are shown.
   */
  common: readonly StyleProp[]
  /** States drawn from its normal look when left out, in a few words. */
  derived?: string
  /** Other words people use for it, for the edit loop's router and reader. */
  aliases?: readonly string[]
  /** A request this element answers, for the AI's examples and the edit eval. */
  example: { request: string; state: StyleState; prop: StyleProp; value: string | number }
}

const PRIMARY = ':is([data-slot=button][data-variant=default], [data-qb-action])'

export const STYLE_ELEMENTS = {
  button: {
    label: 'Main buttons',
    about: 'primary buttons, such as Submit and the hero’s call to action',
    selector: PRIMARY,
    states: ['base', 'hover', 'active', 'focus', 'disabled'],
    props: [...CONTROL, 'height'],
    common: ['background', 'color', 'radius', 'size'],
    derived: 'hover and pressed darken (or lighten) a set fill a little',
    aliases: ['buttons', 'primary button', 'cta', 'call to action'],
    example: {
      request: 'Make the main buttons turn #1e1b4b when hovered',
      state: 'hover',
      prop: 'background',
      value: '#1e1b4b',
    },
  },
  secondary: {
    label: 'Secondary buttons',
    about: 'buttons beside the main one, such as Log in',
    selector: '[data-slot=button]:is([data-variant=outline], [data-variant=secondary])',
    states: ['base', 'hover', 'active', 'focus', 'disabled'],
    props: [...CONTROL, 'height'],
    common: ['background', 'color', 'radius', 'size'],
    derived: 'hover and pressed darken (or lighten) a set fill a little',
    aliases: ['outline button', 'log in button', 'secondary'],
    example: {
      request: 'Give the secondary buttons a 2px edge',
      state: 'base',
      prop: 'borderWidth',
      value: 2,
    },
  },
  ghost: {
    label: 'Quiet buttons',
    about: 'buttons with no fill until pointed at, such as icon buttons and Cancel',
    selector: '[data-slot=button][data-variant=ghost]',
    states: ['base', 'hover', 'active', 'focus', 'disabled'],
    props: [...CONTROL, 'height'],
    common: ['background', 'color', 'radius', 'size'],
    aliases: ['quiet button', 'ghost button', 'icon button'],
    example: {
      request:
        'Quiet buttons (the ones with no fill, such as Cancel) should turn the brand colour on hover',
      state: 'hover',
      prop: 'color',
      value: 'accent',
    },
  },
  link: {
    label: 'Links',
    about: 'links in text and each block’s way on',
    selector: ':is(.prose a, [data-qb-link])',
    states: ['base', 'hover', 'focus'],
    props: ['color', 'font', 'size', 'weight', 'case', 'tracking', 'underline'],
    common: ['color', 'weight', 'underline'],
    aliases: ['links', 'link'],
    example: {
      request: 'Underline links only when hovered',
      state: 'hover',
      prop: 'underline',
      value: 'underline',
    },
  },
  navItem: {
    label: 'Menu items',
    about: 'the pages in the header’s menu',
    selector: '[data-qb-part=nav-item]',
    current: '.portal-nav__item--active',
    states: ['base', 'hover', 'current', 'focus'],
    props: CONTROL.filter((p) => p !== 'lift'),
    common: ['background', 'color', 'size', 'weight'],
    aliases: ['menu', 'nav', 'navigation', 'tabs'],
    example: {
      request: 'Make the current menu item bold',
      state: 'current',
      prop: 'weight',
      value: 700,
    },
  },
  card: {
    label: 'Cards',
    about: 'post cards and other cards',
    selector: '[data-qb-surface=card]',
    states: ['base', 'hover'],
    props: [...BOX, 'lift'],
    common: ['background', 'borderColor', 'radius', 'shadow'],
    aliases: ['cards', 'post card', 'panel', 'tiles'],
    example: {
      request: 'Cards should rise 2px with a deeper shadow on hover',
      state: 'hover',
      prop: 'lift',
      value: 2,
    },
  },
  block: {
    label: 'Home blocks',
    about: 'the container of each Home block',
    selector: '[data-qb-part=home-block]',
    states: ['base', 'hover'],
    props: [...BOX, 'lift'],
    common: ['background', 'borderColor', 'radius', 'shadow'],
    aliases: ['block', 'section', 'home block'],
    example: {
      request: 'Give every Home block a dashed edge',
      state: 'base',
      prop: 'borderStyle',
      value: 'dashed',
    },
  },
  input: {
    label: 'Fields',
    about: 'the composer, search and other text fields',
    selector:
      ':is([data-qb-part=composer], [data-qb-part=search-field], input[data-slot=input], textarea[data-slot=textarea])',
    states: ['base', 'hover', 'focus', 'disabled'],
    props: [...BOX, 'size', 'height', 'ringWidth', 'opacity'],
    common: ['background', 'borderColor', 'radius', 'size'],
    aliases: ['inputs', 'search box', 'composer', 'post box', 'field'],
    example: {
      request: 'Fill the fields in the raised grey instead of the page colour',
      state: 'base',
      prop: 'background',
      value: 'raised',
    },
  },
  badge: {
    label: 'Status markers',
    about: 'a post’s status',
    selector: '[data-qb-part=status-badge]',
    states: ['base'],
    props: [...BOX, 'size', 'weight', 'case', 'tracking'],
    common: ['background', 'color', 'radius', 'size'],
    aliases: ['status', 'statuses', 'badges'],
    example: {
      request: 'Write each post’s status in capital letters, keeping how statuses look otherwise',
      state: 'base',
      prop: 'case',
      value: 'upper',
    },
  },
  chip: {
    label: 'Tags',
    about: 'tags on posts and changelog entries',
    selector: '[data-qb-part=tag]',
    states: ['base', 'hover'],
    props: [...BOX, 'size', 'weight', 'case', 'tracking'],
    common: ['background', 'color', 'radius', 'size'],
    aliases: ['tags', 'labels', 'pills'],
    example: {
      request: 'Make the tags square',
      state: 'base',
      prop: 'radius',
      value: 0,
    },
  },
  vote: {
    label: 'Vote boxes',
    about: 'the vote button on posts',
    selector: '[data-qb-part=vote-button]',
    current: '[data-state=voted]',
    states: ['base', 'hover', 'current', 'focus'],
    props: CONTROL.filter((p) => !['case', 'tracking', 'underline', 'font'].includes(p)),
    common: ['background', 'color', 'radius'],
    aliases: ['votes', 'upvote', 'vote box'],
    example: {
      request: 'Fill a cast vote with the second brand colour',
      state: 'current',
      prop: 'background',
      value: 'support',
    },
  },
  headline: {
    label: 'Page headlines',
    about: 'each page’s headline',
    selector: '[data-qb-part=headline]',
    states: ['base'],
    props: ['color', ...TYPE],
    common: ['color', 'size', 'weight'],
    aliases: ['title', 'hero title', 'h1'],
    example: {
      request: 'Set page headlines in lower case',
      state: 'base',
      prop: 'case',
      value: 'lower',
    },
  },
  subtitle: {
    label: 'Subtitles',
    about: 'the line under a page’s headline',
    selector: '[data-qb-part=subtitle]',
    states: ['base'],
    props: ['color', ...TYPE],
    common: ['color', 'size', 'weight'],
    aliases: ['tagline'],
    example: {
      request: 'Make the subtitle a little lighter, weight 300',
      state: 'base',
      prop: 'weight',
      value: 300,
    },
  },
  heading: {
    label: 'Section headings',
    about: 'the headings of blocks and sections',
    selector: '[data-qb-part=section-heading]',
    states: ['base'],
    props: ['color', ...TYPE],
    common: ['color', 'size', 'weight'],
    aliases: ['headings', 'h2', 'block titles'],
    example: {
      request: 'Put section headings in capitals',
      state: 'base',
      prop: 'case',
      value: 'upper',
    },
  },
  body: {
    label: 'Body text',
    about: 'rich text and the text on cards',
    selector: ':is(.prose, [data-qb-part=post-excerpt], [data-qb-part=post-body])',
    states: ['base'],
    props: ['color', ...TYPE],
    common: ['color', 'size', 'weight'],
    aliases: ['text', 'paragraphs'],
    example: {
      request: 'Body text in the secondary grey',
      state: 'base',
      prop: 'color',
      value: 'muted',
    },
  },
  hero: {
    label: 'Hero',
    about: 'the top of each page, behind its headline; its text moves until it reads',
    selector: '[data-qb-part=band]',
    states: ['base'],
    props: ['background', 'color', 'borderColor', 'borderWidth', 'radius', 'shadow', 'paddingY'],
    common: ['background', 'color', 'paddingY'],
    aliases: ['band', 'banner'],
    example: {
      request: 'Put a 2px edge around the hero',
      state: 'base',
      prop: 'borderWidth',
      value: 2,
    },
  },
  header: {
    label: 'Header',
    about: 'the bar with the logo and menu',
    selector: '.portal-header',
    states: ['base'],
    props: ['background', 'color', 'borderColor', 'borderWidth', 'shadow', 'paddingY'],
    common: ['background', 'color'],
    aliases: ['top bar', 'navbar'],
    example: {
      request: 'Put a soft shadow under the header',
      state: 'base',
      prop: 'shadow',
      value: 'soft',
    },
  },
  footer: {
    label: 'Footer',
    about: 'the foot of each page',
    selector: '[data-qb-section=footer]',
    states: ['base'],
    props: ['background', 'color', 'borderColor', 'borderWidth', 'paddingY'],
    common: ['background', 'color'],
    aliases: ['foot', 'bottom bar'],
    example: {
      request: 'Make the footer the raised grey',
      state: 'base',
      prop: 'background',
      value: 'raised',
    },
  },
  divider: {
    label: 'Dividers',
    about: 'lines between sections and list rows',
    selector: ':is(hr, [data-slot=separator])',
    states: ['base'],
    props: ['borderColor', 'borderWidth', 'borderStyle'],
    common: ['borderColor', 'borderWidth', 'borderStyle'],
    aliases: ['lines', 'rules', 'separators'],
    example: {
      request: 'Dotted dividers',
      state: 'base',
      prop: 'borderStyle',
      value: 'dotted',
    },
  },
  image: {
    label: 'Images',
    about: 'images in posts, articles and the hero',
    selector: ':is(.prose img, [data-qb-part=band-image] img, [data-qb-part=post-band] img)',
    states: ['base'],
    props: ['radius', 'borderColor', 'borderWidth', 'shadow'],
    common: ['radius', 'shadow'],
    aliases: ['images', 'pictures', 'photos'],
    example: {
      request: 'Round the corners of images, 16px',
      state: 'base',
      prop: 'radius',
      value: 16,
    },
  },
} as const satisfies Record<string, StyleElementInfo>

export type StyleElement = keyof typeof STYLE_ELEMENTS
export const STYLE_ELEMENT_NAMES = Object.keys(STYLE_ELEMENTS) as StyleElement[]

/** The elements a Home block's own look can set, inside it. */
export const BLOCK_STYLE_ELEMENTS = [
  'block',
  'card',
  'heading',
  'body',
  'button',
  'secondary',
  'ghost',
  'link',
  'chip',
  'badge',
  'vote',
  'input',
] as const satisfies readonly StyleElement[]
export type BlockStyleElement = (typeof BLOCK_STYLE_ELEMENTS)[number]

/** Whether an element has a state and a property in that state. */
export function styleAllows(element: string, state: string, prop: string): boolean {
  const el = (STYLE_ELEMENTS as Record<string, StyleElementInfo>)[element]
  const info = (STYLE_PROPS as Record<string, StylePropInfo>)[prop]
  if (!el || !info) return false
  return (
    (el.states as readonly string[]).includes(state) &&
    (el.props as readonly string[]).includes(prop) &&
    (!info.states || (info.states as readonly string[]).includes(state))
  )
}

/* The schema */

function propSchema(prop: StyleProp): z.ZodType {
  const info: StylePropInfo = STYLE_PROPS[prop]
  switch (info.kind) {
    case 'colour':
      return styleColour
    case 'paint':
      return stylePaint
    case 'number':
      return z.number().min(info.min).max(info.max)
    case 'choice':
      return z.enum(Object.keys(info.looks) as [string, ...string[]])
  }
}

export type StyleProps = Partial<{
  background: StylePaint
  color: StyleColour
  borderColor: StyleColour
  borderWidth: number
  borderStyle: 'solid' | 'dashed' | 'dotted' | 'none'
  radius: number
  shadow: (typeof STYLE_SHADOWS)[number]
  paddingX: number
  paddingY: number
  font: 'heading' | 'body' | 'display'
  size: number
  weight: number
  case: 'none' | 'upper' | 'lower' | 'capitalize'
  tracking: number
  leading: number
  underline: 'none' | 'underline'
  height: number
  lift: number
  opacity: number
  ringWidth: number
}>
export type ElementStyle = Partial<Record<StyleState, StyleProps>>
export type StyleSheet = Partial<Record<StyleElement, ElementStyle>>
export type BlockStyleSheet = Partial<Record<BlockStyleElement, ElementStyle>>

/** Colour properties, which dark mode can set apart. */
export const COLOUR_PROPS = ['background', 'color', 'borderColor'] as const

function elementSchema(element: StyleElement, only?: readonly StyleProp[]) {
  const el: StyleElementInfo = STYLE_ELEMENTS[element]
  return z
    .object(
      Object.fromEntries(
        el.states.map((state) => [
          state,
          z
            .object(
              Object.fromEntries(
                el.props
                  .filter((prop) => styleAllows(element, state, prop))
                  .filter((prop) => !only || only.includes(prop))
                  .map((prop) => [prop, propSchema(prop).optional()])
              )
            )
            .strict()
            .optional(),
        ])
      )
    )
    .strict()
    .optional()
}

const sheetSchema = (elements: readonly StyleElement[], only?: readonly StyleProp[]) =>
  z.object(Object.fromEntries(elements.map((el) => [el, elementSchema(el, only)]))).strict()

/**
 * Properties a phone may set apart: all but colours, which follow the mode
 * and are the same on every screen.
 */
export const PHONE_PROPS = STYLE_PROP_NAMES.filter(
  (prop) => !(COLOUR_PROPS as readonly string[]).includes(prop)
)

/**
 * One element's look, its states and their properties, as the registry
 * allows; `only` keeps to some properties, such as dark mode's colours or a
 * phone's sizes.
 */
export function elementStyleSchema(
  element: StyleElement,
  only?: readonly StyleProp[]
): z.ZodType<ElementStyle | undefined> {
  return elementSchema(element, only) as unknown as z.ZodType<ElementStyle | undefined>
}

/** Element styles, as `design.style`. */
export const styleSheetSchema = sheetSchema(STYLE_ELEMENT_NAMES) as unknown as z.ZodType<StyleSheet>
/** Dark mode's own colours over `style`, as `design.styleDark`; each left out is worked out. */
export const darkStyleSheetSchema = sheetSchema(
  STYLE_ELEMENT_NAMES,
  COLOUR_PROPS
) as unknown as z.ZodType<StyleSheet>
/** A Home block's own look of what is in it, as `look.style`. */
export const blockStyleSheetSchema = sheetSchema(
  BLOCK_STYLE_ELEMENTS
) as unknown as z.ZodType<BlockStyleSheet>
/** Phones' own values over `style`, as `design.stylePhone`: sizes and shapes, never colours. */
export const phoneStyleSheetSchema = sheetSchema(
  STYLE_ELEMENT_NAMES,
  PHONE_PROPS
) as unknown as z.ZodType<StyleSheet>
/** Phones' own values over a Home block's look, as `look.phone`. */
export const blockPhoneSheetSchema = sheetSchema(
  BLOCK_STYLE_ELEMENTS,
  PHONE_PROPS
) as unknown as z.ZodType<BlockStyleSheet>

/* Machine-readable list */

export interface StyleToken {
  /** Its path in the design, such as style.button.hover.background. */
  name: string
  element: StyleElement
  state: StyleState
  prop: StyleProp
  type: StylePropInfo['kind']
  /** The values a choice takes, with what each looks like. */
  looks?: Readonly<Record<string, string>>
  range?: { min: number; max: number; step: number; unit: string }
  about: string
  /** What it is when left out. */
  default: string
}

/** What a property is when a design leaves it out. */
function defaultOf(element: StyleElement, state: StyleState, prop: StyleProp): string {
  const el: StyleElementInfo = STYLE_ELEMENTS[element]
  if (state === 'base') return 'the portal’s own look from the Theme'
  if (
    (state === 'hover' || state === 'active') &&
    prop === 'background' &&
    el.derived?.includes('darken')
  )
    return 'a little darker (or lighter on a dark fill) than its normal fill, when that is set'
  if (state === 'focus' && prop === 'ringWidth') return 'the neutral focus ring’s own width'
  return `as its normal look`
}

/** Every token the registry offers, flat. */
export function styleTokens(): StyleToken[] {
  return STYLE_ELEMENT_NAMES.flatMap((element) => {
    const el: StyleElementInfo = STYLE_ELEMENTS[element]
    return el.states.flatMap((state) =>
      el.props
        .filter((prop) => styleAllows(element, state, prop))
        .map((prop) => {
          const info: StylePropInfo = STYLE_PROPS[prop]
          return {
            name: `style.${element}.${state}.${prop}`,
            element,
            state,
            prop,
            type: info.kind,
            ...(info.kind === 'choice' ? { looks: info.looks } : {}),
            ...(info.kind === 'number'
              ? { range: { min: info.min, max: info.max, step: info.step, unit: info.unit } }
              : {}),
            about: `${el.label} ${STATE_INFO[state].about}: ${info.about}`,
            default: defaultOf(element, state, prop),
          }
        })
    )
  })
}

/**
 * A style key as people and the AI write it, to its path: `style.button.hover.background`,
 * `button.hover.background`, or `style.button.background` for the normal state;
 * `styleDark.` for dark mode's own colour. Null for no such token.
 */
export function stylePath(key: string): string | null {
  const m = /^(style|styleDark)\.(\w+)\.(?:(\w+)\.)?(\w+)$/.exec(key)
  if (!m) return null
  const [root, element, state, prop] = [m[1]!, m[2]!, m[3] ?? 'base', m[4]!]
  if (!styleAllows(element, state, prop)) return null
  if (root === 'styleDark' && !(COLOUR_PROPS as readonly string[]).includes(prop)) return null
  return `${root}.${element}.${state}.${prop}`
}

/** A Home block's style key, `style.card.hover.background`, to its path under the block's look. */
export function blockStylePath(key: string): string | null {
  const m = /^style\.(\w+)\.(?:(\w+)\.)?(\w+)$/.exec(key)
  if (!m) return null
  const [element, state, prop] = [m[1]!, m[2] ?? 'base', m[3]!]
  if (!(BLOCK_STYLE_ELEMENTS as readonly string[]).includes(element)) return null
  return styleAllows(element, state, prop) ? `style.${element}.${state}.${prop}` : null
}

/** A value as the AI or a field writes it, read for its property: numbers, gradients, roles. */
export function readStyleValue(prop: StyleProp, value: unknown): unknown {
  const info: StylePropInfo = STYLE_PROPS[prop]
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (info.kind === 'number' && /^-?\d+(\.\d+)?(px|em)?$/.test(text)) return parseFloat(text)
  if (info.kind === 'paint' && text.startsWith('{')) {
    try {
      return JSON.parse(text)
    } catch {
      return value
    }
  }
  if (info.kind === 'colour' || info.kind === 'paint') {
    const word = text
      .toLowerCase()
      .replace(/ colou?r$/, '')
      .replace(/\s+/g, '-')
    const alias: Record<string, ColourRoleName> = {
      brand: 'accent',
      primary: 'accent',
      second: 'support',
      text: 'ink',
      background: 'page',
      card: 'surface',
      grey: 'muted',
      gray: 'muted',
    }
    if ((COLOUR_ROLES as readonly string[]).includes(word)) return word
    if (alias[word]) return alias[word]
    if (/^#[0-9a-f]{3}$/i.test(text))
      return `#${[...text.slice(1)].map((c) => c + c).join('')}`.toLowerCase()
    return text.toLowerCase()
  }
  return value
}

/* What Quackback AI is told */

function propText(prop: StyleProp): string {
  const info: StylePropInfo = STYLE_PROPS[prop]
  switch (info.kind) {
    case 'colour':
      return `${prop} (colour)`
    case 'paint':
      return `${prop} (colour, or {"from":colour,"to":colour,"angle":degrees} for a gradient)`
    case 'number':
      return `${prop} (${info.min} to ${info.max}${info.unit})`
    case 'choice':
      return `${prop} (${Object.keys(info.looks).join('|')})`
  }
}

/**
 * The element styles, written from the registry: each element with what it
 * is, its states and properties; the properties' values; the colours by role;
 * what is worked out when left out; and the per-block keys.
 */
export function styleText(): string {
  const elements = STYLE_ELEMENT_NAMES.map((element) => {
    const el: StyleElementInfo = STYLE_ELEMENTS[element]
    return `${element} (${el.about}): states ${el.states.join(', ')}; ${el.props.join(', ')}`
  }).join('. ')
  const props = STYLE_PROP_NAMES.map(propText).join(', ')
  const roles = COLOUR_ROLES.map((role) => `${role} (${COLOUR_ROLE_INFO[role]})`).join(', ')
  const states = STYLE_STATES.map((state) => `${state} (${STATE_INFO[state].about})`).join(', ')
  return `style: each element's look in a state, over everything above; set one with op theme, key style.<element>.<state>.<property> (the state may be left out for base), such as style.button.hover.background; null clears it. Elements: ${elements}. States: ${states}. Properties: ${props}; ringWidth only in focus (the focus ring is always neutral grey and has no colour to set), lift only in hover and active. Colours: a role, drawn as each mode's own so dark mode follows by itself: ${roles}; or a hex. Left out: hover and pressed fills of buttons, menu items, tags and vote boxes are a little darker than a set normal fill; text on any set fill is moved until it reads, and a fill without text takes the text or page colour. styleDark.<element>.<state>.<background|color|borderColor> (op theme): dark mode's own colour, only where dark should differ from the role or colour light uses, such as {"op":"theme","key":"styleDark.link.base.color","value":"#93c5fd"}. A Home block's own look: op set, target the block, key style.<${BLOCK_STYLE_ELEMENTS.join('|')}>.<state>.<property>, where block is its container and the rest are what sits inside it. Prefer the choices and exact values above where one says it exactly; use style for a state (hover, pressed, current, focus), an element no choice reaches, a trait no choice offers, or one block. Capitals of one element are style.<element>.base.case (upper, lower, capitalize): statuses in capitals are style.badge.base.case upper, section headings in capitals style.heading.base.case upper, headlines in lower case style.headline.base.case lower (headlineCase and labelCase take only sentence or upper).`
}
