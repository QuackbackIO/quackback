/**
 * File upload for MCP callers: a stepping stone to the reply/note tools'
 * `fileIds`, not a file-management surface of its own. Gated the same as the
 * chat write tools (there is no separate attachment scope, and uploading is
 * only ever a step toward attaching to a conversation or ticket).
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpAuthContext } from '../types'
import { formatBytes } from '@/lib/shared/files/file-types'
import { registerTool, jsonResult, WRITE } from './helpers'

/**
 * Decoded-byte ceiling for an MCP upload. A base64 tool-call argument is part
 * of the request payload itself, so this stays well under any stored file's
 * own (larger) family cap — the API upload route is the one for bigger files.
 */
export const MCP_UPLOAD_MAX_BYTES = 5 * 1024 * 1024

export function registerFileTools(server: McpServer, auth: McpAuthContext) {
  registerTool<{ name: string; contentBase64: string }>(server, auth, {
    name: 'upload_file',
    description: `Upload a file (base64-encoded, max 5 MB decoded) so it can be attached to a conversation reply, ticket reply, or ticket note. Returns a fileId: pass it in fileIds on reply_to_conversation, reply_to_ticket, or add_ticket_note.

Example: upload_file({ name: "invoice.pdf", contentBase64: "JVBERi0xLjQK..." })`,
    schema: {
      name: z.string().min(1).max(255).describe('File name, including its extension'),
      contentBase64: z.string().min(1).describe('File bytes, base64-encoded (max 5 MB decoded)'),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const bytes = Buffer.from(args.contentBase64, 'base64')
      if (bytes.byteLength > MCP_UPLOAD_MAX_BYTES) {
        throw new Error(
          `File is too large: ${formatBytes(bytes.byteLength)} decoded, max ${formatBytes(MCP_UPLOAD_MAX_BYTES)}`
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
