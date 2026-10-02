import { describe, it, expect } from 'vitest'
import { conversationAttachmentSchema } from '../conversation'
import { ticketAttachmentSchema } from '../tickets'

// The server rebuilds a pipeline attachment from its file row by `fileId`. A
// schema that strips the key turns every upload into an unverified legacy
// attachment with no preview, so both wire shapes must carry it through.
const upload = {
  fileId: 'file_01h455vb4pex5vsknk084sn02q',
  url: '/api/storage/files/2026/10/x-a.pdf?read=sig&exp=1',
  name: 'a.pdf',
  contentType: 'application/pdf',
  size: 1302,
}

describe('attachment wire schemas', () => {
  it('keep the file id on a conversation attachment', () => {
    expect(conversationAttachmentSchema.parse(upload).fileId).toBe(upload.fileId)
  })
  it('keep the file id on a ticket attachment', () => {
    expect(ticketAttachmentSchema.parse(upload).fileId).toBe(upload.fileId)
  })
  it('still accept an attachment without one', () => {
    const { fileId: _omit, ...legacy } = upload
    expect(conversationAttachmentSchema.parse(legacy)).toEqual(legacy)
  })
  it('refuse an overlong file id', () => {
    expect(() =>
      conversationAttachmentSchema.parse({ ...upload, fileId: 'x'.repeat(200) })
    ).toThrow()
  })
})
