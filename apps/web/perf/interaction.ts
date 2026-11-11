/**
 * What a person feels while they work a page, for the journeys that opt in
 * (`interaction: true`): the main thread's long tasks and the time they block
 * input, the slowest event from input to the next paint (an INP-like number),
 * the frames a steady animation loop missed, and the messages that cross into
 * and out of child frames, such as the builder's canvas.
 *
 * Unlike the counts, these are times, so they move between runs and machines:
 * the bench reports them beside the counts and gates only the message counts.
 */
import type { CDPSession, Page } from '@playwright/test'

/**
 * PERF_CPU_SLOWDOWN=4 runs the measured part of these journeys on a CPU four
 * times slower, as a modest laptop is, so the times show what a fast machine
 * hides. The counts are measured at full speed in CI; compare times only
 * between runs at the same slowdown.
 */
const CPU_SLOWDOWN = Number(process.env.PERF_CPU_SLOWDOWN ?? 1)

/**
 * Installed before any page script, in every frame. The top window keeps the
 * tallies; a child frame adds to them, so what a frame did is kept when the
 * frame is replaced. Long tasks and frames are read in the top window, which
 * shares its main thread with its same-origin frames.
 */
export const INTERACTION_SCRIPT = `(() => {
  let root
  try { root = window.top; void root.document } catch { return }
  const sizeOf = (data) => { try { return JSON.stringify(data)?.length ?? 0 } catch { return 0 } }
  if (window === root) {
    const ux = (window.__perfUx = {
      longTasks: 0, blockingMs: 0, slowestEventMs: 0, frames: 0, droppedFrames: 0,
      canvasPosts: 0, canvasPostBytes: 0, framePosts: 0, framePostBytes: 0,
    })
    try {
      new PerformanceObserver((list) => {
        for (const task of list.getEntries()) {
          ux.longTasks++
          ux.blockingMs += Math.max(0, task.duration - 50)
        }
      }).observe({ type: 'longtask' })
    } catch {}
    // A frame is due every 1/60 s; a gap of more than one and a half is one missed or more.
    const FRAME = 1000 / 60
    let last = 0
    const tick = (now) => {
      if (last) {
        const gap = now - last
        ux.frames++
        if (gap > FRAME * 1.5) ux.droppedFrames += Math.round(gap / FRAME) - 1
      }
      last = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    addEventListener('message', (event) => {
      if (!event.source || event.source === window) return
      ux.framePosts++
      ux.framePostBytes += sizeOf(event.data)
    })
  } else {
    addEventListener('message', (event) => {
      const ux = root.__perfUx
      if (!ux || event.source !== window.parent) return
      ux.canvasPosts++
      ux.canvasPostBytes += sizeOf(event.data)
    })
  }
  try {
    new PerformanceObserver((list) => {
      const ux = root.__perfUx
      if (!ux) return
      for (const entry of list.getEntries())
        if (entry.interactionId) ux.slowestEventMs = Math.max(ux.slowestEventMs, entry.duration)
    }).observe({ type: 'event', durationThreshold: 16 })
  } catch {}
})()`

interface Tallies {
  longTasks: number
  blockingMs: number
  slowestEventMs: number
  frames: number
  droppedFrames: number
  canvasPosts: number
  canvasPostBytes: number
  framePosts: number
  framePostBytes: number
}

type Tallied = Window & { __perfUx?: Tallies }

/** Starts the tallies afresh, so they count the measured part of a journey only. */
export async function startInteraction(page: Page, cdp: CDPSession): Promise<void> {
  if (CPU_SLOWDOWN > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN })
  await page.evaluate(() => {
    const ux = (window as Tallied).__perfUx
    if (!ux) return
    for (const key of Object.keys(ux) as (keyof Tallies)[]) ux[key] = 0
  })
}

const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10

/** The tallies since the journey started, as metrics. */
export async function readInteraction(
  page: Page,
  cdp: CDPSession
): Promise<Record<string, number>> {
  if (CPU_SLOWDOWN > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const ux = await page.evaluate(() => {
    const tallies = (window as Tallied).__perfUx
    return tallies ? { ...tallies } : null
  })
  if (!ux) return {}
  return {
    longTasks: ux.longTasks,
    blockingMs: Math.round(ux.blockingMs),
    slowestEventMs: Math.round(ux.slowestEventMs),
    droppedFrames: ux.droppedFrames,
    canvasPosts: ux.canvasPosts,
    canvasPostKB: kb(ux.canvasPostBytes),
    framePosts: ux.framePosts,
  }
}
