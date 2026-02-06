/**
 * Event processing - runs hooks for events.
 */

import { getHook } from './registry'
import type { ProcessResult } from './hook-types'
import { getHookTargets } from './targets'
import type { EventData } from './types'

/**
 * Process an event by running all applicable hooks.
 */
export async function processEvent(event: EventData): Promise<ProcessResult> {
  console.log(`[Event] Processing ${event.type} event ${event.id}`)

  const targets = await getHookTargets(event)
  console.log(`[Event] Found ${targets.length} hook targets`)

  if (targets.length === 0) {
    return { succeeded: 0, failed: 0, errors: [] }
  }

  // Run all hooks in parallel
  const results = await Promise.allSettled(
    targets.map(async ({ type, target, config }) => {
      const hook = getHook(type)
      if (!hook) {
        console.error(`[Event] Unknown hook type: ${type}`)
        return { success: false, error: `Unknown hook: ${type}` }
      }

      return hook.run(event, target, config)
    })
  )

  // Summarize results
  const errors: string[] = []
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const target = targets[i]

    if (result.status === 'rejected') {
      failed++
      const error = result.reason instanceof Error ? result.reason.message : 'Unknown error'
      errors.push(`${target.type}: ${error}`)
      console.error(`[Event] ${target.type} hook threw:`, result.reason)
    } else if (result.value.success) {
      succeeded++
    } else {
      failed++
      if (result.value.error) {
        errors.push(`${target.type}: ${result.value.error}`)
      }
    }
  }

  console.log(`[Event] Completed: ${succeeded} succeeded, ${failed} failed`)

  return { succeeded, failed, errors }
}
