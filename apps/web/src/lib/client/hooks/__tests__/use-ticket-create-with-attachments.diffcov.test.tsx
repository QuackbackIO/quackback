// @vitest-environment happy-dom

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useTicketCreateWithAttachments,
  type FileToAttach,
} from '../use-ticket-create-with-attachments'

const TICKET = { id: 'ticket_1' as never, title: 'demo' }
const THREAD = { id: 'thread_1' as never }

function makeFile(name: string): File {
  return new File(['content'], name, { type: 'text/plain' })
}

function makeAttachments(...names: string[]): FileToAttach[] {
  return names.map((name, i) => ({ file: makeFile(name), id: `f${i}` }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useTicketCreateWithAttachments', () => {
  it('starts with a clean, idle state', () => {
    const { result } = renderHook(() =>
      useTicketCreateWithAttachments({
        createFn: vi.fn(),
        createThreadFn: vi.fn(),
        uploadFileFn: vi.fn(),
        files: [],
      })
    )
    expect(result.current.state).toEqual({
      isUploading: false,
      uploadProgress: {},
      uploadErrors: {},
      successCount: 0,
      failureCount: 0,
      isDone: false,
    })
  })

  it('creates the ticket and finishes immediately when there are no files', async () => {
    const createFn = vi.fn().mockResolvedValue(TICKET)
    const createThreadFn = vi.fn()
    const uploadFileFn = vi.fn()
    const { result } = renderHook(() =>
      useTicketCreateWithAttachments({
        createFn,
        createThreadFn,
        uploadFileFn,
        files: [],
      })
    )

    let returned: unknown
    await act(async () => {
      returned = await result.current.execute()
    })

    expect(returned).toBe(TICKET)
    expect(createFn).toHaveBeenCalledTimes(1)
    expect(createThreadFn).not.toHaveBeenCalled()
    expect(uploadFileFn).not.toHaveBeenCalled()
    expect(result.current.state.isUploading).toBe(false)
    expect(result.current.state.isDone).toBe(true)
    expect(result.current.state.successCount).toBe(0)
    expect(result.current.state.failureCount).toBe(0)
  })

  it('uploads files, tracking both per-file success and per-file failure', async () => {
    const createFn = vi.fn().mockResolvedValue(TICKET)
    const createThreadFn = vi.fn().mockResolvedValue(THREAD)
    const uploadFileFn = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'too big' })
    const onFileUploadComplete = vi.fn()
    const files = makeAttachments('ok.txt', 'bad.txt')

    const { result } = renderHook(() =>
      useTicketCreateWithAttachments({
        createFn,
        createThreadFn,
        uploadFileFn,
        files,
        onFileUploadComplete,
      })
    )

    let returned: unknown
    await act(async () => {
      returned = await result.current.execute()
    })

    expect(returned).toBe(TICKET)
    expect(createThreadFn).toHaveBeenCalledWith(TICKET.id)
    expect(uploadFileFn).toHaveBeenCalledTimes(2)
    expect(result.current.state.successCount).toBe(1)
    expect(result.current.state.failureCount).toBe(1)
    expect(result.current.state.uploadErrors).toEqual({ f1: 'too big' })
    expect(result.current.state.isUploading).toBe(false)
    expect(result.current.state.isDone).toBe(true)
    expect(onFileUploadComplete).toHaveBeenCalledWith({
      id: 'f0',
      success: true,
      error: undefined,
    })
    expect(onFileUploadComplete).toHaveBeenCalledWith({
      id: 'f1',
      success: false,
      error: 'too big',
    })
  })

  it('captures a thrown upload error in the per-file catch branch', async () => {
    const createFn = vi.fn().mockResolvedValue(TICKET)
    const createThreadFn = vi.fn().mockResolvedValue(THREAD)
    const uploadFileFn = vi.fn().mockRejectedValue(new Error('network down'))
    const onFileUploadComplete = vi.fn()
    const files = makeAttachments('one.txt')

    const { result } = renderHook(() =>
      useTicketCreateWithAttachments({
        createFn,
        createThreadFn,
        uploadFileFn,
        files,
        onFileUploadComplete,
      })
    )

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.state.failureCount).toBe(1)
    expect(result.current.state.uploadErrors).toEqual({ f0: 'network down' })
    expect(onFileUploadComplete).toHaveBeenCalledWith({
      id: 'f0',
      success: false,
      error: 'network down',
    })
  })

  it('falls back to "Unknown error" when a non-Error is thrown during upload', async () => {
    const createFn = vi.fn().mockResolvedValue(TICKET)
    const createThreadFn = vi.fn().mockResolvedValue(THREAD)
    const uploadFileFn = vi.fn().mockRejectedValue('boom')
    const files = makeAttachments('one.txt')

    const { result } = renderHook(() =>
      useTicketCreateWithAttachments({
        createFn,
        createThreadFn,
        uploadFileFn,
        files,
      })
    )

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.state.uploadErrors).toEqual({ f0: 'Unknown error' })
  })

  it('surfaces a ticket-creation failure via the outer catch branch', async () => {
    const createFn = vi.fn().mockRejectedValue(new Error('create failed'))
    const { result } = renderHook(() =>
      useTicketCreateWithAttachments({
        createFn,
        createThreadFn: vi.fn(),
        uploadFileFn: vi.fn(),
        files: makeAttachments('one.txt'),
      })
    )

    let caught: unknown
    await act(async () => {
      await result.current.execute().catch((e: unknown) => {
        caught = e
      })
    })
    expect((caught as Error).message).toBe('create failed')

    expect(result.current.state.isUploading).toBe(false)
    expect(result.current.state.isDone).toBe(true)
    expect(result.current.state.failureCount).toBe(1)
    expect(result.current.state.uploadErrors).toEqual({ general: 'create failed' })
  })

  it('uses the generic message when a non-Error is thrown during ticket creation', async () => {
    const createFn = vi.fn().mockRejectedValue('nope')
    const { result } = renderHook(() =>
      useTicketCreateWithAttachments({
        createFn,
        createThreadFn: vi.fn(),
        uploadFileFn: vi.fn(),
        files: [],
      })
    )

    let caught: unknown
    await act(async () => {
      await result.current.execute().catch((e: unknown) => {
        caught = e
      })
    })
    expect(caught).toBe('nope')

    expect(result.current.state.uploadErrors).toEqual({
      general: 'Failed to create ticket',
    })
  })
})
