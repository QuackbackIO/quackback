/**
 * The menu's words, one for each idea. The properties vocabulary
 * (components/designer/properties/words.ts) takes these in, so a panel, a
 * click menu and an undo label all say the same thing; they live here so
 * the menu's own steps can say them too.
 */
export const MENU_WORDS = {
  /** The page visitors and the logo go to. */
  landingPage: 'Landing page',
  makeLanding: 'Make it the landing page',
  /** A menu item the menu does not show, and the ways out of and into it. */
  hidden: 'Hidden',
  hide: 'Hide',
  show: 'Show',
  /** A menu item's name, renamed where the menu draws it. */
  name: 'Name',
  rename: 'Rename',
  /** The menu runs across the page, so its items move left and right. */
  moveLeft: 'Move left',
  moveRight: 'Move right',
  remove: 'Remove',
  /** A link in the menu. */
  link: 'Link',
  address: 'Address',
  newTab: 'New tab',
  removeLink: 'Remove link',
  linkNeedsName: 'Give the link a name.',
  addToMenu: 'Add to the menu',
} as const
