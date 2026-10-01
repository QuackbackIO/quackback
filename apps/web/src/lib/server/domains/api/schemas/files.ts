/**
 * Files API Schema Registrations
 *
 * One route, POST /files: upload a file (its raw bytes, not multipart) so it
 * can be attached by `fileId` to a conversation reply/note or a ticket. This
 * is the first step of the documented attachment flow — upload, then
 * reference the returned `fileId` on the write request body — which is why
 * the write schemas (conversations-write.ts, tickets-write.ts) point their
 * own attachment examples at the file this route returns rather than at an
 * arbitrary URL the server would refuse to trust.
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createItemResponseSchema } from '../openapi'
import { UnauthorizedErrorSchema, ValidationErrorSchema } from './common'

export const FileSchema = z.object({
  fileId: TypeIdSchema.meta({ example: 'file_01h455vb4pex5vsknk084sn02q' }),
  url: z.string().meta({
    description: 'Storage URL to attach by fileId; omit it and send fileId instead of url',
    example: '/api/storage/files/01h455vb4pex5vsknk084sn02q?read=eyJhbGciOiJIUzI1NiJ9',
  }),
  name: z.string().meta({ example: 'invoice.pdf' }),
  contentType: z.string().meta({ example: 'application/pdf' }),
  size: z.number().meta({ description: 'Size in bytes', example: 48213 }),
  family: z
    .string()
    .meta({ description: 'File family (image, pdf, document, ...)', example: 'pdf' }),
})

registerPath('/files', {
  post: {
    tags: ['Files'],
    summary: 'Upload a file',
    description:
      'Upload a file so it can be attached to a conversation reply, note, or ticket. ' +
      'Send the raw file bytes as the request body (not multipart/form-data) and the ' +
      'file name as the `name` query parameter. The response carries a `fileId` — ' +
      'attach it by setting `attachments: [{ fileId }]` on the reply/note/ticket request.',
    parameters: [
      {
        name: 'name',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'File name, including its extension',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/octet-stream': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    },
    responses: {
      201: {
        description: 'File uploaded',
        content: {
          'application/json': { schema: createItemResponseSchema(FileSchema, 'Uploaded file') },
        },
      },
      400: {
        description: 'Missing file name, or an empty body',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      413: {
        description: 'File too large for its type',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      415: {
        description: 'File type not allowed',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
    },
  },
})
