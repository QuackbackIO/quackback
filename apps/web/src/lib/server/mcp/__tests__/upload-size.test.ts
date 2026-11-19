/**
 * upload_file's documented size limit must fit through the MCP endpoint.
 * The file travels base64-encoded inside a JSON-RPC request, so the request
 * is about a third larger than the file. If the transport's request cap is
 * smaller than that, a file the tool says it accepts is refused with a 413
 * before the tool runs.
 *
 * Real SDK server and transport (built by the same factory the handler
 * uses) and the real upload_file registration; only storage is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const mockStoreFile = vi.fn()
vi.mock('@/lib/server/domains/files/files.service', () => ({
  storeFile: (...a: unknown[]) => mockStoreFile(...a),
}))

import { createMcpTransport } from '../transport'
import { registerFileTools, MCP_UPLOAD_MAX_BYTES } from '../tools/files'
import type { McpAuthContext } from '../types'

const teamAuth = {
  principalId: 'principal_key',
  userId: 'user_1',
  name: 'Agent',
  email: 'agent@acme.com',
  role: 'admin' as const,
  authMethod: 'api-key' as const,
  scopes: ['read:chat', 'write:chat'],
} as unknown as McpAuthContext

/** The longest file name upload_file accepts, so the envelope is as big as it gets. */
const LONGEST_NAME = `${'n'.repeat(251)}.bin`

async function callUpload(bytes: number): Promise<Response> {
  const server = new McpServer({ name: 'test', version: '1.0.0' })
  registerFileTools(server, teamAuth)
  const transport = createMcpTransport()
  await server.connect(transport)
  try {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'upload_file',
        arguments: {
          name: LONGEST_NAME,
          contentBase64: Buffer.alloc(bytes, 0x61).toString('base64'),
        },
      },
    })
    return await transport.handleRequest(
      new Request('https://example.com/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body,
      })
    )
  } finally {
    await transport.close()
    await server.close()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStoreFile.mockResolvedValue({ id: 'file_1', name: LONGEST_NAME })
})

describe('upload_file size limit', () => {
  it('a file at the documented limit reaches the tool and is stored', async () => {
    const response = await callUpload(MCP_UPLOAD_MAX_BYTES)

    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { isError?: boolean } }
    expect(body.result.isError).toBeFalsy()
    expect(mockStoreFile).toHaveBeenCalledOnce()
  })

  it('a file one byte over the limit gets the tool’s own clear error, not a 413', async () => {
    const response = await callUpload(MCP_UPLOAD_MAX_BYTES + 1)

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }> }
    }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('too large')
    expect(mockStoreFile).not.toHaveBeenCalled()
  })
})
