/**
 * The anonymous idea limit, against a real server: the slot is reserved by one
 * atomic bucket increment keyed on the submitting address, so a concurrent
 * burst cannot overshoot it, and moving to another address neither carries the
 * spend along nor charges the address left behind.
 */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  cleanupWorkspaces,
  closeHarness,
  ensureKvSchema,
  withRealWorkspace,
  workspacePair,
} from '@/lib/server/kv/__tests__/harness'
import { ANON_POST_RATE_LIMIT, reserveAnonPostSlot } from '../anon-rate-limit'

const [T, U] = workspacePair()

beforeAll(ensureKvSchema)
afterAll(async () => {
  await cleanupWorkspaces(T, U)
  await closeHarness()
})

/** An address no other run on this machine is using. */
function address(): string {
  const [a, b] = [randomUUID().slice(0, 4), randomUUID().slice(0, 4)]
  return `2001:db8::${a}:${b}`
}

it('admits exactly the limit from a concurrent burst at one address', async () => {
  const ip = address()
  const results = await Promise.all(
    Array.from({ length: 20 }, () => withRealWorkspace(T, () => reserveAnonPostSlot(ip)))
  )
  expect(results.filter(Boolean)).toHaveLength(ANON_POST_RATE_LIMIT)
})

it('charges only the address an idea was submitted from', async () => {
  const office = address()
  const home = address()
  for (let i = 0; i < ANON_POST_RATE_LIMIT; i++) {
    expect(await withRealWorkspace(T, () => reserveAnonPostSlot(home))).toBe(true)
  }
  expect(await withRealWorkspace(T, () => reserveAnonPostSlot(home))).toBe(false)
  // The same visitor moving on does not spend the address they left.
  expect(await withRealWorkspace(T, () => reserveAnonPostSlot(office))).toBe(true)
})

it('keeps one workspace from spending another workspace budget', async () => {
  const ip = address()
  for (let i = 0; i < ANON_POST_RATE_LIMIT; i++) {
    await withRealWorkspace(T, () => reserveAnonPostSlot(ip))
  }
  expect(await withRealWorkspace(T, () => reserveAnonPostSlot(ip))).toBe(false)
  expect(await withRealWorkspace(U, () => reserveAnonPostSlot(ip))).toBe(true)
})
