/**
 * The elements the portal styles the same wherever they appear: the
 * headline, the buttons, the cards and so on. They are looks, set from the
 * styles, never picked on the page: a click on the page picks a block.
 */

export const DESIGN_ELEMENTS = [
  'headline',
  'subtitle',
  'heading',
  'menu',
  'button',
  'card',
  'vote',
  'field',
  'logo',
  'status',
  'link',
  'secondary',
  'body',
] as const
export type DesignElement = (typeof DESIGN_ELEMENTS)[number]

export const ELEMENT_NAMES: Record<DesignElement, string> = {
  headline: 'Headline',
  subtitle: 'Subtitle',
  heading: 'Section headings',
  menu: 'Menu',
  button: 'Buttons',
  card: 'Cards',
  vote: 'Vote boxes',
  field: 'Fields',
  logo: 'Logo',
  status: 'Status and tags',
  link: 'Links',
  secondary: 'Secondary buttons',
  body: 'Body text',
}
