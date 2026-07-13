/**
 * IIFE entry for script-tag users.
 *
 * The inline snippet on the host page creates a stub `window.Quackback` that
 * pushes every call into a queue. This module replaces that stub with a live
 * dispatcher backed by `createSDK`, then replays anything already queued.
 *
 * The server-generated `/api/widget/sdk.js` prepends a line that sets
 * `window.__QUACKBACK_URL__`. Script-tag installs therefore omit `instanceUrl`
 * from their init options — we fold the baked URL into every init that doesn't
 * carry one of its own. If no init happens at all (a bare `<script src>` with
 * no `Quackback("init")` call), we auto-dispatch one so the widget still boots.
 */
import { createSDK } from './core/sdk'

declare global {
  interface Window {
    Quackback?: ((...args: unknown[]) => unknown) & { q?: IArguments[] }
    __QUACKBACK_URL__?: string
  }
}

const sdk = createSDK()
const w = window
const currentScript =
  typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null

function originFromScript(script: HTMLScriptElement | null): string | undefined {
  const src = script?.src
  if (!src) return undefined
  try {
    return new URL(src, window.location.href).origin
  } catch {
    return undefined
  }
}

// Prefer the actual script origin so proxy/tunnel URLs don't accidentally boot
// a localhost BASE_URL baked into the served bundle.
const bakedUrl = originFromScript(currentScript) ?? w.__QUACKBACK_URL__

function scriptDatasetDefaults(script: HTMLScriptElement | null): {
  applicationKey?: string
  environment?: string
} {
  return {
    applicationKey: script?.dataset.applicationKey,
    environment: script?.dataset.environment,
  }
}

function previousBootstrapScript(script: HTMLScriptElement | null): HTMLScriptElement | null {
  if (typeof document === 'undefined') return null
  const scripts = Array.from(document.scripts)
  const currentIndex = script ? scripts.indexOf(script) : scripts.length
  const candidates = currentIndex >= 0 ? scripts.slice(0, currentIndex) : scripts

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index] as HTMLScriptElement
    if (candidate.dataset.applicationKey || candidate.dataset.environment) return candidate
  }

  return null
}

function resolveScriptDefaults(): {
  applicationKey?: string
  environment?: string
} {
  const directDefaults = scriptDatasetDefaults(currentScript)
  const fallbackDefaults = scriptDatasetDefaults(previousBootstrapScript(currentScript))

  return {
    applicationKey: directDefaults.applicationKey ?? fallbackDefaults.applicationKey,
    environment: directDefaults.environment ?? fallbackDefaults.environment,
  }
}

const scriptDefaults = {
  ...resolveScriptDefaults(),
}

// Suppresses the deferred fallback once the host has taken explicit control:
// either by initializing (their options take precedence) or by destroying
// (they don't want a default widget spawning later).
let bootSuppressed = false

function dispatch(command: unknown, a?: unknown, b?: unknown): unknown {
  if (command === 'init' || command === 'destroy') bootSuppressed = true
  if (command === 'init' && bakedUrl) {
    const opts = a && typeof a === 'object' ? (a as Record<string, unknown>) : {}
    a = {
      ...scriptDefaults,
      ...opts,
      instanceUrl: opts.instanceUrl ?? bakedUrl,
    }
  }
  return sdk.dispatch(command as 'init', a, b)
}

// Capture any queued calls from the inline snippet before we overwrite Quackback.
const queued: IArguments[] = Array.from(w.Quackback?.q ?? [])

// Replace the queue stub with a live dispatcher.
w.Quackback = function (...args: unknown[]) {
  return dispatch(args[0], args[1], args[2])
}

// Replay any queued commands.
for (const args of queued) {
  const a = args as unknown as unknown[]
  dispatch(a[0], a[1], a[2])
}

// Deferred so an explicit `Quackback("init", ...)` from host code can pre-empt
// the default-options fallback.
if (bakedUrl) {
  setTimeout(() => {
    if (!bootSuppressed) dispatch('init', {})
  }, 0)
}
