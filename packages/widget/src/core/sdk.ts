import type {
  InitOptions,
  Identity,
  OpenOptions,
  WidgetUser,
  EventName,
  EventHandler,
} from '../types'
import { createEmitter } from './events'
import { createBridge, type Bridge } from './postmessage'
import { measureSafeArea, NO_SAFE_AREA } from './safe-area'
import { createLauncher, type LauncherHandle } from './launcher'
import { createPanel, PANEL_CLOSE_MS, type PanelHandle } from './panel'
import { fetchServerConfig, type ServerConfig } from './config'
import { createTracker, type Tracker } from './tracker'
import { clearDeviceId, getOrCreateDeviceId } from './device'
import { FULL_SCREEN_MEDIA, removeStyles } from './style'
import { fitToVisualViewport, keyboardShown } from './viewport'
import { canRestoreFocus, openerWantsFocusMoved } from './focus'
import { parseWhatsNew, type WhatsNew } from './whats-new-card'
import { createWhatsNewMemory, type WhatsNewMemory } from './whats-new-memory'
import { createReplyPreviewCard, parseReplyPreview, type ReplyPreview } from './reply-preview-card'
import {
  createReplyPreviewMemory,
  replyPreviewKeyPrefix,
  type ReplyPreviewMemory,
} from './reply-preview-memory'
import { createTitleAlert, type TitleAlert } from './title-alert'

type Command =
  | 'isOpen'
  | 'getUser'
  | 'isIdentified'
  | 'init'
  | 'identify'
  | 'logout'
  | 'open'
  | 'close'
  | 'showLauncher'
  | 'hideLauncher'
  | 'destroy'
  | 'metadata'
  | 'tracking'
  | 'whatsNew'
  | 'on'
  | 'off'

