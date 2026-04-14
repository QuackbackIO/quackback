import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TiptapContent } from '@/lib/server/db'

// ---- Mocks ----

vi.mock('@/lib/server/content/ssrf-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf-guard')>()
  return {
    ...actual,
    checkUrlSafety: vi.fn(),
  }
})

vi.mock('@/lib/server/storage/s3', () => ({
  isS3Configured: vi.fn(() => true),
  uploadImageBuffer: vi.fn(),
}))

// We mock the global fetch
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { rehostExternalImages } from '../rehost-images'
import { checkUrlSafety } from '@/lib/server/content/ssrf-guard'
import { isS3Configured, uploadImageBuffer } from '@/lib/server/storage/s3'

const checkUrlSafetyMock = checkUrlSafety as unknown as ReturnType<typeof vi.fn>
const isS3ConfiguredMock = isS3Configured as unknown as ReturnType<typeof vi.fn>
const uploadImageBufferMock = uploadImageBuffer as unknown as ReturnType<typeof vi.fn>

// ---- Helpers ----

/** Build a minimal TipTap doc containing one image node per passed src. */
function docWithImages(...srcs: string[]): TiptapContent {
  return {
    type: 'doc',
    content: srcs.map((src) => ({
      type: 'image',
      attrs: { src },
    })),
  } as unknown as TiptapContent
}

/** Build a Response-shaped mock for a successful image fetch. */
function okImageResponse(
  mime: string,
  bodyBytes: Buffer,
  options: { contentLength?: number | null } = {}
): Response {
  const headers = new Headers({ 'content-type': mime })
  if (options.contentLength !== null) {
    headers.set('content-length', String(options.contentLength ?? bodyBytes.length))
  }
  // Wrap in a ReadableStream so .body.getReader() works in test envs that
  // don't auto-streamify Buffer-backed Responses.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bodyBytes))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers,
  })
}

const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
])

const JPEG_HEADER = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])

// ---- Setup ----

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  isS3ConfiguredMock.mockReturnValue(true)
  uploadImageBufferMock.mockImplementation(async (_buf, _mime, prefix) => ({
    url: `https://cdn.example.com/${prefix}/rehosted-${Math.random().toString(36).slice(2, 8)}.png`,
  }))
  checkUrlSafetyMock.mockResolvedValue({ safe: true, address: '93.184.216.34', family: 4 })
})

// ---- Tests ----

