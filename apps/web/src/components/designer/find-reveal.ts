/**
 * Quick find's last step: once its panel is open, waits for the row to be
 * drawn (a panel may draw it a moment later), opens what it sits under,
 * focuses its control and outlines it for a moment in neutral grey. A row
 * never drawn leaves focus in the panel, never on the page's body.
 */

/** Where a place's rows are drawn: Theme's sheet, or the panel under any sheet. */
export const FIND_ROOTS = {
  theme: '[data-theme-sheet]',
  panel: '[data-panel-under]',
} as const

/** How long the row is outlined. */
export const FIND_FLASH_MS = 1200

/** How long to wait for a row to be drawn. */
const WAIT_MS = 3000

const FOCUSABLE =
  'input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), summary, [role=switch], [tabindex]:not([tabindex="-1"])'

/** The outline: the neutral grey of a change shown, with no motion. */
const FLASH = [
  'outline',
  'outline-2',
  'outline-offset-2',
  'outline-muted-foreground/60',
  'rounded-sm',
]

const wait = () => new Promise<void>((done) => setTimeout(done, 16))

/** The control a row is used by: its picked tile, else its first control, else the row itself. */
function controlOf(row: HTMLElement): HTMLElement {
  if (row.matches(FOCUSABLE)) return row
  const found =
    row.querySelector<HTMLElement>('[role=radio][aria-checked=true]') ??
    row.querySelector<HTMLElement>(FOCUSABLE)
  if (found) return found
  row.tabIndex = -1
  return row
}

/** Outlines a row for a moment; a newer outline restarts it. */
function flash(row: HTMLElement) {
  row.classList.add(...FLASH)
  row.setAttribute('data-find-flash', '')
  setTimeout(() => {
    row.classList.remove(...FLASH)
    row.removeAttribute('data-find-flash')
  }, FIND_FLASH_MS)
}

/**
 * Leads to a row: `root` is where it is drawn, `row` its stable name and
 * `opens` a disclosure to open first, by its `data-find-open`. Resolves to
 * the control focused, or null when the row never drew.
 */
export async function revealRow({
  root,
  row,
  opens,
  waitMs = WAIT_MS,
}: {
  root: string
  row: string
  opens?: string
  waitMs?: number | undefined
}): Promise<HTMLElement | null> {
  const until = Date.now() + waitMs
  let opened = false
  for (;;) {
    await wait()
    // The page went while it waited.
    if (typeof document === 'undefined') return null
    const scope = document.querySelector(root)
    if (scope && opens && !opened) {
      const button = scope.querySelector<HTMLElement>(`[data-find-open="${opens}"]`)
      if (button) {
        opened = true
        if (button.getAttribute('aria-expanded') === 'false') button.click()
      }
    }
    const found = scope?.querySelector<HTMLElement>(`[data-find="${row}"]`)
    if (found) {
      // What it sits under opens first, such as an element's More.
      for (
        let shut = found.closest('details');
        shut;
        shut = shut.parentElement?.closest('details') ?? null
      )
        shut.open = true
      const control = controlOf(found)
      control.focus({ preventScroll: true })
      found.scrollIntoView?.({ block: 'center' })
      flash(found)
      return control
    }
    if (Date.now() > until) {
      document.getElementById('designer-settings')?.focus()
      return null
    }
  }
}
