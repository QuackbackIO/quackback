/**
 * The shared `/api/v1` write-route attachment schema. The documented flow is
 * upload-then-attach: `POST /files` first, then reference the result by
 * `fileId` on a reply/note/ticket body — the service rebuilds url/size/type
 * from the stored row in that case, so the wire schema must accept a
 * fileId-only attachment and must not require `url`/`size` for it. The legacy
 * trusted-URL shape (`url` + `size`, no `fileId`) still has to keep working.
 */
import { describe, expect, it } from 'vitest'
import { attachmentSchema, attachmentsSchema, toAttachments } from '../-write-validation'

describe('attachmentSchema', () => {
  it('accepts a fileId-only attachment, with no url or size', () => {
    const result = attachmentSchema.safeParse({ fileId: 'file_01h455vb4pex5vsknk084sn02q' })
    expect(result.success).toBe(true)
  })

  it('still accepts the legacy url + size shape with no fileId', () => {
    const result = attachmentSchema.safeParse({
      url: '/api/storage/files/a.png?read=sig',
      name: 'a.png',
      contentType: 'image/png',
      size: 1024,
    })
    expect(result.success).toBe(true)
  })

  it('rejects an attachment with neither fileId nor url', () => {
    const result = attachmentSchema.safeParse({ size: 10 })
    expect(result.success).toBe(false)
  })

  it('rejects a fileId that is not shaped like a file TypeID', () => {
    const result = attachmentSchema.safeParse({ fileId: 'post_01h455vb4pex5vsknk084sn02q' })
    expect(result.success).toBe(false)
  })
})

describe('toAttachments', () => {
  it('passes a fileId-only attachment through untouched for the service to resolve', () => {
    const parsed = attachmentsSchema.parse([{ fileId: 'file_01h455vb4pex5vsknk084sn02q' }])
    expect(toAttachments(parsed)).toEqual([{ fileId: 'file_01h455vb4pex5vsknk084sn02q' }])
  })

  it('returns undefined when no attachments were sent', () => {
    expect(toAttachments(undefined)).toBeUndefined()
  })
})
