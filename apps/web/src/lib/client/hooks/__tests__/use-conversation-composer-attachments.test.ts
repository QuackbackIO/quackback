// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MAX_CONVERSATION_ATTACHMENTS } from '@/lib/shared/conversation/types'
import { useConversationComposerAttachments } from '../use-conversation-composer-attachments'

function png(name: string) {
  return new File(['x'], name, { type: 'image/png' })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useConversationComposerAttachments', () => {
  it('keeps uploading true until every overlapping addFiles finishes', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const upload = (file: File) => (file.name === 'a.png' ? first.promise : second.promise)
    const { result } = renderHook(() => useConversationComposerAttachments(upload))

    let firstDone!: Promise<void>
    let secondDone!: Promise<void>
    act(() => {
      firstDone = result.current.addFiles([png('a.png')])
      secondDone = result.current.addFiles([png('b.png')])
    })
    expect(result.current.uploading).toBe(true)

    await act(async () => {
      second.resolve('/api/storage/chat-images/b.png')
      await secondDone
    })
    expect(result.current.uploading).toBe(true)
    expect(result.current.pending).toHaveLength(1)

    await act(async () => {
      first.resolve('/api/storage/chat-images/a.png')
      await firstDone
    })
    expect(result.current.uploading).toBe(false)
    expect(result.current.pending.map((a) => a.name).sort()).toEqual(['a.png', 'b.png'])
  })

  it('drops an in-flight upload after clear so a reopened composer stays empty', async () => {
    const pending = deferred<string>()
    const { result } = renderHook(() => useConversationComposerAttachments(() => pending.promise))

    let addDone!: Promise<void>
    act(() => {
      addDone = result.current.addFiles([png('stale.png')])
    })
    expect(result.current.uploading).toBe(true)

    act(() => {
      result.current.clear()
    })
    expect(result.current.uploading).toBe(false)
    expect(result.current.pending).toEqual([])

    await act(async () => {
      pending.resolve('/api/storage/chat-images/stale.png')
      await addDone
    })
    expect(result.current.pending).toEqual([])
    expect(result.current.uploading).toBe(false)
  })

  it('does not upload a second near-cap paste while the last slot is reserved', async () => {
    const upload = vi.fn((file: File) => Promise.resolve(`/api/storage/chat-images/${file.name}`))
    const { result } = renderHook(() => useConversationComposerAttachments(upload))
    act(() => {
      result.current.restore(
        Array.from({ length: MAX_CONVERSATION_ATTACHMENTS - 1 }, (_, i) => ({
          url: `/api/storage/chat-images/${i}.png`,
          name: `${i}.png`,
          contentType: 'image/png',
          size: 1,
        }))
      )
    })

    const first = deferred<string>()
    upload.mockImplementationOnce(() => first.promise)

    let firstDone!: Promise<void>
    let secondDone!: Promise<void>
    act(() => {
      firstDone = result.current.addFiles([png('last.png')])
      secondDone = result.current.addFiles([png('overflow.png')])
    })
    expect(upload).toHaveBeenCalledTimes(1)

    await act(async () => {
      first.resolve('/api/storage/chat-images/last.png')
      await firstDone
      await secondDone
    })
    expect(result.current.pending).toHaveLength(MAX_CONVERSATION_ATTACHMENTS)
    expect(result.current.pending.at(-1)?.name).toBe('last.png')
  })

  it('keeps the files that uploaded when one image in a multi-pick fails', async () => {
    const upload = vi.fn((file: File) =>
      file.name === 'bad.png'
        ? Promise.reject(new Error('too large'))
        : Promise.resolve(`/api/storage/chat-images/${file.name}`)
    )
    const { result } = renderHook(() => useConversationComposerAttachments(upload))

    await act(async () => {
      await result.current.addFiles([png('ok.png'), png('bad.png')])
    })
    expect(result.current.pending).toEqual([
      {
        url: '/api/storage/chat-images/ok.png',
        name: 'ok.png',
        contentType: 'image/png',
        size: 1,
      },
    ])
    expect(result.current.uploading).toBe(false)
  })
})