export interface SDK {
  dispatch(command: Command, arg1?: unknown, arg2?: unknown): unknown
  isOpen(): boolean
  getUser(): WidgetUser | null
  isIdentified(): boolean
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

export function createSDK(): SDK {
  let config: InitOptions | null = null
  let launcher: LauncherHandle | null = null
  let panel: PanelHandle | null = null
  let bridge: Bridge | null = null
  let ready = false
  let metadata: Record<string, string> | null = null
  // `pendingIdentify` can be an Identity, `{anonymous: true}`, or `null` (logout).
  // `pendingIdentifyPresent` distinguishes "nothing queued" from "logout queued".
  let pendingIdentify: unknown = null
  let pendingIdentifyPresent = false
  let pendingOpen: OpenOptions | null = null
  let panelOpen = false
  let currentUser: WidgetUser | null = null
  // Effective launcher/panel corner: the init `placement` until the server
  // config's `position` (the workspace's widget setting) overrides it.
  let placement: 'left' | 'right' = 'right'
  let mobileMql: MediaQueryList | null = null
  let mobileCleanup: (() => void) | null = null
  // Set while the panel is open: undoes its fit to the visual viewport.
  let detachViewport: (() => void) | null = null
  // A fit to the visual viewport kept while the phone panel slides out.
  let pendingDetach: { detach: () => void; timer: number } | null = null
  // What had focus when the panel opened, for close to give it back.
  let returnFocus: HTMLElement | null = null
  // Set while the launcher's own click opens the panel.
  let openingFromLauncher = false
  // The server config of the live init, kept for a launcher created later by
  // showLauncher, and whether the launcher has been revealed yet.
  let serverConfig: ServerConfig | null = null
  let launcherRevealed = false
  let unreadCount = 0
  // The frame's newest unread changelog entry, for the launcher's card.
  let whatsNew: WhatsNew | null = null
  // Whether the frame has sent the card for the current visitor yet.
  let whatsNewPayloadReceived = false
  // The host page's say on the card for this page (init's whatsNew option,
  // or the whatsNew command): off hides it without touching the badge. Kept
  // across a re-init or destroy, like the host's tracking choice.
  let hostWhatsNew = true
  // The frame's newest unread replies, and the tab title flash for them.
  let replyPreview: ReplyPreview | null = null
  let titleAlert: TitleAlert | null = null
  // The newest reply the visitor has had the page visible for: the title
  // flashes only for a newer one.
  let titleSeenId: string | null = null
  // Whether the frame has sent replies for the current visitor yet.
  let replyPayloadReceived = false
  function onVisibility(): void {
    if (document.visibilityState === 'visible' && replyPreview) applyReplyPreview()
  }
  let tracker: Tracker | null = null
  // The host page's say on pageview tracking (for example its consent
  // banner). Tracking runs only when both the host and the instance allow it.
  let hostTracking = true
  let analyticsConfig: { instanceUrl: string; deviceTracking: boolean } | null = null
  let pendingDevice: string | null = null
  const emitter = createEmitter()

  function sendMobileState(): void {
    if (ready && bridge) bridge.send('quackback:mobile', !!mobileMql?.matches)
    sendSafeArea()
  }

  // Where the panel fills the screen (FULL_SCREEN_MEDIA), its edges meet the
  // host page's notch, cutouts and system bars. The frame cannot read those
  // insets itself; send them while the panel is open, and again whenever
  // they change (a rotation). Measuring forces a layout, so a closed panel
  // skips it. The floating panel never touches the screen edge (its CSS
  // offsets already move it in by the insets), so the frame gets zeros.
  // While the on-screen keyboard is up it covers the home indicator, so a
  // bottom inset would only leave a gap above the keyboard.
  let lastSafeArea = ''
  function sendSafeArea(): void {
    if (!ready || !bridge || !panelOpen) return
    let insets = mobileMql?.matches ? measureSafeArea() : NO_SAFE_AREA
    if (insets.bottom && keyboardShown()) insets = { ...insets, bottom: 0 }
    const key = `${insets.top}:${insets.bottom}:${insets.left}:${insets.right}`
    if (key === lastSafeArea) return
    lastSafeArea = key
    bridge.send('quackback:safe-area', insets)
  }

  // Closing only hides the panel, so the frame and any open conversation stay
  // live. Tell the frame whether it is shown, so a reply that arrives while
  // the panel is closed stays unread until the visitor opens it again.
  function sendShownState(): void {
    if (ready && bridge) bridge.send('quackback:shown', panelOpen)
  }

  // A resize arrives in bursts (a rotation, a toolbar sliding away, the
  // keyboard opening): measure
  // at most once per frame, and only while the panel is open.
  let safeAreaFrame = 0
  function scheduleSafeArea(): void {
    if (!panelOpen || safeAreaFrame) return
    safeAreaFrame = requestAnimationFrame(() => {
      safeAreaFrame = 0
      sendSafeArea()
    })
  }
  function cancelSafeArea(): void {
    if (safeAreaFrame) cancelAnimationFrame(safeAreaFrame)
    safeAreaFrame = 0
  }

  /** Undo the panel's fit to the visual viewport. On close the panel keeps
   *  its size until it has slid out, unless motion is reduced; `now` skips
   *  the wait. */
  function releaseViewport(now = false): void {
    if (pendingDetach) {
      window.clearTimeout(pendingDetach.timer)
      pendingDetach.detach()
      pendingDetach = null
    }
    const detach = detachViewport
    detachViewport = null
    if (!detach) return
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (now || reduceMotion) return detach()
    const timer = window.setTimeout(() => {
      pendingDetach = null
      detach()
    }, PANEL_CLOSE_MS)
    pendingDetach = { detach, timer }
  }

  function iframeOrigin(): string {
    return new URL(config!.instanceUrl).origin
  }

  // A dismissed (or opened) card stays away until a newer entry is
  // published, and the whats-new event fires once per entry. The host page
  // remembers both per instance and per visitor: an identified user has
  // their own memory, anonymous visitors share one. Read state is the
  // frame's alone, so the launcher badge is untouched.
  let whatsNewMemory: WhatsNewMemory | null = null
  // A new identity sent to the frame and not yet resolved: the card waits, so
  // it never shows (or announces) under the wrong visitor's memory. The same
  // identity sent again (a page change in a single-page app) does not wait.
  let identityPending = false
  let sentIdentityKey: string | null = null
  let resolvedIdentityKey: string | null = null
  function memory(): WhatsNewMemory {
    return (whatsNewMemory ??= createWhatsNewMemory(iframeOrigin()))
  }
  function visitorScope(): string {
    return currentUser?.id ? `user:${currentUser.id}` : 'anon'
  }
  /** The visitor changed: the card the frame worked out for the previous
   *  session is dropped until the frame sends one for this session. */
  function setVisitor(user: WidgetUser | null): void {
    const before = visitorScope()
    currentUser = user
    if (visitorScope() !== before) {
      whatsNew = null
      whatsNewPayloadReceived = false
      replyPreview = null
      replyPayloadReceived = false
    }
    applyWhatsNew()
    applyReplyPreview()
  }
  // A dismiss or open in another tab of the host page hides the card here.
  function onWhatsNewStorage(e: StorageEvent): void {
    if (!config) return
    if (e.key === null || e.key.startsWith(`quackback:whats-new:${iframeOrigin()}:`)) {
      applyWhatsNew()
    }
    if (e.key === null || e.key.startsWith(replyPreviewKeyPrefix(iframeOrigin()))) {
      applyReplyPreview()
    }
  }

  // A dismissed (or opened) reply preview stays away until a newer reply
  // arrives, and the message event fires once per reply. Remembered per
  // instance and per visitor, like the What's new card.
  let replyMemory: ReplyPreviewMemory | null = null
  function replies(): ReplyPreviewMemory {
    return (replyMemory ??= createReplyPreviewMemory(iframeOrigin()))
  }
  function answerReplyPreview(data: ReplyPreview | null): void {
    if (data)
      replies().answer(
        visitorScope(),
        data.messages.map((m) => m.id)
      )
  }
  /** The message event, the card and the tab title, from the frame's latest
   *  payload. The event fires whatever the card setting; the card shows only
   *  when the payload asks for it. All wait while a new identity resolves. */
  function applyReplyPreview(): void {
    if (!config) return
    const data = identityPending ? null : replyPreview
    // Every new reply, in any conversation; an older frame sends only the
    // card's replies.
    const reported = !data
      ? []
      : data.recent.length
        ? data.recent
        : data.messages.map((m) => ({
            id: m.id,
            conversationId: data.conversationId,
            author: { name: data.author.name, avatarUrl: data.author.avatarUrl },
            text: m.text,
          }))
    // The first payload for a visitor new to this device records what is
    // already unread without reporting it: the event covers replies that
    // arrive while the page is open, or since the last visit here.
    if (!identityPending && replyPayloadReceived && !replies().known(visitorScope())) {
      replies().learn(
        visitorScope(),
        reported.map((m) => m.id)
      )
    } else if (data) {
      for (const m of reported) {
        if (!replies().announce(visitorScope(), m.id)) continue
        emitter.emit('message', {
          conversationId: m.conversationId,
          author: { name: m.author.name || data.teamName, avatarUrl: m.author.avatarUrl },
          preview: m.text,
        })
      }
    }
    // The newest reply: the card's, or the newest reported one.
    const newest = data?.messages[data.messages.length - 1] ?? reported[reported.length - 1]
    const unanswered = !!newest && !replies().isAnswered(visitorScope(), newest.id)
    launcher?.setReplyPreview(data?.card && unanswered ? data : null)
    // A visible page has shown the newest reply: no flash for it later.
    if (newest && document.visibilityState === 'visible') titleSeenId = newest.id
    const title = unanswered && newest.id !== titleSeenId ? (data?.title ?? null) : null
    if (title !== null || titleAlert) {
      titleAlert ??= createTitleAlert()
      titleAlert.set(title)
    }
  }
  function answerWhatsNew(entryId: string): void {
    if (whatsNew?.entry.id === entryId) memory().answer(visitorScope(), whatsNew.entry)
  }
  function applyWhatsNew(): void {
    if (!config) return
    // The first payload for a visitor new to this device records what is
    // already unread as announced and answered, without showing it: the card
    // covers entries published after the first visit here.
    if (!identityPending && whatsNewPayloadReceived && !memory().known(visitorScope())) {
      memory().learn(visitorScope(), whatsNew?.entry ?? null)
    }
    if (!launcher) return
    const show =
      whatsNew &&
      hostWhatsNew &&
      !identityPending &&
      !memory().isAnswered(visitorScope(), whatsNew.entry)
        ? whatsNew
        : null
    launcher.setWhatsNew(show)
  }

  function onIframeMessage(msg: { type: string; [k: string]: unknown }) {
    switch (msg.type) {
      case 'quackback:ready':
        ready = true
        if (pendingIdentifyPresent) {
          bridge!.send('quackback:identify', pendingIdentify)
          pendingIdentifyPresent = false
          pendingIdentify = null
        }
        if (config?.locale) bridge!.send('quackback:locale', config.locale)
        if (metadata) bridge!.send('quackback:metadata', metadata)
        if (pendingDevice) {
          bridge!.send('quackback:device', pendingDevice)
          pendingDevice = null
        }
        // A frame that (re)loads starts with no insets: send them (when the
        // panel is open) before a queued open, so its view renders with them.
        lastSafeArea = ''
        sendMobileState()
        if (pendingOpen) {
          bridge!.send('quackback:open', pendingOpen)
          pendingOpen = null
        }
        // Say the panel is shown only after the queued open has navigated.
        sendShownState()
        emitter.emit('ready', {})
        break
      case 'quackback:close':
        dispatch('close')
        break
      case 'quackback:unread': {
        // Total unread from the iframe → the launcher badge (shown only while
        // closed). Coerced defensively; a bad payload clears the badge.
        const num = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.floor(v) : 0)
        const count = typeof msg.count === 'number' ? msg.count : 0
        unreadCount = count
        launcher?.setUnread(count)
        // Also surface it to host SDK subscribers (Quackback.on('unread', ...))
        // so a host can mirror the count, or its parts, in its own UI.
        emitter.emit('unread', {
          count,
          messages: num(msg.messages),
          changelog: num(msg.changelog),
          tickets: num(msg.tickets),
        })
        break
      }
      case 'quackback:reply-preview': {
        // The newest unread replies, or null; a bad payload clears them.
        replyPreview = parseReplyPreview(
          (msg as { replyPreview?: unknown }).replyPreview,
          iframeOrigin()
        )
        replyPayloadReceived = true
        applyReplyPreview()
        break
      }
      case 'quackback:whats-new': {
        // The newest unread changelog entry, or null; a bad payload clears it.
        whatsNew = parseWhatsNew((msg as { whatsNew?: unknown }).whatsNew)
        whatsNewPayloadReceived = true
        applyWhatsNew()
        break
      }
      case 'quackback:expand': {
        // Long-form content (article/changelog detail) grows the panel.
        const m = msg as { expanded?: boolean }
        panel?.setExpanded(!!m.expanded)
        break
      }
      case 'quackback:identify-result': {
        const m = msg as {
          success?: boolean
          user?: WidgetUser
          error?: string
        }
        identityPending = false
        resolvedIdentityKey = m.success ? sentIdentityKey : null
        setVisitor(m.user ?? null)
        emitter.emit('identify', {
          success: !!m.success,
          user: currentUser,
          anonymous: !!m.success && !m.user,
          error: m.error,
        })
        break
      }
      case 'quackback:auth-change': {
        const m = msg as { user?: WidgetUser }
        setVisitor(m.user ?? null)
        break
      }
      case 'quackback:event': {
        const m = msg as { name?: string; payload?: unknown }
        if (m.name) emitter.emit(m.name as EventName, (m.payload ?? {}) as never)
        break
      }
      case 'quackback:navigate': {
        const m = msg as { url?: string }
        if (m.url && isSafeHttpUrl(m.url)) {
          // noopener: prevent tabnabbing via window.opener on the new tab.
          // noreferrer: avoid leaking the host page URL to third parties.
          window.open(m.url, '_blank', 'noopener,noreferrer')
        }
        break
      }
    }
  }

