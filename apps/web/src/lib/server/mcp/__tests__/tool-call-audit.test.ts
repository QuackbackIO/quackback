/**
 * The MCP boundary audit: every tool call that is not read-only records one
 * `mcp.tool_call` row with the tool, its target and its outcome, attributed to
 * whatever boundary it runs under. Read-only calls record nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import type { PrincipalId, UserId } from '@quackback/ids'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { NotFoundError } from '@/lib/shared/errors'

vi.mock('@/lib/server/config', () => ({ config: { trustedProxyHops: 1 } }))

const mockInsertValues = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { insert: () => ({ values: (...args: unknown[]) => mockInsertValues(...args) }) },
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: vi.fn(async () => true),
}))

const mockLogError = vi.fn()
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (...args: unknown[]) => mockLogError(...args),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

const { registerTool, READ_ONLY, WRITE, jsonResult } = await import('../tools/helpers')
const { oauthClientAttribution, runWithAuditAttribution } =
  await import('@/lib/server/audit/attribution')

const PRINCIPAL = 'principal_01h455vb4pex5vsknk084sn02r' as PrincipalId
const USER = 'user_01h455vb4pex5vsknk084sn02s' as UserId
const POST_ID = 'post_01h455vb4pex5vsknk084sn02t'
const COMMENT_ID = 'post_comment_01h455vb4pex5vsknk084sn02v'

const AUTH = {
  principalId: PRINCIPAL,
  userId: USER,
  name: 'Jane Admin',
  email: 'jane@example.com',
  role: 'admin' as const,
  authMethod: 'oauth' as const,
  scopes: ['read:feedback' as const, 'write:feedback' as const],
}

const DESKTOP = oauthClientAttribution({
  clientId: 'client_desktop',
  clientName: 'Claude Desktop',
  principalId: PRINCIPAL,
})

type Callback = (args: unknown, extra?: unknown) => Promise<CallToolResult>

/** Register one tool on a fake server and hand back the wrapped callback. */
function register(
  def: Partial<Parameters<typeof registerTool>[2]> & { handler: () => Promise<CallToolResult> },
  auth = AUTH
) {
  let callback: Callback | undefined
  const server = {
    registerTool: (_n: string, _c: unknown, cb: Callback) => {
      callback = cb
    },
  }
  registerTool(
    server as never,
    auth as never,
    {
      name: 'add_comment',
      description: 'Add a comment',
      schema: { postId: z.string(), content: z.string() },
      annotations: WRITE,
      scope: 'write:feedback',
      permissions: 'none',
      ...def,
    } as never
  )
  return callback!
}

const extra = {
  requestInfo: {
    headers: { 'user-agent': 'claude-desktop/1.0', 'x-forwarded-for': '198.51.100.7' },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInsertValues.mockResolvedValue(undefined)
})

