import { describe, expect, it } from 'vitest'
import { isHostAttachmentName, resolveHostAttachment } from '../widget-host-attach'

const TABS = { messages: true }
const png = (bytes = 8) => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

describe('isHostAttachmentName', () => {
  it('accepts an ordinary file name', () => {
    expect(isHostAttachmentName('screenshot-1.png')).toBe(true)
    expect(isHostAttachmentName('รายงาน ปัญหา.webm')).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['too long', `${'a'.repeat(252)}.png`],
    ['a path', 'shots/one.png'],
    ['a Windows path', 'C:\\shots\\one.png'],
    ['a control character', `one${String.fromCharCode(0)}.png`],
    ['a newline', 'one\n.png'],
    ['padding', ' one.png'],
    ['only dots', '..'],
    ['not a string', 42],
  ])('refuses %s', (_label, name) => {
    expect(isHostAttachmentName(name)).toBe(false)
  })
})

describe('resolveHostAttachment', () => {
  it('turns the Blob into a named File for the composer', () => {
    const blob = png()
    const resolved = resolveHostAttachment(
      { requestId: 'att1', file: blob, name: 'shot.png' },
      TABS
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.requestId).toBe('att1')
    expect(resolved.file).toBeInstanceOf(File)
    expect(resolved.file.name).toBe('shot.png')
    expect(resolved.file.type).toBe('image/png')
    expect(resolved.file.size).toBe(blob.size)
  })

  it('refuses anything but exactly requestId, file and name', () => {
    const base = { requestId: 'att1', file: png(), name: 'shot.png' }
    expect(resolveHostAttachment({ ...base, extra: true }, TABS)).toEqual({
      ok: false,
      requestId: 'att1',
      error: 'ATTACHMENT_INVALID',
    })
    expect(resolveHostAttachment({ requestId: 'att1', file: png() }, TABS)).toMatchObject({
      ok: false,
      error: 'ATTACHMENT_INVALID',
    })
    expect(resolveHostAttachment(null, TABS)).toEqual({
      ok: false,
      requestId: null,
      error: 'ATTACHMENT_INVALID',
    })
  })

  it('refuses a missing or malformed request id without echoing it', () => {
    expect(resolveHostAttachment({ requestId: '../x', file: png(), name: 'a.png' }, TABS)).toEqual({
      ok: false,
      requestId: null,
      error: 'ATTACHMENT_INVALID',
    })
  })

  it('refuses a non-Blob, an empty Blob and a bad name', () => {
    for (const payload of [
      { requestId: 'a', file: 'bytes', name: 'a.png' },
      { requestId: 'a', file: new Blob([]), name: 'a.png' },
      { requestId: 'a', file: png(), name: 'dir/a.png' },
    ]) {
      expect(resolveHostAttachment(payload, TABS)).toMatchObject({
        ok: false,
        error: 'ATTACHMENT_INVALID',
      })
    }
  })

  it('is unavailable when the messenger is off', () => {
    expect(
      resolveHostAttachment({ requestId: 'a', file: png(), name: 'a.png' }, { messages: false })
    ).toEqual({ ok: false, requestId: 'a', error: 'ATTACHMENT_UNAVAILABLE' })
  })

  it('applies the per-family cap from the name: 25 MB for images, 100 MB for video', () => {
    const big = { size: 26 * 1024 * 1024, type: 'image/png' }
    const blob = new Blob([new Uint8Array(big.size)], { type: big.type })
    expect(
      resolveHostAttachment({ requestId: 'a', file: blob, name: 'a.png' }, TABS)
    ).toMatchObject({
      ok: false,
      error: 'ATTACHMENT_TOO_LARGE',
    })
    const video = new Blob([new Uint8Array(big.size)], { type: 'video/webm' })
    expect(resolveHostAttachment({ requestId: 'a', file: video, name: 'a.webm' }, TABS).ok).toBe(
      true
    )
  })
})
