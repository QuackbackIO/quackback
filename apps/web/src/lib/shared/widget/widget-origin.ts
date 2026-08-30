const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((part) => Number(part))
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = octets
  if (a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function isLocalWidgetOrigin(host: string): boolean {
  const hostname = host.toLowerCase().replace(/\.$/, '')
  return (
    LOOPBACK.has(hostname) ||
    isPrivateIpv4(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  )
}

/**
 * Evidence copy for the first observed install host.
 *
 * Origin/Referer is browser-controlled, so this is not a claim that the host
 * is the customer's site. Never turn it into a trusted "open your site" link.
 */
export function widgetOriginVerifiedLabel(host: string | null | undefined): string {
  if (!host) return 'A request from an external page reached the widget.'
  if (isLocalWidgetOrigin(host)) return 'First request came from a local page.'
  return `First request came from ${host}.`
}

export type WidgetInstallPresenceTone = 'idle' | 'detected' | 'channel-off' | 'live'

export type WidgetInstallPresence = {
  title: string
  description: string
  tone: WidgetInstallPresenceTone
}

/**
 * Install status as shown to admins. Observing the SDK is not the same as the
 * widget being visible — `enabled` is the Show on your website switch. For
 * Connect Messenger, the Messages tab must also be on before the flow is live.
 */
export function widgetInstallPresence(input: {
  connected: boolean
  enabled: boolean
  originHost?: string | null
  requireMessengerTab?: boolean
  messengerTab?: boolean
}): WidgetInstallPresence {
  if (!input.connected) {
    return {
      title: 'Not detected yet',
      description: 'Paste the SDK to connect it',
      tone: 'idle',
    }
  }
  const origin = widgetOriginVerifiedLabel(input.originHost)
  if (!input.enabled) {
    return {
      title: 'SDK detected',
      description: `${origin} Turn on Show on your website so visitors can see it.`,
      tone: 'detected',
    }
  }
  if (input.requireMessengerTab && input.messengerTab === false) {
    return {
      title: 'Messages tab is off',
      description: `${origin} Turn on the Messages tab so conversations can start from the widget.`,
      tone: 'channel-off',
    }
  }
  return {
    title: 'Widget connected',
    description: origin,
    tone: 'live',
  }
}
