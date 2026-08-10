import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = () => Promise<void>

const hoisted = vi.hoisted(() => ({
  handler: null as Handler | null,
  headers: new Headers(),
  setResponseHeader: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler(fn: Handler) {
      hoisted.handler = fn
      return fn
    },
  }),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => hoisted.headers,
  setResponseHeader: hoisted.setResponseHeader,
}))

beforeAll(async () => {
  await import('../public-cache')
  expect(hoisted.handler).not.toBeNull()
})

beforeEach(() => {
  hoisted.headers = new Headers()
  hoisted.setResponseHeader.mockClear()
})

async function runWithHeaders(entries: Array<[string, string]> = []) {
  hoisted.headers = new Headers(entries)
  await hoisted.handler!()
}

describe('setPublicDocumentCacheHeaders', () => {
  it('keeps a credential-free document shared-cacheable', async () => {
    await runWithHeaders()

    expect(hoisted.setResponseHeader).toHaveBeenCalledTimes(1)
    expect(hoisted.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=600'
    )
  })

  it.each([
    ['Cookie', [['CoOkIe', '']] as Array<[string, string]>],
    ['Authorization', [['AUTHORIZATION', '']] as Array<[string, string]>],
    [
      'Cookie and Authorization',
      [
        ['Cookie', ''],
        ['Authorization', ''],
      ] as Array<[string, string]>,
    ],
  ])('marks a document with %s headers private and uncacheable', async (_label, entries) => {
    await runWithHeaders(entries)

    expect(hoisted.setResponseHeader).toHaveBeenCalledTimes(1)
    expect(hoisted.setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
  })
})
