/**
 * Every chokepoint string names live code.
 *
 * `chokepoint` is documentation, and documentation about where a gate sits
 * rots in the one direction that matters: a refactor moves or deletes the
 * gate, the string still claims it is there, and the plan silently stops
 * differing in what it does. The per-seam tests catch a gate that stops
 * refusing; this catches the string that stops being true, and it is the
 * standing guard that a deleted gate cannot be reverted quietly.
 *
 * The rule: for every key whose chokepoint is not prefixed "not wired:", every
 * source file the string names must exist and must call
 * `requireEntitlement('<that key>')`. Keys marked "not wired:" are the honest
 * opposite — a verified seam with no gate yet — and are asserted to hold no
 * gate, so the marker cannot outlive the wiring either.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ENTITLEMENTS, ENTITLEMENT_KEYS, type EntitlementKey } from '../cloud.types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** apps/web/src — chokepoint strings are written relative to it. */
const SRC = path.resolve(HERE, '../../../../../..')

const NOT_WIRED = 'not wired:'

function filesNamedBy(key: EntitlementKey): string[] {
  return [...ENTITLEMENTS[key].chokepoint.matchAll(/lib\/server\/[\w./-]+\.ts/g)].map((m) => m[0])
}

function source(relative: string): string {
  return readFileSync(path.join(SRC, relative), 'utf8')
}

const wired = ENTITLEMENT_KEYS.filter((key) => !ENTITLEMENTS[key].chokepoint.startsWith(NOT_WIRED))
const unwired = ENTITLEMENT_KEYS.filter((key) => ENTITLEMENTS[key].chokepoint.startsWith(NOT_WIRED))

describe('a wired chokepoint names a file that holds its gate', () => {
  it.each(wired)('%s', (key) => {
    const files = filesNamedBy(key)
    // A chokepoint that names no file at all would make the assertion below
    // vacuous — the shape of test that passes against anything.
    expect({ key, files: files.length > 0 }).toEqual({ key, files: true })
    for (const file of files) {
      expect({ key, file, exists: existsSync(path.join(SRC, file)) }).toEqual({
        key,
        file,
        exists: true,
      })
      expect({ key, file, gated: source(file).includes(`requireEntitlement('${key}')`) }).toEqual({
        key,
        file,
        gated: true,
      })
    }
  })
})

describe('an unwired chokepoint says so', () => {
  it.each(unwired)('%s holds no gate, so the marker is accurate', (key) => {
    for (const file of filesNamedBy(key)) {
      expect({ key, file, gated: source(file).includes(`requireEntitlement('${key}')`) }).toEqual({
        key,
        file,
        gated: false,
      })
    }
  })
})
