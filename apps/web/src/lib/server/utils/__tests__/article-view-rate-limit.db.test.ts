/**
 * Article views from one address, against a real server: one count per
 * article per hour (a reload or a reopen does not count again), and a cap on
 * how many articles one address can count in an hour, so the public view
 * endpoint cannot be used to push an article up the popular list.
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
import { ARTICLE_VIEW_RATE_LIMIT, reserveArticleView } from '../anon-rate-limit'

const [T, U] = workspacePair()

beforeAll(ensureKvSchema)
afterAll(async () => {
  await cleanupWorkspaces(T, U)
  await closeHarness()
})

function address(): string {
  const [a, b] = [randomUUID().slice(0, 4), randomUUID().slice(0, 4)]
  return `2001:db8::${a}:${b}`
}

const article = () => `kb_article_${randomUUID()}`

it('counts one view per article per address, however often it is opened', async () => {
  const ip = address()
  const a = article()
  const results = await Promise.all(
    Array.from({ length: 5 }, () => withRealWorkspace(T, () => reserveArticleView(ip, a)))
  )
  expect(results.filter(Boolean)).toHaveLength(1)
  // Another visitor reading the same article still counts.
  expect(await withRealWorkspace(T, () => reserveArticleView(address(), a))).toBe(true)
})

it('caps how many articles one address can count in an hour', async () => {
  const ip = address()
  for (let i = 0; i < ARTICLE_VIEW_RATE_LIMIT; i++) {
    expect(await withRealWorkspace(T, () => reserveArticleView(ip, article()))).toBe(true)
  }
  expect(await withRealWorkspace(T, () => reserveArticleView(ip, article()))).toBe(false)
  expect(await withRealWorkspace(T, () => reserveArticleView(address(), article()))).toBe(true)
})

it('keeps one workspace from spending another workspace budget', async () => {
  const ip = address()
  const a = article()
  expect(await withRealWorkspace(T, () => reserveArticleView(ip, a))).toBe(true)
  expect(await withRealWorkspace(U, () => reserveArticleView(ip, a))).toBe(true)
})
