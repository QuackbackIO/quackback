// @vitest-environment happy-dom
/**
 * uploadFile posts the raw file body (not multipart) via XMLHttpRequest, so a
 * caller gets real upload progress — fetch() reports none. XHR is replaced
 * with a fake that records what it was given and lets the test drive
 * progress/status/failure by hand.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkFileBeforeUpload, uploadFile, UploadError } from '../upload-file'

class FakeXHR {
  static instances: FakeXHR[] = []
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown = null
  status = 0
  responseText = ''
  upload = { onprogress: null as ((e: { loaded: number; total: number }) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  aborted = false

  constructor() {
    FakeXHR.instances.push(this)
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }
  send(body: unknown) {
    this.body = body
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
}

function lastXhr(): FakeXHR {
  const xhr = FakeXHR.instances.at(-1)
  if (!xhr) throw new Error('no XHR was constructed')
  return xhr
}

beforeEach(() => {
  FakeXHR.instances = []
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function file(name: string, size: number, type = 'text/plain'): File {
  const f = new File([new Uint8Array(Math.min(size, 16))], name, { type })
  if (size !== f.size) Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('uploadFile', () => {
  it('POSTs the raw body to <endpoint>?name=<name> with the file content type', async () => {
    const f = file('report.pdf', 10, 'application/pdf')
    const promise = uploadFile(f, { endpoint: '/api/upload/file' })
    const xhr = lastXhr()
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/upload/file?name=report.pdf')
    expect(xhr.headers['Content-Type']).toBe('application/pdf')
    expect(xhr.body).toBe(f)

    xhr.status = 201
    xhr.responseText = JSON.stringify({
      fileId: 'file_1',
      url: '/api/storage/files/report.pdf',
      name: 'report.pdf',
      contentType: 'application/pdf',
      size: 10,
      family: 'pdf',
    })
    xhr.onload?.()
    await expect(promise).resolves.toEqual({
      fileId: 'file_1',
      url: '/api/storage/files/report.pdf',
      name: 'report.pdf',
      contentType: 'application/pdf',
      size: 10,
      family: 'pdf',
    })
  })

  it('sends the extra headers it was given', async () => {
    const f = file('a.txt', 1, 'text/plain')
    void uploadFile(f, { endpoint: '/api/widget/files', headers: { Authorization: 'Bearer tok' } })
    expect(lastXhr().headers.Authorization).toBe('Bearer tok')
  })

  it('falls back to application/octet-stream when the file has no type', async () => {
    const f = file('data.bin', 1, '')
    void uploadFile(f, { endpoint: '/api/upload/file' })
    expect(lastXhr().headers['Content-Type']).toBe('application/octet-stream')
  })

  it('gives an unnamed pasted image a name with the right extension', async () => {
    const f = file('', 1, 'image/jpeg')
    void uploadFile(f, { endpoint: '/api/upload/file' })
    expect(lastXhr().url).toBe('/api/upload/file?name=pasted-image.jpg')
  })

  it('reports upload progress as it happens', async () => {
    const f = file('a.txt', 10, 'text/plain')
    const onProgress = vi.fn()
    const promise = uploadFile(f, { endpoint: '/api/upload/file', onProgress })
    const xhr = lastXhr()
    xhr.upload.onprogress?.({ loaded: 5, total: 10 })
    expect(onProgress).toHaveBeenCalledWith(0.5)
    xhr.status = 201
    xhr.responseText = JSON.stringify({
      fileId: 'file_1',
      url: '/u',
      name: 'a.txt',
      contentType: 'text/plain',
      size: 10,
      family: 'text',
    })
    xhr.onload?.()
    await promise
  })

  it('throws an UploadError carrying the server message and reason on a non-2xx response', async () => {
    const f = file('big.mov', 1, 'video/quicktime')
    const promise = uploadFile(f, { endpoint: '/api/upload/file' })
    const xhr = lastXhr()
    xhr.status = 413
    xhr.responseText = JSON.stringify({ error: 'Over 100 MB', reason: 'too_large' })
    xhr.onload?.()
    await expect(promise).rejects.toMatchObject({ message: 'Over 100 MB', reason: 'too_large' })
    await expect(promise.catch((e) => e)).resolves.toBeInstanceOf(UploadError)
  })

  it('maps a network failure to a short message with no reason', async () => {
    const f = file('a.txt', 1, 'text/plain')
    const promise = uploadFile(f, { endpoint: '/api/upload/file' })
    lastXhr().onerror?.()
    await expect(promise).rejects.toMatchObject({ message: 'Upload failed', reason: undefined })
  })

  it('reads the message out of a widget error response, which answers { error: { code, message } }', async () => {
    const f = file('a.png', 1, 'image/png')
    const promise = uploadFile(f, { endpoint: '/api/widget/files' })
    const xhr = lastXhr()
    xhr.status = 401
    xhr.responseText = JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Valid widget session required' } })
    xhr.onload?.()
    await expect(promise).rejects.toMatchObject({ message: 'Valid widget session required' })
  })

  it('never surfaces "[object Object]" when the error body is an object with no message', async () => {
    const f = file('a.png', 1, 'image/png')
    const promise = uploadFile(f, { endpoint: '/api/widget/files' })
    const xhr = lastXhr()
    xhr.status = 503
    xhr.responseText = JSON.stringify({ error: { code: 'WORKSPACE_UNAVAILABLE' } })
    xhr.onload?.()
    await expect(promise).rejects.toMatchObject({ message: 'Upload failed' })
  })

  it('maps a 429 to a rate-limited reason regardless of the body shape', async () => {
    const f = file('a.png', 1, 'image/png')
    const promise = uploadFile(f, { endpoint: '/api/widget/files' })
    const xhr = lastXhr()
    xhr.status = 429
    xhr.responseText = JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many uploads, slow down' } })
    xhr.onload?.()
    await expect(promise).rejects.toMatchObject({ reason: 'rate_limited' })
  })

  it('still reads a string error with a reason from the plain upload endpoint', async () => {
    const f = file('big.mov', 1, 'video/quicktime')
    const promise = uploadFile(f, { endpoint: '/api/upload/file' })
    const xhr = lastXhr()
    xhr.status = 415
    xhr.responseText = JSON.stringify({ error: "This file type can't be sent", reason: 'blocked' })
    xhr.onload?.()
    await expect(promise).rejects.toMatchObject({
      message: "This file type can't be sent",
      reason: 'blocked',
    })
  })

  it('aborts the underlying request and rejects with an AbortError when the signal aborts', async () => {
    const controller = new AbortController()
    const f = file('a.txt', 1, 'text/plain')
    const promise = uploadFile(f, { endpoint: '/api/upload/file', signal: controller.signal })
    const xhr = lastXhr()
    controller.abort()
    expect(xhr.aborted).toBe(true)
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('checkFileBeforeUpload', () => {
  it('rejects an empty file', () => {
    const f = file('empty.txt', 0, 'text/plain')
    expect(checkFileBeforeUpload(f)).toMatchObject({
      message: 'The file is empty',
      reason: 'empty',
    })
  })

  it('rejects a file over the generic 25 MB cap', () => {
    const f = file('huge.csv', 26 * 1024 * 1024, 'text/csv')
    expect(checkFileBeforeUpload(f)).toMatchObject({ message: 'Over 25 MB', reason: 'too_large' })
  })

  it('rejects a video over the 100 MB video cap', () => {
    const f = file('huge.mp4', 101 * 1024 * 1024, 'video/mp4')
    expect(checkFileBeforeUpload(f)).toMatchObject({ message: 'Over 100 MB', reason: 'too_large' })
  })

  it('allows a normal file through', () => {
    const f = file('notes.txt', 1024, 'text/plain')
    expect(checkFileBeforeUpload(f)).toBeNull()
  })
})
