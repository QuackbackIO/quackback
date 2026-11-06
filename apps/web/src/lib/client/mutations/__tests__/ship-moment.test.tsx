// @vitest-environment happy-dom
/**
 * Marking a post complete or publishing a changelog entry is a ship moment,
 * which the one-time GitHub star prompt waits for. Other saves are not.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId, PostStatusId } from '@quackback/ids'
import { onShipMoment } from '@/lib/client/ship-moment'

const hoisted = vi.hoisted(() => ({ entered: true }))

vi.mock('@/lib/server/functions/posts', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  changePostStatusFn: vi.fn(async () => ({ id: 'post_x', enteredComplete: hoisted.entered })),
}))

vi.mock('@/lib/server/functions/changelog', () => ({
  createChangelogFn: vi.fn(async () => ({ id: 'changelog_x' })),
  updateChangelogFn: vi.fn(async () => ({ id: 'changelog_x' })),
  deleteChangelogFn: vi.fn(),
}))

const { useChangePostStatusId } = await import('../posts')
const { useCreateChangelog, useUpdateChangelog } = await import('../changelog')

const POST = 'post_aaaaaaaaaaaaaaaaaaaaaaaaaa' as PostId
const STATUS = 'post_status_aaaaaaaaaaaaaaaaaaaaaaaaaa' as PostStatusId

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient()
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('ship moments', () => {
  let moments = 0
  let stop = () => {}
  beforeEach(() => {
    moments = 0
    stop = onShipMoment(() => {
      moments += 1
    })
  })
  afterEach(() => stop())

  it('fires when a post moves into a complete status, and not for other changes', async () => {
    const { result } = renderHook(() => useChangePostStatusId(), { wrapper })
    hoisted.entered = false
    await act(() => result.current.mutateAsync({ postId: POST, statusId: STATUS }))
    expect(moments).toBe(0)
    hoisted.entered = true
    await act(() => result.current.mutateAsync({ postId: POST, statusId: STATUS }))
    expect(moments).toBe(1)
  })

  it('fires when a changelog entry is published, not when it is drafted or re-saved', async () => {
    const create = renderHook(() => useCreateChangelog(), { wrapper }).result
    const update = renderHook(() => useUpdateChangelog(), { wrapper }).result
    const base = { title: 'Dark mode', content: 'x' }
    await act(() => create.current.mutateAsync({ ...base, publishState: { type: 'draft' } }))
    expect(moments).toBe(0)
    await act(() => create.current.mutateAsync({ ...base, publishState: { type: 'published' } }))
    expect(moments).toBe(1)
    // Saving an entry that is already out carries its original publish date.
    await act(() =>
      update.current.mutateAsync({
        id: 'changelog_x',
        publishState: { type: 'published', publishAt: new Date('2026-10-01') },
      })
    )
    expect(moments).toBe(1)
    await act(() =>
      update.current.mutateAsync({ id: 'changelog_x', publishState: { type: 'published' } })
    )
    expect(moments).toBe(2)
  })
})
