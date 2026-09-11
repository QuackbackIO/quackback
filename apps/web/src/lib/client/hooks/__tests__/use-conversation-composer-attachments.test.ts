// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
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
})
