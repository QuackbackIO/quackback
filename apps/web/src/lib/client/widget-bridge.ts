interface NativeBridge {
  dispatch: (event: string, data: unknown) => void
}

declare global {
  interface Window {
    __quackbackNative?: Partial<NativeBridge>
  }
}

export function sendToHost(message: Record<string, unknown>): void {
  if (window.__quackbackNative?.dispatch) {
    const rawType = typeof message.type === 'string' ? message.type : ''
    const eventType = rawType.startsWith('quackback:')
      ? rawType.slice('quackback:'.length)
      : rawType || 'unknown'
    window.__quackbackNative.dispatch(eventType, message)
    return
  }
  window.parent.postMessage(message, '*')
}

export function isNativeWidget(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('source') === 'native'
}
