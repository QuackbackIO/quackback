// Tenant Quackback URL — e.g. "https://feedback.acme.com"
export type InstanceUrl = string

/** Passed to `Quackback("init", ...)` or `Quackback.init(...)`. */
export interface InitOptions {
  /** Tenant Quackback instance URL — required when using the npm package. */
  instanceUrl: InstanceUrl
  placement?: 'left' | 'right'
  defaultBoard?: string
  /** Set `launcher: false` to hide the default floating button and open programmatically. */
  launcher?: boolean
  locale?: 'en' | 'fr' | 'de' | 'es' | 'ar' | string
  /** Bundle identity into init — shorthand for init + identify. */
  identity?: Identity
}

/**
 * What the host app passes to identify the current user.
 *
 * For anonymous sessions, call `identify()` with no argument — don't pass
 * `{ anonymous: true }`. (The runtime still accepts `{ anonymous: true }` for
 * backwards-compat with muscle memory from Intercom/Featurebase, but it's not
 * in the type so TypeScript users get nudged to the cleaner form.)
 */
export type Identity =
  | { ssoToken: string }
  | ({ id: string; email: string; name?: string; avatarURL?: string } & Record<string, unknown>)

/**
 * Arguments to `Quackback.open(...)`. Discriminated on the target:
 * - omit the payload to open the home view
 * - `{ view: 'new-post', title?, body?, board? }` pre-fills the new-post form
 * - `{ view: 'changelog', entryId? }` opens the changelog, optionally to one entry
 * - `{ view: 'help', query? }` opens help, optionally with search prefilled
 * - `{ postId }` deep-links to a specific post
 * - `{ articleId }` deep-links to a help article
 *
 * Fields `view` / `title` / `board` are handled by the iframe today.
 * `body`, `query`, `postId`, `articleId`, `entryId` pass through the postMessage
 * protocol; full iframe-side handling lands in follow-up iframe work.
 */
export type OpenOptions =
  | undefined
  | { view?: 'home'; board?: string }
  | { view: 'new-post'; title?: string; body?: string; board?: string }
  | { view: 'changelog'; entryId?: string }
  | { view: 'help'; query?: string }
  | { postId: string }
  | { articleId: string }

export interface WidgetUser {
  id: string
  name: string
  email: string
  avatarUrl?: string | null
}

/**
 * Events emitted by the widget iframe. `open` and `close` carry context about
 * which view is showing so subscribers can react to deep-link flows.
 */
export interface EventMap {
  ready: Record<string, never>
  open: {
    view?: 'home' | 'new-post' | 'changelog' | 'help'
    postId?: string
    articleId?: string
    entryId?: string
  }
  close: Record<string, never>
  'post:created': {
    id: string
    title: string
    board: { id: string; name: string; slug: string }
    statusId: string | null
  }
  vote: { postId: string; voted: boolean; voteCount: number }
  'comment:created': { postId: string; commentId: string; parentId: string | null }
  identify: {
    success: boolean
    user: WidgetUser | null
    anonymous: boolean
    error?: string
  }
  /** Fires when an anonymous user supplies an email inline. */
  'email-submitted': { email: string }
}

export type EventName = keyof EventMap
export type EventHandler<T extends EventName> = (payload: EventMap[T]) => void
export type Unsubscribe = () => void
