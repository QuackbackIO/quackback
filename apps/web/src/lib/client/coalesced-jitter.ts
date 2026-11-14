/**
 * A call delayed by a random share of `maxDelayMs`, so many clients told the
 * same thing at once do not all act at once. Triggers that arrive while a run
 * is pending join it, so a burst runs once. `cancel` drops a pending run, for
 * an owner that is going away.
 */
export function coalescedJitter(
  run: () => void,
  maxDelayMs: number,
  random: () => number = Math.random
): { schedule: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule: () => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        run()
      }, random() * maxDelayMs)
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
