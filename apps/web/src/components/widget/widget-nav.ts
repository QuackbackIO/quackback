/**
 * Widget navigation model — the single source of truth for the widget's tabs,
 * views, and which view/tab the widget lands on for a given enabled-surface
 * config. Kept as a pure module (no React) so the routing rules are unit-tested
 * directly rather than through the route component.
 *
 * Each surface is independent: Messages (conversations), Feedback, Help
 * (articles), and Changelog each own a bottom-bar tab. A "content surface" is
 * any of those four; the aggregated Home appears only when 2+ are enabled. The
 * bottom bar carries, in order: home | messages | feedback | help | changelog.
 */

/** Bottom-bar tabs. "messages" is the messenger (conversations) surface. */
export type WidgetTab = 'home' | 'messages' | 'feedback' | 'help' | 'changelog'

/**
 * Discrete views the widget can render. Each surface's root is its own view;
 * 'overview' is the aggregated Home. 'messenger' is a single conversation
 * thread, pushed on top of the 'messages' list (and reachable from the Home
 * resume card). Detail views are pushed on top of a root.
 */
export type WidgetView =
  | 'overview'
  | 'feedback'
  | 'post-detail'
  | 'success'
  | 'changelog'
  | 'changelog-detail'
  | 'help'
  | 'help-category'
  | 'help-detail'
  | 'messenger'
  | 'messages'

/**
 * Which surfaces the workspace has enabled for this widget (from the loader).
 * The persisted config names the messenger surface `messenger`; the loader maps
 * it to `messages` here so the widget code speaks the user-facing tab name.
 */
export interface EnabledTabs {
  feedback?: boolean
  changelog?: boolean
  help?: boolean
  /** Messenger conversations (the "Messages" tab). */
  messages?: boolean
  /**
   * Admin opt-out for the aggregated Home tab. Defaults to shown; when false,
   * the widget skips Home and lands directly on the first surface even with 2+
   * content surfaces enabled.
   */
  home?: boolean
}

/** Number of distinct content surfaces enabled (Messages, Feedback, Help, Changelog). */
export function contentSurfaceCount(tabs: EnabledTabs): number {
  return [tabs.messages, tabs.feedback, tabs.help, tabs.changelog].filter(Boolean).length
}

/**
 * The aggregated Home is only worthwhile when 2+ content surfaces are enabled,
 * and only when the admin hasn't opted out of it (defaults to shown).
 */
export function homeEnabled(tabs: EnabledTabs): boolean {
  return (tabs.home ?? true) && contentSurfaceCount(tabs) > 1
}

/** Ordered tabs the bottom bar should render (Home first, only when enabled). */
export function visibleTabs(tabs: EnabledTabs): WidgetTab[] {
  const out: WidgetTab[] = []
  if (homeEnabled(tabs)) out.push('home')
  if (tabs.messages) out.push('messages')
  if (tabs.feedback) out.push('feedback')
  if (tabs.help) out.push('help')
  if (tabs.changelog) out.push('changelog')
  return out
}

/**
 * Views showing a single long-form entity (a feedback post, help article, or
 * changelog entry). The widget asks the host SDK to grow the panel while one
 * is open and to shrink back when it closes — reading-width content deserves
 * the larger canvas; lists and the thread keep the compact panel.
 */
export function isExpandedView(view: WidgetView): boolean {
  return view === 'post-detail' || view === 'help-detail' || view === 'changelog-detail'
}

/** Tab highlighted on launch: Home when enabled, else the first enabled surface. */
export function resolveInitialTab(tabs: EnabledTabs): WidgetTab {
  if (homeEnabled(tabs)) return 'home'
  if (tabs.messages) return 'messages'
  if (tabs.feedback) return 'feedback'
  if (tabs.help) return 'help'
  if (tabs.changelog) return 'changelog'
  return 'feedback'
}

/** View shown on launch: the overview when Home is enabled, else the surface root. */
export function resolveInitialView(tabs: EnabledTabs): WidgetView {
  if (homeEnabled(tabs)) return 'overview'
  if (tabs.messages) return 'messages'
  if (tabs.feedback) return 'feedback'
  if (tabs.help) return 'help'
  if (tabs.changelog) return 'changelog'
  return 'feedback'
}