describe('rehostExternalImages — happy paths', () => {
  it('rehosts a single external PNG', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/new.png',
    })

    const input = docWithImages('https://external.example.com/img.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]

    expect(node.attrs.src).toBe('https://cdn.example.com/post-images/new.png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(uploadImageBufferMock).toHaveBeenCalledTimes(1)
    expect(uploadImageBufferMock.mock.calls[0][2]).toBe('post-images')
  })

  it('rehosts multiple distinct external images', async () => {
    fetchMock
      .mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
      .mockResolvedValueOnce(okImageResponse('image/jpeg', JPEG_HEADER))
    uploadImageBufferMock
      .mockResolvedValueOnce({ url: 'https://cdn.example.com/post-images/a.png' })
      .mockResolvedValueOnce({ url: 'https://cdn.example.com/post-images/b.jpg' })

    const input = docWithImages(
      'https://external.example.com/a.png',
      'https://external.example.com/b.jpg'
    )
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const nodes = output.content as unknown as Array<{ attrs: { src: string } }>

    expect(nodes[0].attrs.src).toBe('https://cdn.example.com/post-images/a.png')
    expect(nodes[1].attrs.src).toBe('https://cdn.example.com/post-images/b.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('dedupes repeated URLs (one fetch, both nodes rewritten)', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/x.png',
    })

    const input = docWithImages(
      'https://external.example.com/same.png',
      'https://external.example.com/same.png'
    )
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const nodes = output.content as unknown as Array<{ attrs: { src: string } }>

    expect(nodes[0].attrs.src).toBe('https://cdn.example.com/post-images/x.png')
    expect(nodes[1].attrs.src).toBe('https://cdn.example.com/post-images/x.png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the right storage prefix per content type', async () => {
    const cases: Array<[Parameters<typeof rehostExternalImages>[1]['contentType'], string]> = [
      ['post', 'post-images'],
      ['changelog', 'changelog-images'],
      ['help-center', 'help-center'],
    ]

    for (const [contentType, prefix] of cases) {
      fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
      uploadImageBufferMock.mockResolvedValueOnce({
        url: `https://cdn.example.com/${prefix}/x.png`,
      })

      await rehostExternalImages(docWithImages('https://ex.example/a.png'), { contentType })
      const lastCall = uploadImageBufferMock.mock.calls.at(-1)!
      expect(lastCall[2]).toBe(prefix)
    }
  })

  it('skips same-origin URLs (workspace CDN already)', async () => {
    const input: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'https://cdn.example.com/post-images/existing.png' },
        },
      ],
    } as unknown as TiptapContent

    process.env.S3_PUBLIC_URL = 'https://cdn.example.com'

    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]

    expect(node.attrs.src).toBe('https://cdn.example.com/post-images/existing.png')
    expect(fetchMock).not.toHaveBeenCalled()

    delete process.env.S3_PUBLIC_URL
  })

  it('does not treat a prefix-matching attacker host as same-origin', async () => {
    // Attacker registers cdn.example.com.attacker.tld so the URL string
    // starts with the public URL's scheme+host prefix. A naive startsWith
    // check would skip the rehost and leave the attacker image embedded.
    process.env.S3_PUBLIC_URL = 'https://cdn.example.com'
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/rehosted.png',
    })

    const input = docWithImages('https://cdn.example.com.attacker.tld/evil.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]

    expect(node.attrs.src).toBe('https://cdn.example.com/post-images/rehosted.png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(uploadImageBufferMock).toHaveBeenCalledTimes(1)

    delete process.env.S3_PUBLIC_URL
  })

  it('handles a data-URI PNG', async () => {
    // 1x1 transparent PNG
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZUanaIAAAAASUVORK5CYII='
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/decoded.png',
    })

    const input = docWithImages(`data:image/png;base64,${base64}`)
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]

    expect(node.attrs.src).toBe('https://cdn.example.com/post-images/decoded.png')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(uploadImageBufferMock).toHaveBeenCalledTimes(1)
  })

  it('walks nested nodes (image inside a paragraph)', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/nested.png',
    })

    const input: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'image', attrs: { src: 'https://external.example.com/n.png' } },
          ],
        },
      ],
    } as unknown as TiptapContent

    const output = await rehostExternalImages(input, { contentType: 'post' })
    const paragraph = (
      output.content as unknown as Array<{ content: Array<{ attrs?: { src: string } }> }>
    )[0]
    expect(paragraph.content[1].attrs!.src).toBe('https://cdn.example.com/post-images/nested.png')
  })

  it('walks resizableImage nodes too', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/resized.png',
    })

    const input: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'resizableImage',
          attrs: { src: 'https://external.example.com/r.png', width: 500 },
        },
      ],
    } as unknown as TiptapContent

    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string; width: number } }>)[0]
    expect(node.attrs.src).toBe('https://cdn.example.com/post-images/resized.png')
    expect(node.attrs.width).toBe(500)
  })
})

