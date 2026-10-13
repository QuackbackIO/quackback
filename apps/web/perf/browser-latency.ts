/** Browser timing trends. These are reported separately from deterministic cost gates. */
export const LATENCY_INIT_SCRIPT = `
  window.__perfLatency = { events: [], frames: [], tasks: [] }
  const observe = (type, target, options = {}) => {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) return
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        target.push({ start: entry.startTime, duration: entry.duration, id: entry.interactionId || 0 })
      }
    }).observe({ type, buffered: true, ...options })
  }
  observe('event', window.__perfLatency.events, { durationThreshold: 16 })
  observe('long-animation-frame', window.__perfLatency.frames)
  observe('longtask', window.__perfLatency.tasks)
`

export interface LatencyEntry {
  start: number
  duration: number
  id: number
}

export interface BrowserLatency {
  events: LatencyEntry[]
  frames: LatencyEntry[]
  tasks: LatencyEntry[]
}

/** Event Timing rounds durations and omits short interactions. This is a trend, not field INP. */
export function summarizeLatency(samples: BrowserLatency, since: number) {
  const interactions = new Map<number, number>()
  for (const event of samples.events) {
    if (event.start >= since && event.id)
      interactions.set(event.id, Math.max(interactions.get(event.id) ?? 0, event.duration))
  }
  const durations = [...interactions.values()].sort((a, b) => a - b)
  const frames = samples.frames.filter((entry) => entry.start >= since)
  const tasks = samples.tasks.filter((entry) => entry.start >= since)
  return {
    interactionSamples: durations.length,
    interactionP75Ms: durations[Math.max(0, Math.ceil(durations.length * 0.75) - 1)] ?? 0,
    interactionMaxMs: durations.at(-1) ?? 0,
    longFrames: frames.length,
    longTasks: tasks.length,
    maxFrameMs: Math.round(Math.max(0, ...frames.map((entry) => entry.duration))),
  }
}
