/**
 * The Phone canvas is a mode: what changes there is a phone value. It is
 * tinted wherever it shows, the canvas's frame, a panel's scope block and a
 * row's dot, so editing phones is never mistaken for editing every screen.
 * Tablet has no values of its own and is never tinted.
 */
export const PHONE_TINT = {
  frame: 'border-sky-500 ring-2 ring-sky-500/25',
  block: 'rounded-md bg-sky-500/10 p-2 ring-1 ring-sky-500/30',
  dot: 'bg-sky-500',
  caption: 'text-sky-700 dark:text-sky-300',
  /** The Phone tile picked, in the chip under the scope line. */
  chip: 'bg-sky-700 text-white',
} as const

export const PHONE_WORDS = {
  /** The chip under the scope line: which screens a change goes to. */
  editing: 'Editing',
  allScreens: 'All screens',
  phone: 'Phone',
  /** A row whose value differs on phones. */
  setForPhones: 'Set for phones',
  /** On a phone, a row set for phones: its value goes, and all screens' shows. */
  useAllScreens: 'Use all-screens value',
} as const