  // Pending idle-time panel preload (see the init case). Cancelled on
  // destroy and made moot by an early open(), which creates the panel itself.
  let panelPreload: { kind: 'idle' | 'timeout'; id: number } | null = null

  function schedulePanelPreload(): void {
    if (panel || panelPreload) return
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }
    const run = () => {
      panelPreload = null
      if (config && !panel) ensurePanel()
    }
    if (typeof w.requestIdleCallback === 'function') {
      panelPreload = { kind: 'idle', id: w.requestIdleCallback(run, { timeout: 2500 }) }
    } else {
      // No requestIdleCallback (Safari): a short beat past the current task
      // keeps the iframe from racing the host page's own startup work.
      panelPreload = { kind: 'timeout', id: window.setTimeout(run, 200) }
    }
  }

  function cancelPanelPreload(): void {
    if (!panelPreload) return
    const w = window as Window & { cancelIdleCallback?: (id: number) => void }
    if (panelPreload.kind === 'idle' && typeof w.cancelIdleCallback === 'function') {
      w.cancelIdleCallback(panelPreload.id)
    } else if (panelPreload.kind === 'timeout') {
      window.clearTimeout(panelPreload.id)
    }
    panelPreload = null
  }

  function ensurePanel(): PanelHandle {
    if (panel) return panel
    panel = createPanel({
      widgetUrl: `${config!.instanceUrl}/widget`,
      placement,
      defaultBoard: config!.defaultBoard,
      showCloseButton: config!.launcher === false,
      locale: config!.locale,
      onBackdropClick: () => dispatch('close'),
    })
    bridge = createBridge({
      getIframe: () => panel!.iframe,
      origin: iframeOrigin(),
    })
    bridge.onMessage(onIframeMessage)
    // The launcher names the panel it controls once there is one.
    launcher?.el.setAttribute('aria-controls', panel.el.id)
    mobileMql = window.matchMedia(FULL_SCREEN_MEDIA)
    mobileMql.addEventListener('change', sendMobileState)
    window.addEventListener('resize', scheduleSafeArea)
    // The keyboard resizes only the visual viewport.
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', scheduleSafeArea)
    mobileCleanup = () => {
      mobileMql!.removeEventListener('change', sendMobileState)
      window.removeEventListener('resize', scheduleSafeArea)
      viewport?.removeEventListener('resize', scheduleSafeArea)
      cancelSafeArea()
    }
    return panel
  }

  function sendIdentity(data: unknown) {
    const signedIn = !!data && typeof data === 'object' && !('anonymous' in data)
    sentIdentityKey = signedIn ? JSON.stringify(data) : null
    const pending = signedIn && sentIdentityKey !== resolvedIdentityKey
    if (pending !== identityPending) {
      identityPending = pending
      applyWhatsNew()
      applyReplyPreview()
    }
    if (ready && bridge) bridge.send('quackback:identify', data)
    else {
      pendingIdentify = data
      pendingIdentifyPresent = true
    }
  }

  function applyServerTheme(serverCfg: ServerConfig) {
    if (!launcher || !serverCfg.theme) return
    const t = serverCfg.theme
    const themeMode = t.themeMode ?? 'user'
    const prefersDark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    const dark = themeMode === 'dark' || (themeMode === 'user' && prefersDark)
    const backgroundColor = dark ? (t.darkPrimary ?? t.lightPrimary) : t.lightPrimary
    const foregroundColor = dark
      ? (t.darkPrimaryForeground ?? t.lightPrimaryForeground)
      : t.lightPrimaryForeground
    launcher.setColors({ backgroundColor, foregroundColor })
  }

  // Reveal the launcher only after brand colors are set (or via the fallback
  // if the config fetch is slow/fails), so users never see the default color
  // flash before the brand color lands.
  const LAUNCHER_REVEAL_FALLBACK_MS = 1800
  function revealLauncher(): void {
    launcherRevealed = true
    launcher?.reveal()
  }

  /** Theme, greeting and label: the parts of the server config the launcher
   *  itself shows. */
  function applyLauncherConfig(cfg: ServerConfig): void {
    applyServerTheme(cfg)
    launcher?.setGreeting(cfg.launcherGreeting)
    launcher?.setLabel(cfg.launcherLabel)
  }

  /** Theme + greeting + launcher chrome + analytics from a resolved server
   *  config. `initToken` drops a stale async apply after
   *  a re-init. */
  function applyServerConfig(cfg: ServerConfig, initToken: InitOptions): void {
    // A config fetched for an init that has since been replaced is stale.
    if (config !== initToken) return
    serverConfig = cfg
    applyLauncherConfig(cfg)
    if (cfg.position) {
      placement = cfg.position
      launcher?.setPlacement(placement)
      panel?.setPlacement(placement)
    }
    // Host-page pageview tracking is instance-controlled: it starts only when
    // the server config enables visitor analytics, and only if this init is
    // still the live one. The durable device id is a separate opt-in on top.
    if (cfg.visitorAnalytics) {
      analyticsConfig = {
        instanceUrl: initToken.instanceUrl,
        deviceTracking: cfg.visitorDeviceTracking === true,
      }
      startTracking()
    }
  }

  function startTracking(): void {
    // A running tracker is left alone: restarting it would count the current
    // page again.
    if (!hostTracking || !analyticsConfig || tracker) return
    const deviceId = analyticsConfig.deviceTracking ? getOrCreateDeviceId() : null
    tracker = createTracker(analyticsConfig.instanceUrl, deviceId)
    tracker.start()
    // The iframe links the device to the session's principal; queue
    // until the panel reports ready if it hasn't yet.
    if (deviceId) {
      if (ready && bridge) bridge.send('quackback:device', deviceId)
      else pendingDevice = deviceId
    }
  }

  function stopTracking(): void {
    tracker?.stop()
    tracker = null
    pendingDevice = null
  }

  function createLauncherIfNeeded(force = false): void {
    if (launcher || !config || (config.launcher === false && !force)) return
    launcher = createLauncher({
      placement,
      locale: config.locale,
      onClick: () => {
        if (panelOpen) {
          dispatch('close')
          return
        }
        openingFromLauncher = true
        try {
          dispatch('open')
        } finally {
          openingFromLauncher = false
        }
      },
      onWhatsNewOpen: (entryId) => {
        // Opening the entry answers the card, as a dismiss does.
        answerWhatsNew(entryId)
        dispatch('open', { view: 'changelog', entryId })
        applyWhatsNew()
      },
      onWhatsNewDismiss: (entryId) => {
        answerWhatsNew(entryId)
        applyWhatsNew()
      },
      onWhatsNewShown: (data) => {
        if (memory().announce(visitorScope(), data.entry.id)) {
          emitter.emit('whats-new', { count: data.count, entryId: data.entry.id })
        }
      },
      replyCard: createReplyPreviewCard,
      onReplyOpen: (conversationId) => {
        // Opening the conversation answers the card, as a dismiss does, and
        // the visitor lands in its message box.
        answerReplyPreview(replyPreview)
        openingFromLauncher = true
        try {
          dispatch('open', { view: 'messages', conversationId })
        } finally {
          openingFromLauncher = false
        }
        applyReplyPreview()
      },
      onReplyDismiss: (data) => {
        // Hidden until a newer reply; the badge stays, as nothing is read.
        answerReplyPreview(data)
        applyReplyPreview()
      },
    })
    // A launcher created after init (showLauncher) catches up with the
    // server config, unread count, panel state and reveal it missed.
    if (serverConfig) applyLauncherConfig(serverConfig)
    if (unreadCount) launcher.setUnread(unreadCount)
    applyWhatsNew()
    applyReplyPreview()
    if (panelOpen) launcher.setOpen(true)
    if (launcherRevealed) launcher.reveal()
    if (panel) launcher.el.setAttribute('aria-controls', panel.el.id)
  }

  function dispatch(cmd: Command, a?: unknown, b?: unknown): unknown {
    switch (cmd) {
      case 'init': {
        const next = { ...(a as InitOptions) }
        if (!next.instanceUrl) throw new Error('Quackback: init requires { instanceUrl }')
        if (!isSafeHttpUrl(next.instanceUrl))
          throw new Error('Quackback: instanceUrl must be an http(s) URL')
        // Validate before destroy so a bad re-init leaves the working instance intact.
        if (config) dispatch('destroy')
        config = next
        // Only an explicit option changes the host's choice, so a withdrawal
        // made before init, or before a re-init, is never silently undone.
        if (next.tracking !== undefined) hostTracking = next.tracking
        // The same for the card: only an explicit option changes the page's
        // choice, so a whatsNew call made before init holds.
        if (typeof next.whatsNew === 'boolean') hostWhatsNew = next.whatsNew
        placement = next.placement ?? 'right'
        window.addEventListener('storage', onWhatsNewStorage)
        document.addEventListener('visibilitychange', onVisibility)
        createLauncherIfNeeded()
        // Preload the hidden panel iframe off the host page's critical path:
        // init typically runs while the host is still loading, and the iframe
        // immediately competes for its bandwidth. An open() before the idle
        // slot fires still creates the panel on the spot.
        schedulePanelPreload()
        const initialIdentity: Identity | { anonymous: true } = config.identity ?? {
          anonymous: true,
        }
        sendIdentity(initialIdentity)
        // Only the live init reveals; a slow fetch from a replaced one does not.
        const reveal = () => {
          if (config === next) revealLauncher()
        }
        // Script-tag installs get the server config baked into sdk.js, so the
        // launcher paints in brand colors and reveals with zero network round
        // trips. npm installs fall back to the config fetch.
        const baked =
          typeof window !== 'undefined'
            ? (window as { __QUACKBACK_CONFIG__?: ServerConfig }).__QUACKBACK_CONFIG__
            : undefined
        if (baked) {
          applyServerConfig(baked, next)
          reveal()
        } else {
          const fallback = window.setTimeout(reveal, LAUNCHER_REVEAL_FALLBACK_MS)
          void fetchServerConfig(config.instanceUrl)
            .then((serverConfig) => applyServerConfig(serverConfig, next))
            .finally(() => {
              window.clearTimeout(fallback)
              reveal()
            })
        }
        return
      }
      case 'identify':
        sendIdentity((a as Identity | undefined) ?? { anonymous: true })
        return
      case 'logout':
        if (panelOpen) dispatch('close')
        identityPending = false
        sentIdentityKey = null
        resolvedIdentityKey = null
        setVisitor(null)
        if (ready && bridge) bridge.send('quackback:identify', null as unknown as undefined)
        else {
          pendingIdentify = null
          pendingIdentifyPresent = true
        }
        return
      case 'open': {
        if (!config) return // open before init is a no-op, matching close/hide
        const opts = (a as OpenOptions) ?? {}
        // The idle preload may not have fired yet — create the panel now.
        const opened = ensurePanel()
        const active = document.activeElement
        const moveFocus = openingFromLauncher || openerWantsFocusMoved(active)
        // Where focus goes back to on close: the host's own button, a field,
        // or the launcher. An open while already open keeps the first one.
        if (!panelOpen) {
          returnFocus =
            active instanceof HTMLElement && active !== opened.iframe && active !== document.body
              ? active
              : null
        }
        panelOpen = true
        // Opened again while sliding out: keep the fit it still has.
        if (pendingDetach) {
          window.clearTimeout(pendingDetach.timer)
          detachViewport ??= pendingDetach.detach
          pendingDetach = null
        }
        // The insets reach the frame before the view it opens and before the
        // panel shows.
        sendSafeArea()
        // Navigate first, then say the panel is shown: a view the closed panel
        // was left on must not count as seen on its way out.
        if (ready && bridge) bridge.send('quackback:open', opts)
        else pendingOpen = opts
        sendShownState()
        opened.show()
        launcher?.setOpen(true)
        detachViewport ??= fitToVisualViewport(opened.el, mobileMql!)
        // Keyboard and screen-reader users who asked for the panel land in
        // it, unless it closed again before the frame. An open the host page
        // triggers while the visitor types elsewhere leaves their focus alone.
        if (moveFocus) {
          requestAnimationFrame(() => {
            if (panelOpen && panel === opened) opened.iframe.focus()
          })
        }
        const ctx = opts as {
          view?: 'home' | 'new-post' | 'changelog' | 'help' | 'chat' | 'messages' | 'tickets'
          postId?: string
          articleId?: string
          entryId?: string
          conversationId?: string
        }
        emitter.emit('open', {
          view: ctx.view,
          postId: ctx.postId,
          articleId: ctx.articleId,
          entryId: ctx.entryId,
          conversationId: ctx.conversationId,
        })
        return
      }
      case 'close': {
        // Focus inside the panel goes back to what had it before the panel
        // opened, or to the launcher when that is gone or hidden.
        const focusWasInside = !!panel && document.activeElement === panel.iframe
        const focusTarget = canRestoreFocus(returnFocus)
          ? returnFocus
          : launcher && canRestoreFocus(launcher.el)
            ? launcher.el
            : null
        returnFocus = null
        panel?.hide()
        launcher?.setOpen(false)
        panelOpen = false
        sendShownState()
        cancelSafeArea()
        releaseViewport()
        if (focusWasInside) focusTarget?.focus()
        emitter.emit('close', {})
        return
      }
      case 'showLauncher':
        // An explicit show wins over an init-time launcher: false.
        if (!launcher) createLauncherIfNeeded(true)
        else launcher.setVisible(true)
        return
      case 'hideLauncher':
        launcher?.setVisible(false)
        return
      case 'isOpen':
        return panelOpen
      case 'getUser':
        return currentUser
      case 'isIdentified':
        return currentUser !== null
      case 'on':
        return emitter.on(a as EventName, b as EventHandler<EventName>)
      case 'off':
        emitter.off(a as EventName, b as EventHandler<EventName> | undefined)
        return
      case 'metadata': {
        const patch = a as Record<string, string | null>
        metadata = metadata ?? {}
        for (const k of Object.keys(patch)) {
          const v = patch[k]
          if (v === null) delete metadata[k]
          else metadata[k] = String(v)
        }
        if (ready && bridge) bridge.send('quackback:metadata', metadata)
        return
      }
      case 'tracking':
        hostTracking = a === true
        if (hostTracking) startTracking()
        else {
          // Withdrawn consent also removes the stored device id.
          stopTracking()
          clearDeviceId()
          // The panel keeps the id it was given for linking sessions to the
          // device; a null tells it to drop it.
          if (ready && bridge) bridge.send('quackback:device', null)
        }
        return
      case 'whatsNew':
        // Only a boolean changes it, as with the init option.
        if (typeof a === 'boolean') hostWhatsNew = a
        applyWhatsNew()
        return
      case 'destroy':
        cancelPanelPreload()
        releaseViewport(true)
        returnFocus = null
        panel?.destroy()
        launcher?.remove()
        bridge?.dispose()
        stopTracking()
        analyticsConfig = null
        mobileCleanup?.()
        mobileCleanup = null
        mobileMql = null
        lastSafeArea = ''
        removeStyles()
        panel = null
        launcher = null
        bridge = null
        ready = false
        metadata = null
        pendingIdentify = null
        pendingIdentifyPresent = false
        pendingOpen = null
        panelOpen = false
        currentUser = null
        serverConfig = null
        launcherRevealed = false
        unreadCount = 0
        whatsNew = null
        whatsNewPayloadReceived = false
        whatsNewMemory = null
        replyPreview = null
        replyMemory = null
        titleAlert?.destroy()
        titleAlert = null
        identityPending = false
        sentIdentityKey = null
        resolvedIdentityKey = null
        window.removeEventListener('storage', onWhatsNewStorage)
        document.removeEventListener('visibilitychange', onVisibility)
        titleSeenId = null
        replyPayloadReceived = false
        placement = 'right'
        config = null
        return
    }
  }

  return {
    dispatch,
    isOpen: () => panelOpen,
    getUser: () => currentUser,
    isIdentified: () => currentUser !== null,
  }
}
