const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * A JSON merge patch (RFC 7386) applied to a copy of `target`: objects merge
 * key by key, null removes a key, and any other value replaces. Prototype
 * keys are ignored.
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return structuredClone(patch)
  const out: Record<string, unknown> = isObject(target) ? structuredClone(target) : {}
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_KEYS.has(key)) continue
    if (value === null) delete out[key]
    else out[key] = mergePatch(out[key], value)
  }
  return out
}
