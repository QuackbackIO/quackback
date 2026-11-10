/**
 * Home's hero has one main action under its headline: the composer, the help
 * search (with Ask AI where it is on), a call to action, or none, leaving the
 * headline and subtitle alone.
 *
 * Designs stored before the choice keep what they draw: the composer in the
 * band (pages.home.composer `band`) is the Composer, on the grid it is None.
 * So the Composer and None are stored as the composer's place alone, and only
 * Search and Button are stored as pages.home.mainAction. Outside the hero the
 * composer is a block on the grid, as it always was.
 */
import { GRID_COLUMNS } from './home-grid'
import { settleHome } from './home'
import { DESIGN_OPTIONS } from './options'
import type { PortalPageGates } from './paths'
import type { PortalDesign } from './schema'

export type MainAction = (typeof DESIGN_OPTIONS.mainAction)[number]
export type ButtonTo = (typeof DESIGN_OPTIONS.heroButtonTo)[number]
type Home = PortalDesign['pages']['home']

/** The hero's main action as stored: a choice, else the composer's place. */
export function mainActionOf(home: Pick<Home, 'mainAction' | 'composer'>): MainAction {
  return home.mainAction ?? (home.composer === 'band' ? 'composer' : 'none')
}

/** Whether Home's composer sits in the hero rather than on the grid. */
export function composerInHero(home: Pick<Home, 'mainAction' | 'composer'>): boolean {
  return mainActionOf(home) === 'composer'
}

/** Where the call to action goes as stored; absent opens the composer. */
export function buttonToOf(home: Pick<Home, 'button'>): ButtonTo {
  return home.button?.to ?? 'composer'
}

/** Whether the page a call to action goes to is on: the composer is feedback's. */
const buttonPageOn = (to: ButtonTo, gates: PortalPageGates) =>
  to === 'composer' ? gates.feedback : gates[to]

/**
 * Where the call to action goes as drawn: the roadmap, help or support only
 * while that page is on, the composer only while feedback is; null with
 * nowhere to go.
 */
export function drawnButtonTo(home: Pick<Home, 'button'>, gates: PortalPageGates): ButtonTo | null {
  const to = buttonToOf(home)
  if (to !== 'composer' && buttonPageOn(to, gates)) return to
  if (gates.feedback) return 'composer'
  return gates.roadmap ? 'roadmap' : null
}

/** The main action Home draws: Search needs the help centre, a button somewhere to go. */
export function drawnMainAction(
  home: Pick<Home, 'mainAction' | 'composer' | 'button'>,
  gates: PortalPageGates
): MainAction {
  const action = mainActionOf(home)
  if (action === 'search' && !gates.help) return 'none'
  if (action === 'button' && !drawnButtonTo(home, gates)) return 'none'
  return action
}

/** Writes the hero's main action; one stored before the choice could be is stored as before. */
export function writeMainAction(draft: PortalDesign, action: MainAction): void {
  const home = draft.pages.home
  // The action already drawn changes nothing, so Home is not laid out again.
  if (action === mainActionOf(home)) return
  if (action === 'composer') {
    delete home.mainAction
    home.composer = 'band'
    // In the hero, a contact block takes its own row rather than a half-empty one.
    for (const block of home.blocks)
      if (block.type === 'contact') block.grid = { ...block.grid, x: 0, w: GRID_COLUMNS }
    settleHome(draft)
    return
  }
  delete home.composer
  if (action === 'none') delete home.mainAction
  else home.mainAction = action
}

/** What the panel offers, given the pages that are on, and a short line for each left out. */
export function mainActionsOffered(gates: PortalPageGates): {
  actions: MainAction[]
  buttonTo: ButtonTo[]
  /** Why a main action, or a place for the call to action to go, is left out. */
  notes: { actions: string[]; buttonTo: string[] }
} {
  const left = (action: MainAction): boolean => {
    if (action === 'composer') return !gates.feedback
    if (action === 'search') return !gates.help
    if (action === 'button') return !gates.feedback && !gates.roadmap
    return false
  }
  const actions = DESIGN_OPTIONS.mainAction.filter((action) => !left(action))
  const buttonTo = DESIGN_OPTIONS.heroButtonTo.filter((to) => buttonPageOn(to, gates))
  return {
    actions,
    buttonTo,
    notes: {
      actions: [
        ...(gates.feedback ? [] : ['The composer needs feedback on.']),
        ...(gates.help ? [] : ['Search needs the help centre on.']),
      ],
      buttonTo: [
        ...(gates.roadmap ? [] : ['The roadmap needs to be on for a button to go there.']),
        ...(gates.help ? [] : ['The help centre needs to be on for a button to go there.']),
        ...(gates.support ? [] : ['Support needs to be on for a button to go there.']),
      ],
    },
  }
}