describe('MCP tool-call audit', () => {
  it('records a write once, as the client, for the user, naming the tool and its target', async () => {
    const call = register({ handler: async () => jsonResult({ id: COMMENT_ID }) })

    await runWithAuditAttribution(DESKTOP, () =>
      call({ postId: POST_ID, content: 'secret words never logged' }, extra)
    )

    expect(mockInsertValues).toHaveBeenCalledTimes(1)
    const row = mockInsertValues.mock.calls[0][0]
    expect(row).toMatchObject({
      eventType: 'mcp.tool_call',
      eventOutcome: 'success',
      actorUserId: USER,
      actorEmail: 'jane@example.com',
      actorRole: 'admin',
      actorType: 'user',
      authMethod: 'oauth',
      actorUserAgent: 'claude-desktop/1.0',
      channel: 'mcp',
      credentialKind: 'oauth_client',
      credentialId: 'client_desktop',
      clientName: 'Claude Desktop',
      onBehalfOfPrincipalId: PRINCIPAL,
      targetType: 'post',
      targetId: POST_ID,
      metadata: { tool: 'add_comment' },
    })
    expect(JSON.stringify(row)).not.toContain('secret words')
  })

  it('names the created resource when the call points at none', async () => {
    const call = register({
      name: 'create_post',
      schema: { title: z.string() },
      handler: async () => jsonResult({ id: POST_ID, title: 'New' }),
    })
    await runWithAuditAttribution(DESKTOP, () => call({ title: 'New' }, extra))
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      targetType: 'post',
      targetId: POST_ID,
      metadata: { tool: 'create_post' },
    })
  })

  it('records nothing for a read-only tool', async () => {
    const call = register({
      name: 'get_post_activity',
      annotations: READ_ONLY,
      scope: 'read:feedback',
      handler: async () => jsonResult({ items: [] }),
    })
    await runWithAuditAttribution(DESKTOP, () => call({ postId: POST_ID }, extra))
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('records a domain error as a failure with its code', async () => {
    const call = register({
      handler: async () => {
        throw new NotFoundError('POST_NOT_FOUND', 'Post not found')
      },
    })
    const result = await runWithAuditAttribution(DESKTOP, () =>
      call({ postId: POST_ID, content: 'x' }, extra)
    )
    expect(result.isError).toBe(true)
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      eventType: 'mcp.tool_call',
      eventOutcome: 'failure',
      metadata: { tool: 'add_comment', errorCode: 'POST_NOT_FOUND' },
    })
  })

  it('records a missing permission as a failure, and never runs the tool', async () => {
    const handler = vi.fn(async () => jsonResult({ id: COMMENT_ID }))
    const call = register({ handler, permissions: ['post.create'] as never }, {
      ...AUTH,
      permissions: new Set(),
    } as never)
    const result = await runWithAuditAttribution(DESKTOP, () =>
      call({ postId: POST_ID, content: 'x' }, extra)
    )
    expect(result.isError).toBe(true)
    expect(handler).not.toHaveBeenCalled()
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      eventOutcome: 'failure',
      metadata: { tool: 'add_comment', errorCode: 'MISSING_PERMISSION' },
    })
  })

  it('records a scope refusal as a failure', async () => {
    const call = register(
      { handler: async () => jsonResult({ ok: true }) },
      {
        ...AUTH,
        scopes: ['read:feedback'],
      }
    )
    await runWithAuditAttribution(DESKTOP, () => call({ postId: POST_ID, content: 'x' }, extra))
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      eventOutcome: 'failure',
      metadata: { tool: 'add_comment', errorCode: 'INSUFFICIENT_SCOPE' },
    })
  })

  it('records a tool that reports its own error as a failure', async () => {
    const call = register({
      handler: async () => ({ isError: true, content: [{ type: 'text', text: 'Error: nope' }] }),
    })
    await runWithAuditAttribution(DESKTOP, () => call({ postId: POST_ID, content: 'x' }, extra))
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      eventOutcome: 'failure',
      metadata: { tool: 'add_comment', errorCode: 'TOOL_ERROR' },
    })
  })

  it('returns the tool result even when the audit write fails', async () => {
    mockInsertValues.mockRejectedValue(new Error('audit_log is down'))
    const call = register({ handler: async () => jsonResult({ id: COMMENT_ID }) })
    const result = await runWithAuditAttribution(DESKTOP, () =>
      call({ postId: POST_ID, content: 'x' }, extra)
    )
    expect(result.isError).toBeUndefined()
    expect(mockLogError).toHaveBeenCalled()
  })

  it('attributes an in-process call to the boundary it runs under', async () => {
    // The assistant drives the same catalogue in-process for a teammate.
    const call = register({ handler: async () => jsonResult({ id: COMMENT_ID }) })
    await runWithAuditAttribution(
      { channel: 'assistant', clientName: 'Quinn', onBehalfOfPrincipalId: PRINCIPAL },
      () => call({ postId: POST_ID, content: 'x' })
    )
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      eventType: 'mcp.tool_call',
      channel: 'assistant',
      clientName: 'Quinn',
      onBehalfOfPrincipalId: PRINCIPAL,
      actorIp: null,
    })
  })
})
