import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxId } from '@quackback/ids'

const mocks = vi.hoisted(() => ({
  listInboxesFn: vi.fn(),
  getInboxFn: vi.fn(),
  listInboxChannelsFn: vi.fn(),
  listInboxMembershipsFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/inboxes', () => ({
  listInboxesFn: (input: unknown) => mocks.listInboxesFn(input),
  getInboxFn: (input: unknown) => mocks.getInboxFn(input),
  listInboxChannelsFn: (input: unknown) => mocks.listInboxChannelsFn(input),
  listInboxMembershipsFn: (input: unknown) => mocks.listInboxMembershipsFn(input),
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
}))

import { inboxQueries } from '../inboxes'

const inboxId = 'inbox_1' as InboxId

beforeEach(() => {
  vi.clearAllMocks()
})

describe('inboxQueries.list', () => {
  it('defaults to an empty params object and forwards it', async () => {
    const options = inboxQueries.list()
    expect(options.queryKey).toEqual(['inboxes', 'list', {}])
    expect(options.staleTime).toBe(30_000)

    mocks.listInboxesFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listInboxesFn).toHaveBeenCalledWith({ data: {} })
  })

  it('forwards includeArchived when provided', async () => {
    const options = inboxQueries.list({ includeArchived: true })
    expect(options.queryKey).toEqual(['inboxes', 'list', { includeArchived: true }])

    mocks.listInboxesFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listInboxesFn).toHaveBeenCalledWith({ data: { includeArchived: true } })
  })
})

describe('inboxQueries.detail', () => {
  it('builds the detail query and calls getInboxFn', async () => {
    const options = inboxQueries.detail(inboxId)
    expect(options.queryKey).toEqual(['inboxes', 'detail', inboxId])

    mocks.getInboxFn.mockResolvedValueOnce({ id: inboxId })
    await options.queryFn!({} as never)

    expect(mocks.getInboxFn).toHaveBeenCalledWith({ data: { inboxId } })
  })
})

describe('inboxQueries.channels', () => {
  it('builds the channels query and calls listInboxChannelsFn', async () => {
    const options = inboxQueries.channels(inboxId)
    expect(options.queryKey).toEqual(['inboxes', 'channels', inboxId])

    mocks.listInboxChannelsFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listInboxChannelsFn).toHaveBeenCalledWith({ data: { inboxId } })
  })
})

describe('inboxQueries.memberships', () => {
  it('builds the memberships query and calls listInboxMembershipsFn', async () => {
    const options = inboxQueries.memberships(inboxId)
    expect(options.queryKey).toEqual(['inboxes', 'memberships', inboxId])

    mocks.listInboxMembershipsFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listInboxMembershipsFn).toHaveBeenCalledWith({ data: { inboxId } })
  })
})
