/**
 * File upload for MCP callers: a stepping stone to the reply/note tools'
 * `fileIds`, not a file-management surface of its own. Gated the same as the
 * chat write tools (there is no separate attachment scope, and uploading is
 * only ever a step toward attaching to a conversation or ticket).
 */

import { PERMISSIONS } from '@/lib/shared/permissions'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpAuthContext } from '../types'
import { formatBytes } from '@/lib/shared/files/file-types'
import { registerTool, jsonResult, WRITE } from './helpers'

/**
 * Decoded-byte ceiling for an MCP upload. A base64 tool-call argument is part
 * of the request payload itself, so this stays well under any stored file's
 * own (larger) family cap. The REST upload route (POST /api/v1/files) is the
 * one for bigger files.
 */
export const MCP_UPLOAD_MAX_BYTES = 3 * 1024 * 1024

/**
 * Room for the JSON-RPC envelope around the base64 file: method, ids, the
 * file name (up to 255 characters) and JSON escaping.
 */
const MCP_REQUEST_ENVELOPE_BYTES = 64 * 1024

/**
 * The MCP endpoint's request body cap, sized from the upload limit so the
 * largest file upload_file accepts always fits once base64-encoded (4 bytes
 * per 3). A request bigger than this is refused before any tool runs; the
 * handler names the upload limit in that refusal.
 */
export const MCP_MAX_REQUEST_BYTES =
  Math.ceil(MCP_UPLOAD_MAX_BYTES / 3) * 4 + MCP_REQUEST_ENVELOPE_BYTES

const UPLOAD_LIMIT = formatBytes(MCP_UPLOAD_MAX_BYTES)

export function registerFileTools(server: McpServer, auth: McpAuthContext) {
  registerTool<{ name: string; contentBase64: string }>(server, auth, {
    name: 'upload_file',
    permissions: [PERMISSIONS.CONVERSATION_REPLY],
    description: `Upload a file (base64-encoded, max ${UPLOAD_LIMIT} decoded) so it can be attached to a conversation reply, ticket reply, or ticket note. Returns a fileId: pass it in fileIds on reply_to_conversation, reply_to_ticket, or add_ticket_note. For a larger file, upload it with the REST API (POST /api/v1/files) and pass its fileId the same way.

Example: upload_file({ name: "invoice.pdf", contentBase64: "JVBERi0xLjQK..." })`,
    schema: {
      name: z.string().min(1).max(255).describe('File name, including its extension'),
      contentBase64: z
        .string()
        .min(1)
        .describe(`File bytes, base64-encoded (max ${UPLOAD_LIMIT} decoded)`),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const bytes = Buffer.from(args.contentBase64, 'base64')
      if (bytes.byteLength > MCP_UPLOAD_MAX_BYTES) {
        throw new Error(
          `File is too large: ${formatBytes(bytes.byteLength)} decoded, max ${UPLOAD_LIMIT}. Upload larger files with the REST API (POST /api/v1/files).`
        )
      }
      const { storeFile } = await import('@/lib/server/domains/files/files.service')
      const row = await storeFile({
        bytes: new Uint8Array(bytes),
        name: args.name,
        source: 'api',
        uploadedById: auth.principalId,
        unverifiedSender: false,
      })
      return jsonResult({ fileId: row.id, name: row.name })
    },
  })
}
