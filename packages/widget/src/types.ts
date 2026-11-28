// Workspace Quackback URL — e.g. "https://feedback.acme.com"
export type InstanceUrl = string

/**
 * Languages Quackback ships catalogs for, as BCP-47 tags (autocomplete hints
 * for the `locale` option). This is the single source for the `locale` type
 * below. The widget is a standalone published package and can't import the
 * app's `SUPPORTED_LOCALES`, so a parity test in apps/web guarantees this list
 * never drifts from it.
 */
export const WIDGET_LOCALES = [
  'en',
  'fr',
  'de',
  'es',
  'ar',
  'ru',
  'pt-BR',
  'zh-CN',
  'zh-TW',
  'nl',
  'pl',
  'th',
  'uk',
] as const

/** Passed to `Quackback("init", ...)` or `Quackback.init(...)`. */
export interface InitOptions {
  /** Workspace Quackback instance URL — required when using the npm package. */
  instanceUrl: InstanceUrl
  placement?: 'left' | 'right'
  defaultBoard?: string
  /** Set `launcher: false` to hide the default floating button and open programmatically. */
  launcher?: boolean
  /**
   * The current user's own language in your app, as a BCP-47 tag. It wins
   * over every other language step (the person's choice in Quackback, the
   * workspace's visitor setting, the browser) and is recorded as an
   * identified person's detected language, which emails use when the person
   * has not chosen one. Pass each user's own language, or leave it out. A fixed value for everyone hides each visitor's own language.
   * A tag Quackback has no catalog for falls through to the next step. The
   * literals are autocomplete hints for the languages Quackback ships today
   * (see WIDGET_LOCALES).
   */
  locale?: (typeof WIDGET_LOCALES)[number] | (string & {})
  /** Bundle identity into init — shorthand for init + identify. */
  identity?: Identity
  /**
   * Set `tracking: false` to keep host-page visitor analytics off: no pageview
   * beacons and no new device id, for example until the visitor accepts
   * analytics cookies. Turn it on later with `Quackback.tracking(true)`, or
   * withdraw with `Quackback.tracking(false)`, which also removes a stored
   * device id. Omitting the option keeps the host's last choice. Tracking runs
   * only when the instance also enables visitor analytics.
   */
  tracking?: boolean
  /**
   * Set `whatsNew: false` to keep the "What's new" card above the launcher
   * off on this page, for example on a checkout page, whatever the workspace
   * setting. The unread badge is unchanged. Switch it at runtime with
   * `Quackback.whatsNew(true | false)`. On by default; omitting the option
   * keeps the last choice, so a `whatsNew` call made before `init` holds.
   */
  whatsNew?: boolean
}

/**
 * What the host app passes to identify the current user.
 *
 * For anonymous sessions, call `identify()` with no argument — don't pass
 * `{ anonymous: true }`. (The runtime still accepts `{ anonymous: true }` for
 * backwards-compat with older integrations, but it's not in the type so
 * TypeScript users get nudged to the cleaner form.)
 */
export type Identity =
  | { ssoToken: string }
  /**
   * @deprecated The server rejects unsigned identities with `VALIDATION_ERROR`.
   * Sign a short-lived HS256 token on your server and pass `{ ssoToken }`.
   */
  | ({ id: string; email: string; name?: string; avatarURL?: string } & Record<string, unknown>)

/**
 * Arguments to `Quackback.open(...)`. Discriminated on the target:
 * - omit the payload or `{ view: 'home' }` to open the home view
 * - `{ view: 'feedback' }` opens the feedback list, when it is enabled
 * - `{ view: 'new-post', title?, body?, board? }` pre-fills the new-post form
 * - `{ view: 'changelog', entryId? }` opens the changelog, optionally to one entry
 * - `{ view: 'help', query? }` opens help, optionally with search prefilled
 * - `{ view: 'chat' }` opens the live chat view
 * - `{ view: 'messages' }` opens the messenger conversations view, when it is enabled
 * - `{ view: 'tickets' }` opens the visitor's tickets list, or messages when that is unavailable
 * - `{ postId }` deep-links to a specific post
 * - `{ articleId }` deep-links to a help article (`article_…` TypeID or slug;
 *   stored `kb_article_…` ids also resolve)
 *
 * `postId` and `articleId` win over `view` when both are set. `board` applies
 * only to `new-post` — Home filtering uses `init({ defaultBoard })` or `?board=`.
 *
 * The iframe handles every field on this type. A target whose surface is
 * disabled (or a board the visitor cannot see) fails closed — the panel
 * still opens, but the widget does not invent access.
 */
export type OpenOptions =
  | undefined
  | { view?: 'home' }
  | { view: 'feedback' }
  | { view: 'new-post'; title?: string; body?: string; board?: string }
  | { view: 'changelog'; entryId?: string }
  | { view: 'help'; query?: string }
  | { view: 'chat' }
  | { view: 'messages'; conversationId?: string }
  | { view: 'tickets' }
  | { postId: string }
  | { articleId: string }

export interface WidgetUser {
  id: string
  name: string
  email: string
  avatarUrl?: string | null
}

/**
 * Events emitted by the widget. Subscribers can use `open` and `close` to
 * react to deep-link flows.
 */
export interface EventMap {
  ready: Record<string, never>
  /**
   * The panel opened. The payload reports the view and deep-link the host
   * requested, not the view that is showing: when that surface is turned
   * off, the panel opens without switching to it and the event still names
   * the requested view.
   */
  open: {
    view?: 'home' | 'feedback' | 'new-post' | 'changelog' | 'help' | 'chat' | 'messages' | 'tickets'
    postId?: string
    articleId?: string
    entryId?: string
    conversationId?: string
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
  /** Total unread across the visitor's conversations changed. Lets a host page
   *  mirror the count in its own UI (e.g. a nav badge), same value that drives
   *  the launcher badge. */
  unread: {
    count: number
    /** Unread replies across the visitor's conversations. */
    messages: number
    /** Unread changelog entries. */
    changelog: number
    /** Tickets whose stage moved since the visitor last looked. */
    tickets: number
  }
  /** The "What's new" card appeared above the closed launcher for the newest
   *  unread changelog entry it may announce. Fires once per entry for each
   *  visitor: the host page remembers which entries it announced, per
   *  instance. `count` is the number of unread entries the card announces.
   *  Does not fire on a page with the card turned off, or for entries that
   *  were already unread the first time a visitor loads the widget on a
   *  device. */
  'whats-new': { count: number; entryId: string }
  /** A new unread reply from a teammate or the AI assistant, in any of the
   *  visitor's conversations. Fires once per reply for each visitor,
   *  whichever way the workspace shows replies (including the badge only),
   *  for the 20 newest unread replies at each check: the host page remembers
   *  which replies it reported, per instance. Replies already unread the
   *  first time a visitor loads the widget on a device are not reported. */
  message: {
    conversationId: string
    author: { name: string; avatarUrl: string | null }
    /** The reply as plain text. */
    preview: string
  }
}

export type EventName = keyof EventMap
export type EventHandler<T extends EventName> = (payload: EventMap[T]) => void
export type Unsubscribe = () => void