describe('rehostExternalImages — rejections (fail-soft)', () => {
  it('rejects SVG data URIs', async () => {
    const input = docWithImages('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects an external SVG URL', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<svg></svg>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      })
    )

    const input = docWithImages('https://external.example.com/thing.svg')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/thing.svg')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects disallowed mime types (application/pdf)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('%PDF-1.4...', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    )

    const input = docWithImages('https://external.example.com/doc.pdf')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/doc.pdf')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects when content-length declares > 10MB', async () => {
    fetchMock.mockResolvedValueOnce(
      okImageResponse('image/png', PNG_HEADER, { contentLength: 20 * 1024 * 1024 })
    )

    const input = docWithImages('https://external.example.com/huge.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/huge.png')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects when header mime and sniffed bytes disagree', async () => {
    const lie = Buffer.from('PK\x03\x04...zip')
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(lie))
            controller.close()
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }
      )
    )

    const input = docWithImages('https://external.example.com/lie.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/lie.png')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects schemes other than http/https', async () => {
    checkUrlSafetyMock.mockResolvedValueOnce({ safe: false, reason: 'scheme-rejected' })

    const input = docWithImages('file:///etc/passwd')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('file:///etc/passwd')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects SSRF targets (private IP, cloud metadata, loopback)', async () => {
    checkUrlSafetyMock.mockResolvedValueOnce({ safe: false, reason: 'ssrf-rejected' })

    const input = docWithImages('https://attacker.example.com/img.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://attacker.example.com/img.png')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects redirect responses (302)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/payload' },
      })
    )

    const input = docWithImages('https://external.example.com/redir.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/redir.png')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects when fetch throws (timeout, network error)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('aborted'))

    const input = docWithImages('https://external.example.com/slow.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/slow.png')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects when S3 upload throws', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockRejectedValueOnce(new Error('S3 500'))

    const input = docWithImages('https://external.example.com/bad.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/bad.png')
  })

  it('aborts streaming read when body exceeds cap mid-stream (no content-length)', async () => {
    // No content-length header, body actually larger than MAX_BYTES
    const oversized = Buffer.alloc(11 * 1024 * 1024) // 11 MB > 10 MB cap
    // Put valid PNG header at the start so any pre-stream header check passes
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)

    const headers = new Headers({ 'content-type': 'image/png' })
    // Deliberately omit content-length
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(oversized))
        controller.close()
      },
    })
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200, headers }))

    const input = docWithImages('https://external.example.com/lying.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as unknown as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/lying.png')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('caps at 20 images per save (21st keeps external URL)', async () => {
    const urls = Array.from({ length: 21 }, (_, i) => `https://external.example.com/${i}.png`)
    // First 20 succeed
    for (let i = 0; i < 20; i++) {
      fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
      uploadImageBufferMock.mockResolvedValueOnce({
        url: `https://cdn.example.com/post-images/${i}.png`,
      })
    }

    const input = docWithImages(...urls)
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const nodes = output.content as unknown as Array<{ attrs: { src: string } }>

    for (let i = 0; i < 20; i++) {
      expect(nodes[i].attrs.src).toBe(`https://cdn.example.com/post-images/${i}.png`)
    }
    expect(nodes[20].attrs.src).toBe('https://external.example.com/20.png')
    expect(fetchMock).toHaveBeenCalledTimes(20)
  })
})

describe('rehostExternalImages — edge cases', () => {
  it('leaves non-image nodes untouched', async () => {
    const input: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] },
      ],
    } as unknown as TiptapContent

    const output = await rehostExternalImages(input, { contentType: 'post' })
    expect(output).toEqual(input)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns input unchanged when S3 is not configured', async () => {
    isS3ConfiguredMock.mockReturnValueOnce(false)
    const input = docWithImages('https://external.example.com/img.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    expect(output).toEqual(input)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not mutate the input tree', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/x.png',
    })

    const input = docWithImages('https://external.example.com/x.png')
    const snapshot = JSON.stringify(input)
    await rehostExternalImages(input, { contentType: 'post' })
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('returns input unchanged on an unexpected top-level error', async () => {
    // Force a throw inside the pipeline by corrupting the clone path
    const bad = null as unknown as TiptapContent
    const output = await rehostExternalImages(bad, { contentType: 'post' })
    expect(output).toBe(bad)
  })
})
