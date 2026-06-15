/**
 * Widget navigation model — the single source of truth for the widget's tabs,
 * views, and which view/tab the widget lands on for a given enabled-surface
 * config. Kept as a pure module (no React) so the routing rules are unit-tested
 * directly rather than through the route component.
 *
 * Chat is folded into the Help (support) surface: the bottom bar carries at
 * most home | feedback | changelog | help, and the Help tab hosts both articles
 * and messages. A "content surface" is feedback, changelog, or support (help OR
 * chat); the aggregated Home appears when 2+ are enabled, or when no content
 * surfaces are enabled and Home is the configured landing surface.
 */

/** Bottom-bar tabs. "help" is the combined support surface (articles + messages). */
export type WidgetTab = 'home' | 'feedback' | 'changelog' | 'help'

/**
 * Discrete views the widget can render. The feedback surface's root is
 * 'feedback'; 'overview' is the aggregated Home. 'chat' is the live-chat
 * thread, reached from inside the support surface (and the Home resume card),
 * not from its own bottom tab. Detail views are pushed on top of a root.
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
  | 'chat'
  | 'messages'
  | 'support-list'
  | 'support-new'
  | 'support-detail'

/** Which surfaces the workspace has enabled for this widget (from the loader). */
export interface EnabledTabs {
  feedback?: boolean
  changelog?: boolean
  help?: boolean
  chat?: boolean
  /**
   * Admin opt-out for the aggregated Home tab. Defaults to shown; when false,
   * the widget skips Home and lands directly on the first surface even with 2+
   * content surfaces enabled.
   */
  home?: boolean
}

/** The support surface is on when either help articles or live chat is enabled. */
export function supportEnabled(tabs: EnabledTabs): boolean {
  return !!(tabs.help || tabs.chat)
}

/**
 * Root view for the support tab: the help articles when help is on, otherwise
 * the messages list (a chat-only support surface opens the conversation list).
 */
export function supportRootView(tabs: EnabledTabs): Extract<WidgetView, 'help' | 'messages'> {
  return tabs.help ? 'help' : 'messages'
}

/** Number of distinct content surfaces enabled (help + chat collapse to one). */
export function contentSurfaceCount(tabs: EnabledTabs): number {
  return [tabs.feedback, tabs.changelog, supportEnabled(tabs)].filter(Boolean).length
}

/**
 * The aggregated Home is worthwhile when it aggregates 2+ content surfaces, or
 * when it is the only enabled landing surface. With exactly one content surface,
 * the widget lands directly there and avoids a redundant Home tab.
 */
export function homeEnabled(tabs: EnabledTabs): boolean {
  if (!(tabs.home ?? true)) return false
  const surfaceCount = contentSurfaceCount(tabs)
  return surfaceCount === 0 || surfaceCount > 1
}

/** Ordered tabs the bottom bar should render (Home first, only when enabled). */
export function visibleTabs(tabs: EnabledTabs): WidgetTab[] {
  const out: WidgetTab[] = []
  if (homeEnabled(tabs)) out.push('home')
  if (tabs.feedback) out.push('feedback')
  if (tabs.changelog) out.push('changelog')
  if (supportEnabled(tabs)) out.push('help')
  return out
}

/** Tab highlighted on launch: Home when enabled, else the single surface. */
export function resolveInitialTab(tabs: EnabledTabs): WidgetTab {
  if (homeEnabled(tabs)) return 'home'
  if (tabs.feedback) return 'feedback'
  if (tabs.changelog) return 'changelog'
  if (supportEnabled(tabs)) return 'help'
  return 'feedback'
}

/** View shown on launch: the overview when Home is enabled, else the surface root. */
export function resolveInitialView(tabs: EnabledTabs): WidgetView {
  if (homeEnabled(tabs)) return 'overview'
  if (tabs.feedback) return 'feedback'
  if (tabs.changelog) return 'changelog'
  if (supportEnabled(tabs)) return supportRootView(tabs)
  return 'feedback'
}
