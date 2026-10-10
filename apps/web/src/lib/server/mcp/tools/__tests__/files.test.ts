import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const mockStoreFile = vi.fn()
const mockToUploadedFile = vi.fn()

vi.mock('@/lib/server/domains/files/files.service', () => ({
  storeFile: (...a: unknown[]) => mockStoreFile(...a),
  toUploadedFile: (...a: unknown[]) => mockToUploadedFile(...a),
}))

import { registerFileTools } from '../files'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function collect(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerFileTools(fakeServer as never, auth)
  return handlers
}

function collectDescriptions(auth: McpAuthContext): Map<string, string> {
  const descriptions = new Map<string, string>()
  const fakeServer = {
    tool: (name: string, description: string) => {
      descriptions.set(name, description)
    },
  }
  registerFileTools(fakeServer as never, auth)
  return descriptions
}

const teamAuth = {
  principalId: 'principal_key',
  userId: 'user_1',
  name: 'Agent',
  email: 'agent@acme.com',
  role: 'admin' as const,
  authMethod: 'api-key' as const,
  scopes: ['read:chat', 'write:chat'],
} as unknown as McpAuthContext

const parse = (r: CallToolResult) => JSON.parse((r.content[0] as { text: string }).text)

beforeEach(() => vi.clearAllMocks())

describe('file MCP tools', () => {
  it('registers upload_file', () => {
    expect([...collect(teamAuth).keys()]).toEqual(['upload_file'])
  })

  it('stores the decoded bytes as an api-sourced, verified-sender file and returns fileId + name', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 fake pdf bytes')
    mockStoreFile.mockResolvedValue({ id: 'file_1', name: 'invoice.pdf' })
    mockToUploadedFile.mockReturnValue({
      fileId: 'file_1',
      url: '/api/storage/files/1?read=sig',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      size: bytes.byteLength,
      family: 'pdf',
    })

    const out = await collect(teamAuth).get('upload_file')!({
      name: 'invoice.pdf',
      contentBase64: Buffer.from(bytes).toString('base64'),
    })

    expect(mockStoreFile).toHaveBeenCalledWith({
      bytes: expect.anything(),
      name: 'invoice.pdf',
      source: 'api',
      uploadedById: 'principal_key',
      unverifiedSender: false,
    })
    const [[storeArgs]] = mockStoreFile.mock.calls
    expect(Buffer.from(storeArgs.bytes).toString()).toBe('%PDF-1.4 fake pdf bytes')
    expect(parse(out)).toEqual({ fileId: 'file_1', name: 'invoice.pdf' })
  })

  it('never uses an em dash in the upload_file description (public MCP docs)', () => {
    const description = collectDescriptions(teamAuth).get('upload_file')!
    expect(description).not.toContain('—')
  })

  it('rejects more than 5 MB decoded, with a clear message, before calling storeFile', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    const out = await collect(teamAuth).get('upload_file')!({
      name: 'big.bin',
      contentBase64: Buffer.from(big).toString('base64'),
    })

    expect(mockStoreFile).not.toHaveBeenCalled()
    expect(out.isError).toBe(true)
    const text = (out.content[0] as { text: string }).text.toLowerCase()
    expect(text).toContain('too large')
    expect(text).toContain('mb')
  })
})
