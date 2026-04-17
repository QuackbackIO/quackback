/**
 * IIFE entry for script-tag users.
 *
 * The inline snippet on the host page creates a stub `window.Quackback` that
 * pushes every call into a queue. This module replaces that stub with a live
 * dispatcher backed by `createSDK`, then replays anything already queued.
 *
 * The server-generated `/api/widget/sdk.js` prepends a line that sets
 * `window.__QUACKBACK_URL__`. If present and no `init` is queued, we
 * auto-dispatch init so a bare snippet install Just Works.
 */
import { createSDK } from './core/sdk'
import type { InitOptions } from './types'

declare global {
  interface Window {
    Quackback?: ((...args: unknown[]) => unknown) & { q?: IArguments[] }
    __QUACKBACK_URL__?: string
  }
}

const sdk = createSDK()
const w = window

// Capture any queued calls from the inline snippet before we overwrite Quackback.
const queued: IArguments[] = Array.from(w.Quackback?.q ?? [])

const bakedUrl = w.__QUACKBACK_URL__
const alreadyHasInit = queued.some((args) => (args as unknown as unknown[])[0] === 'init')

if (bakedUrl && !alreadyHasInit) {
  sdk.dispatch('init', { instanceUrl: bakedUrl } satisfies InitOptions, undefined)
}

// Replace the queue stub with a live dispatcher
w.Quackback = function (...args: unknown[]) {
  return sdk.dispatch(args[0] as 'init', args[1], args[2])
}

// Replay any queued commands
for (const args of queued) {
  const a = args as unknown as unknown[]
  sdk.dispatch(a[0] as 'init', a[1], a[2])
}
