// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MAX_CONVERSATION_ATTACHMENTS } from '@/lib/shared/conversation/types'
import { UploadError } from '@/lib/client/files/upload-file'
import { useConversationComposerAttachments } from '../use-conversation-composer-attachments'

function png(name: string, size = 1) {
  const f = new File([new Uint8Array(Math.min(size, 16))], name, { type: 'image/png' })
  if (size !== f.size) Object.defineProperty(f, 'size', { value: size })
  return f
}

function txt(name: string, size = 1) {
  const f = new File([new Uint8Array(Math.min(size, 16))], name, { type: 'text/plain' })
  if (size !== f.size) Object.defineProperty(f, 'size', { value: size })
  return f
}

function uploadedFileFor(file: File) {
  return {
    fileId: `file_${file.name}`,
    url: `/api/storage/files/${file.name}`,
    name: file.name,
    contentType: file.type,
    size: file.size,
    family: file.type.startsWith('image/') ? ('image' as const) : ('text' as const),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => `blob:${(b as File).name}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

describe('useConversationComposerAttachments', () => {
  it('keeps uploading true until every overlapping addFiles finishes', async () => {
    const first = deferred<ReturnType<typeof uploadedFileFor>>()
    const second = deferred<ReturnType<typeof uploadedFileFor>>()
    const upload = vi.fn((file: File) => (file.name === 'a.png' ? first.promise : second.promise))
    const { result } = renderHook(() => useConversationComposerAttachments(upload))

    let firstDone!: Promise<void>
    let secondDone!: Promise<void>
    act(() => {
      firstDone = result.current.addFiles([png('a.png')])
      secondDone = result.current.addFiles([png('b.png')])
    })
    expect(result.current.uploading).toBe(true)
    expect(result.current.items.map((i) => i.status)).toEqual(['uploading', 'uploading'])

    await act(async () => {
      second.resolve(uploadedFileFor(png('b.png')))
      await secondDone
    })
    expect(result.current.uploading).toBe(true)
    expect(result.current.items.find((i) => i.name === 'b.png')?.status).toBe('ready')
    expect(result.current.items.find((i) => i.name === 'a.png')?.status).toBe('uploading')

    await act(async () => {
      first.resolve(uploadedFileFor(png('a.png')))
      await firstDone
    })
    expect(result.current.uploading).toBe(false)
    expect(result.current.items.map((i) => i.name).sort()).toEqual(['a.png', 'b.png'])
    expect(result.current.attachments.map((a) => a.name).sort()).toEqual(['a.png', 'b.png'])
  })

  it('drops an in-flight upload after clear so a reopened composer stays empty', async () => {
    const pending = deferred<ReturnType<typeof uploadedFileFor>>()
    const upload = vi.fn(() => pending.promise)
    const { result } = renderHook(() => useConversationComposerAttachments(upload))

    let addDone!: Promise<void>
    act(() => {
      addDone = result.current.addFiles([png('stale.png')])
    })
    expect(result.current.uploading).toBe(true)

    act(() => {
      result.current.clear()
    })
    expect(result.current.uploading).toBe(false)
    expect(result.current.items).toEqual([])

    await act(async () => {
      pending.resolve(uploadedFileFor(png('stale.png')))
      await addDone
    })
    expect(result.current.items).toEqual([])
    expect(result.current.uploading).toBe(false)
  })

  it('does not upload a second near-cap paste while the last slot is reserved', async () => {
    const upload = vi.fn((file: File) => Promise.resolve(uploadedFileFor(file)))
    const { result } = renderHook(() => useConversationComposerAttachments(upload))
    act(() => {
      result.current.restore(
        Array.from({ length: MAX_CONVERSATION_ATTACHMENTS - 1 }, (_, i) => ({
          fileId: `file_${i}`,
          url: `/api/storage/files/${i}.png`,
          name: `${i}.png`,
          contentType: 'image/png',
          size: 1,
          family: 'image' as const,
        }))
      )
    })
    expect(result.current.items).toHaveLength(MAX_CONVERSATION_ATTACHMENTS - 1)

    const first = deferred<ReturnType<typeof uploadedFileFor>>()
    upload.mockImplementationOnce(() => first.promise)

    let firstDone!: Promise<void>
    let secondDone!: Promise<void>
    act(() => {
      firstDone = result.current.addFiles([png('last.png')])
      secondDone = result.current.addFiles([png('overflow.png')])
    })
    expect(upload).toHaveBeenCalledTimes(1)

    await act(async () => {
      first.resolve(uploadedFileFor(png('last.png')))
      await firstDone
      await secondDone
    })
    expect(result.current.items).toHaveLength(MAX_CONVERSATION_ATTACHMENTS)
    expect(result.current.items.at(-1)?.name).toBe('last.png')
  })

  it('keeps a failed upload as an error tile alongside the ones that succeeded', async () => {
    const upload = vi.fn((file: File) =>
      file.name === 'bad.png'
        ? Promise.reject(new Error('connection reset'))
        : Promise.resolve(uploadedFileFor(file))
    )
    const { result } = renderHook(() => useConversationComposerAttachments(upload))

    await act(async () => {
      await result.current.addFiles([png('ok.png'), png('bad.png')])
    })

    const ok = result.current.items.find((i) => i.name === 'ok.png')
    const bad = result.current.items.find((i) => i.name === 'bad.png')
    expect(ok?.status).toBe('ready')
    expect(bad?.status).toBe('error')
    expect(bad?.error).toBe('connection reset')
    // Error tiles are never sent, and they don't block Send on their own.
    expect(result.current.attachments.map((a) => a.name)).toEqual(['ok.png'])
    expect(result.current.uploading).toBe(false)
  })

  it('rejects an oversized or empty file before ever calling upload', async () => {
    const upload = vi.fn(() => Promise.resolve(uploadedFileFor(txt('x'))))
    const { result } = renderHook(() => useConversationComposerAttachments(upload))

    await act(async () => {
      await result.current.addFiles([txt('huge.csv', 26 * 1024 * 1024), txt('empty.txt', 0)])
    })

    expect(upload).not.toHaveBeenCalled()
    const huge = result.current.items.find((i) => i.name === 'huge.csv')
    const empty = result.current.items.find((i) => i.name === 'empty.txt')
    expect(huge).toMatchObject({ status: 'error', error: 'Over 25 MB', retryable: false })
    expect(empty).toMatchObject({ status: 'error', error: 'The file is empty', retryable: false })
  })

  it('marks a definitive server rejection as not retryable and a network failure as retryable', async () => {
    const upload = vi.fn((file: File) =>
      file.name === 'blocked.exe'
        ? Promise.reject(new UploadError("This file type can't be sent", 'blocked'))
        : Promise.reject(new Error('Upload failed'))
    )
    const { result } = renderHook(() => useConversationComposerAttachments(upload))

    await act(async () => {
      await result.current.addFiles([txt('blocked.exe'), txt('flaky.txt')])
    })

    expect(result.current.items.find((i) => i.name === 'blocked.exe')).toMatchObject({
      retryable: false,
    })
    expect(result.current.items.find((i) => i.name === 'flaky.txt')).toMatchObject({
      retryable: true,
    })
  })

  it('retry re-attempts a failed upload with the same file and can succeed', async () => {
    const file = txt('flaky.txt')
    const upload = vi.fn().mockRejectedValueOnce(new Error('Upload failed'))
    upload.mockResolvedValueOnce(uploadedFileFor(file))
    const { result } = renderHook(() => useConversationComposerAttachments(upload))

    await act(async () => {
      await result.current.addFiles([file])
    })
    expect(result.current.items[0]).toMatchObject({ status: 'error', retryable: true })

    await act(async () => {
      await result.current.retry(result.current.items[0]!.localId)
    })
    expect(upload).toHaveBeenCalledTimes(2)
    expect(result.current.items[0]).toMatchObject({ status: 'ready' })
    expect(result.current.attachments).toHaveLength(1)
  })

  it('restores ready items from previously-uploaded attachments', () => {
    const upload = vi.fn()
    const { result } = renderHook(() => useConversationComposerAttachments(upload))

    act(() => {
      result.current.restore([
        {
          fileId: 'file_1',
          url: '/api/storage/files/a.pdf',
          name: 'a.pdf',
          contentType: 'application/pdf',
          size: 100,
          family: 'pdf',
        },
      ])
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({ name: 'a.pdf', status: 'ready', progress: 1 })
    expect(result.current.attachments).toEqual([
      {
        fileId: 'file_1',
        url: '/api/storage/files/a.pdf',
        name: 'a.pdf',
        contentType: 'application/pdf',
        size: 100,
        family: 'pdf',
      },
    ])
    expect(upload).not.toHaveBeenCalled()
  })

  it('creates a local preview URL for an image and revokes it on remove', async () => {
    const upload = vi.fn(() => new Promise(() => {}))
    const { result } = renderHook(() => useConversationComposerAttachments(upload))

    act(() => {
      void result.current.addFiles([png('shot.png')])
    })
    const item = result.current.items[0]!
    expect(item.previewUrl).toBe('blob:shot.png')

    act(() => {
      result.current.remove(item.localId)
    })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:shot.png')
    expect(result.current.items).toEqual([])
  })

  it('exposes hasErrors once any tile has failed', async () => {
    const upload = vi.fn(() => Promise.reject(new Error('nope')))
    const { result } = renderHook(() => useConversationComposerAttachments(upload))
    expect(result.current.hasErrors).toBe(false)

    await act(async () => {
      await result.current.addFiles([txt('bad.txt')])
    })
    expect(result.current.hasErrors).toBe(true)
  })
})
