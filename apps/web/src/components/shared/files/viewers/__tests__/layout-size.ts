/**
 * happy-dom does no layout, so every element measures 0x0 and a virtualized
 * list renders nothing. Give elements a fixed size for the duration of a test
 * so the grid lays out a window of rows and columns as it would on screen.
 */
export function withLayoutSize(width: number, height: number): () => void {
  const targets: [object, string, number][] = [
    [window.HTMLElement.prototype, 'offsetWidth', width],
    [window.HTMLElement.prototype, 'offsetHeight', height],
    [window.Element.prototype, 'clientWidth', width],
    [window.Element.prototype, 'clientHeight', height],
  ]
  const saved = targets.map(([proto, prop]) => Object.getOwnPropertyDescriptor(proto, prop))
  for (const [proto, prop, value] of targets) {
    Object.defineProperty(proto, prop, { configurable: true, get: () => value })
  }
  return () => {
    targets.forEach(([proto, prop], i) => {
      const original = saved[i]
      if (original) Object.defineProperty(proto, prop, original)
      else delete (proto as Record<string, unknown>)[prop]
    })
  }
}
