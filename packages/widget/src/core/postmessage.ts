export type InboundMessage =
  | { type: 'quackback:init'; data?: unknown }
  | { type: 'quackback:identify'; data: unknown }
  | { type: 'quackback:metadata'; data: Record<string, string> }
  | { type: 'quackback:open'; data?: unknown }
  | { type: 'quackback:locale'; data: string }
  | { type: 'quackback:mobile'; data: boolean }

export type OutboundMessage =
  | { type: 'quackback:ready' }
  | { type: 'quackback:close' }
  | { type: 'quackback:navigate'; url: string }
  | { type: 'quackback:identify-result'; success: boolean; user?: unknown; error?: string }
  | { type: 'quackback:auth-change'; user: unknown }
  | { type: 'quackback:event'; name: string; payload: unknown }

export interface BridgeOptions {
  getIframe: () => HTMLIFrameElement | null
  origin: string
}

export interface Bridge {
  send(type: InboundMessage['type'], data?: unknown): void
  onMessage(handler: (msg: OutboundMessage) => void): () => void
  dispose(): void
}

export function createBridge(opts: BridgeOptions): Bridge {
  const handlers = new Set<(msg: OutboundMessage) => void>()

  const listener = (event: MessageEvent) => {
    if (event.origin !== opts.origin) return
    const msg = event.data
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string')
      return
    for (const h of handlers) {
      try {
        h(msg as OutboundMessage)
      } catch {
        /* swallow */
      }
    }
  }
  window.addEventListener('message', listener)

  return {
    send(type, data) {
      const iframe = opts.getIframe()
      if (!iframe?.contentWindow) return
      iframe.contentWindow.postMessage({ type, data }, opts.origin)
    },
    onMessage(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    dispose() {
      window.removeEventListener('message', listener)
      handlers.clear()
    },
  }
}
