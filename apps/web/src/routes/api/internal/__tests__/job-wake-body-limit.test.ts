/**
 * /api/internal/job-wake caps its body at 16 KB on the bytes it actually
 * reads, not on the Content-Length header alone: a chunked body has no
 * header, and a header can understate the body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
}))

vi.mock('@/lib/server/fleet/internal-auth', () => ({
  authorizeFleetInternal: () => true,
}))
vi.mock('@/lib/server/jobs/worker', () => ({
  handleJobWake: mocks.handle,
  isJobWorkerRunning: () => true,
}))

import { handleJobWakeRequest } from '../job-wake'

/** A valid wake request padded past 16 KB. */
const OVERSIZED = JSON.stringify({ workspaceKey: 'inst_a', pad: 'x'.repeat(17 * 1024) })

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      // Several chunks, the way a chunked upload arrives.
      for (let i = 0; i < bytes.length; i += 4096) controller.enqueue(bytes.slice(i, i + 4096))
      controller.close()
    },
  })
}

function wake(body: ReadableStream<Uint8Array> | string, headers: Record<string, string> = {}) {
  return new Request('http://worker/api/internal/job-wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as RequestInit)
}

beforeEach(() => {
  mocks.handle.mockReset().mockResolvedValue(undefined)
})

describe('POST /api/internal/job-wake body limit', () => {
  it('refuses a body over 16 KB sent without a Content-Length', async () => {
    const request = wake(streamOf(OVERSIZED))
    expect(request.headers.get('content-length')).toBeNull()

    const response = await handleJobWakeRequest(request)

    expect(response.status).toBe(413)
    expect(mocks.handle).not.toHaveBeenCalled()
  })

  it('refuses a body over 16 KB whose Content-Length understates it', async () => {
    const response = await handleJobWakeRequest(
      wake(streamOf(OVERSIZED), { 'content-length': '64' })
    )

    expect(response.status).toBe(413)
    expect(mocks.handle).not.toHaveBeenCalled()
  })

  it('still accepts a small body sent without a Content-Length', async () => {
    const response = await handleJobWakeRequest(
      wake(streamOf(JSON.stringify({ workspaceKey: 'inst_a', jobIds: [] })))
    )

    expect(response.status).toBe(202)
    expect(mocks.handle).toHaveBeenCalledOnce()
  })
})
