/**
 * Host-page pageview tracker (visitor analytics).
 *
 * Runs in the embedding site's context: reports the host page's URL to the
 * instance's /api/track beacon on load and on SPA navigations (History API
 * patch + popstate/hashchange), deduped on the href actually changing so
 * frameworks that call replaceState repeatedly (scroll restoration and the
 * like) count a page once. Enabled only when the instance's server config
 * says so; honors DNT/GPC; never throws into the host page.
 */

export interface Tracker {
  start(): void
  stop(): void
}

export function createTracker(instanceUrl: string): Tracker {
  let active = false
  let lastHref: string | null = null
  let originalPushState: History['pushState'] | null = null
  let originalReplaceState: History['replaceState'] | null = null

  const optedOut = () =>
    navigator.doNotTrack === '1' ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true

  function send(): void {
    if (!active) return
    const href = window.location.href
    if (href === lastHref) return
    lastHref = href
    const body = JSON.stringify({ url: href, referrer: document.referrer, surface: 'widget' })
    try {
      if (!navigator.sendBeacon || !navigator.sendBeacon(`${instanceUrl}/api/track`, body)) {
        void fetch(`${instanceUrl}/api/track`, { method: 'POST', body, keepalive: true }).catch(
          () => {}
        )
      }
    } catch {
      // Analytics must never break the host page.
    }
  }

  return {
    start() {
      if (active || optedOut()) return
      active = true

      const h = window.history
      originalPushState = h.pushState
      originalReplaceState = h.replaceState
      h.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
        originalPushState!.apply(this, args)
        send()
      }
      h.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
        originalReplaceState!.apply(this, args)
        send()
      }
      window.addEventListener('popstate', send)
      window.addEventListener('hashchange', send)

      send()
    },

    stop() {
      if (!active) return
      active = false
      const h = window.history
      if (originalPushState) h.pushState = originalPushState
      if (originalReplaceState) h.replaceState = originalReplaceState
      originalPushState = null
      originalReplaceState = null
      window.removeEventListener('popstate', send)
      window.removeEventListener('hashchange', send)
      lastHref = null
    },
  }
}
