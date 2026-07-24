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
import { createLauncher, type LauncherHandle } from './launcher'
import { createPanel, type PanelHandle } from './panel'
import { fetchServerConfig, type ServerConfig } from './config'
import { createTracker, type Tracker } from './tracker'
import { getOrCreateDeviceId } from './device'
import { removeStyles } from './style'

type Command =
  | 'init'
  | 'identify'
  | 'logout'
  | 'open'
  | 'close'
  | 'showLauncher'
  | 'hideLauncher'
  | 'destroy'
  | 'metadata'
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
  let mobileMql: MediaQueryList | null = null
  let mobileCleanup: (() => void) | null = null
  let tracker: Tracker | null = null
  let pendingDevice: string | null = null
  const emitter = createEmitter()

  function sendMobileState(): void {
    if (ready && bridge) bridge.send('quackback:mobile', !!mobileMql?.matches)
  }

  function iframeOrigin(): string {
    return new URL(config!.instanceUrl).origin
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
        if (pendingOpen) {
          bridge!.send('quackback:open', pendingOpen)
          pendingOpen = null
        }
        sendMobileState()
        emitter.emit('ready', {})
        break
      case 'quackback:close':
        dispatch('close')
        break
      case 'quackback:unread': {
        // Total unread from the iframe → the launcher badge (shown only while
        // closed). Coerced defensively; a bad payload clears the badge.
        const count = typeof msg.count === 'number' ? msg.count : 0
        launcher?.setUnread(count)
        // Also surface it to host SDK subscribers (Quackback.on('unread', ...))
        // so a host can mirror the count in its own UI.
        emitter.emit('unread', { count })
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
        currentUser = m.user ?? null
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
        currentUser = m.user ?? null
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
      placement: config!.placement ?? 'right',
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
    mobileMql = window.matchMedia('(max-width: 639px)')
    mobileMql.addEventListener('change', sendMobileState)
    mobileCleanup = () => mobileMql!.removeEventListener('change', sendMobileState)
    return panel
  }

  function sendIdentity(data: unknown) {
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
  function revealLauncherOnce(): () => void {
    let revealed = false
    return () => {
      if (revealed) return
      revealed = true
      launcher?.reveal()
    }
  }

  /** Theme + greeting + analytics from a resolved server config. `initToken`
   *  guards the tracker against a stale async apply after a re-init. */
  function applyServerConfig(serverConfig: ServerConfig, initToken: InitOptions): void {
    applyServerTheme(serverConfig)
    launcher?.setGreeting(serverConfig.launcherGreeting)
    // Host-page pageview tracking is instance-controlled: it starts only when
    // the server config enables visitor analytics, and only if this init is
    // still the live one. The durable device id is a separate opt-in on top.
    if (serverConfig.visitorAnalytics && config === initToken) {
      tracker?.stop()
      const deviceId = serverConfig.visitorDeviceTracking ? getOrCreateDeviceId() : null
      tracker = createTracker(initToken.instanceUrl, deviceId)
      tracker.start()
      // The iframe links the device to the session's principal; queue
      // until the panel reports ready if it hasn't yet.
      if (deviceId) {
        if (ready && bridge) bridge.send('quackback:device', deviceId)
        else pendingDevice = deviceId
      }
    }
  }

  function createLauncherIfNeeded(): void {
    if (launcher || !config || config.launcher === false) return
    launcher = createLauncher({
      placement: config.placement ?? 'right',
      onClick: () => {
        if (panelOpen) dispatch('close')
        else dispatch('open')
      },
    })
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
        const reveal = revealLauncherOnce()
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
        panel?.hide()
        launcher?.setOpen(false)
        panelOpen = false
        currentUser = null
        if (ready && bridge) bridge.send('quackback:identify', null as unknown as undefined)
        else {
          pendingIdentify = null
          pendingIdentifyPresent = true
        }
        return
      case 'open': {
        if (!config) return // open before init is a no-op, matching close/hide
        const opts = (a as OpenOptions) ?? {}
        if (ready && bridge) bridge.send('quackback:open', opts)
        else pendingOpen = opts
        // The idle preload may not have fired yet — create the panel now.
        ensurePanel().show()
        launcher?.setOpen(true)
        panelOpen = true
        const ctx = opts as {
          view?: 'home' | 'new-post' | 'changelog' | 'help'
          postId?: string
          articleId?: string
          entryId?: string
        }
        emitter.emit('open', {
          view: ctx.view,
          postId: ctx.postId,
          articleId: ctx.articleId,
          entryId: ctx.entryId,
        })
        return
      }
      case 'close':
        panel?.hide()
        launcher?.setOpen(false)
        panelOpen = false
        emitter.emit('close', {})
        return
      case 'showLauncher':
        if (!launcher) createLauncherIfNeeded()
        else launcher.el.style.display = 'flex'
        return
      case 'hideLauncher':
        if (launcher) launcher.el.style.display = 'none'
        return
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
      case 'destroy':
        cancelPanelPreload()
        panel?.destroy()
        launcher?.remove()
        bridge?.dispose()
        tracker?.stop()
        tracker = null
        pendingDevice = null
        mobileCleanup?.()
        mobileCleanup = null
        mobileMql = null
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
