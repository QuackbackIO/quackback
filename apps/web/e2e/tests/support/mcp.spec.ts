/**
 * The MCP server's support tools (/api/mcp): conversations, tickets, files,
 * navigation, and how API keys and OAuth tokens reach them. Journeys
 * API-53..68 and ACC-25.
 *
 * OAuth callers use a token signed with the app's own keys for a person
 * (support/api-client.ts mcpOAuthToken); API-key callers use per-test keys.
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  INBOX_PERMISSIONS,
  apiFor,
  backingConversationOf,
  createKey,
  emailConversation,
  eventsFor,
  expectJson,
  fixture,
  mcpCall,
  mcpOAuthToken,
  mcpRpc,
  newTeammate,
  placeTicket,
  seedConv,
  seedCustomer,
  uuidOf,
  waitForEvent,
} from '../../support/api-client'

test.describe.configure({ timeout: 60_000 })

type Api = Awaited<ReturnType<typeof apiFor>>

const SUPPORT_TOOLS: Record<string, 'read:chat' | 'write:chat'> = {
  list_conversations: 'read:chat',
  get_conversation: 'read:chat',
  reply_to_conversation: 'write:chat',
  set_conversation_status: 'write:chat',
  suggest_post: 'write:chat',
  share_post: 'write:chat',
  list_tickets: 'read:chat',
  get_ticket: 'read:chat',
  create_ticket: 'write:chat',
  reply_to_ticket: 'write:chat',
  add_ticket_note: 'write:chat',
  link_ticket: 'write:chat',
  unlink_ticket: 'write:chat',
  upload_file: 'write:chat',
}

async function keyApi(
  playwright: Parameters<typeof apiFor>[0],
  baseURL: string | undefined,
  opts: Parameters<typeof createKey>[0]
): Promise<Api> {
  return apiFor(playwright, baseURL, createKey(opts).key)
}

async function restTicket(api: Api, data: Record<string, unknown>) {
  return (await expectJson(await api.post('/api/v1/tickets', { data }), 201)).data
}

test.describe('MCP auth', () => {
  test(
    'API-53 no token is 401 with the OAuth challenge; a key and an OAuth token resolve',
    { tag: '@core' },
    async ({ playwright, baseURL, people }) => {
      const anon = await apiFor(playwright, baseURL, null)
      const none = await mcpRpc(anon, 'tools/list')
      expect(none.status()).toBe(401)
      expect(none.headers()['www-authenticate']).toMatch(
        /^Bearer .*resource_metadata=".*\/\.well-known\/oauth-protected-resource"/
      )

      const badKey = await apiFor(playwright, baseURL, `qb_${'0'.repeat(48)}`)
      const bad = await mcpRpc(badKey, 'tools/list')
      expect(bad.status()).toBe(401)
      expect(bad.headers()['www-authenticate']).toContain('resource_metadata=')
      expect((await bad.json()).error).toEqual(expect.any(String))

      // A key resolves with its stored scopes: read-only lists, cannot write.
      const ro = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:chat'],
      })
      expect((await mcpCall(ro, 'list_conversations', { limit: 1 })).isError).toBe(false)
      const roWrite = await mcpCall(ro, 'set_conversation_status', {
        conversationId: generateId('conversation'),
        status: 'closed',
      })
      expect(roWrite).toMatchObject({
        isError: true,
        text: 'Error: Insufficient scope. Required: write:chat',
      })

      // An OAuth token resolves as the person: a reply is authored by them.
      const { conversationId } = await seedConv(`oauth ${Date.now()}`)
      const oauth = await apiFor(
        playwright,
        baseURL,
        mcpOAuthToken(people.people.admin.email, ['read:chat', 'write:chat'])
      )
      const reply = await mcpCall(oauth, 'reply_to_conversation', {
        conversationId,
        content: 'From OAuth',
      })
      expect(reply.isError, reply.text).toBe(false)
      const sql = supportDb()
      const [row] =
        await sql`SELECT principal_id FROM conversation_messages WHERE id = ${uuidOf(reply.json.id)}`
      expect(row.principal_id).toBe(uuidOf(people.people.admin.principalId))
      for (const api of [anon, badKey, ro, oauth]) await api.dispose()
    }
  )

  test(
    'API-66 each guard refuses with its message and is audited',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      // 1. Scope: a read-only key; an OAuth token gets an HTTP 403 step-up instead.
      const roKey = createKey({ creatorEmail: people.people.admin.email, scopes: ['read:chat'] })
      const ro = await apiFor(playwright, baseURL, roKey.key)
      const scope = await mcpCall(ro, 'reply_to_conversation', { conversationId, content: marker })
      expect(scope).toMatchObject({
        isError: true,
        text: 'Error: Insufficient scope. Required: write:chat',
      })
      const roOAuth = await apiFor(
        playwright,
        baseURL,
        mcpOAuthToken(people.people.admin.email, ['read:chat'])
      )
      const stepUp = await mcpRpc(roOAuth, 'tools/call', {
        name: 'reply_to_conversation',
        arguments: { conversationId, content: marker },
      })
      expect(stepUp.status()).toBe(403)
      expect(stepUp.headers()['www-authenticate']).toContain('error="insufficient_scope"')

      // 2. Team role: a portal customer's OAuth token (portal MCP access is a
      // workspace switch, off by default: turned on, never off).
      fixture({ op: 'enablePortalMcp' })
      const customer = await apiFor(
        playwright,
        baseURL,
        mcpOAuthToken(people.people.customer.email, ['read:chat'])
      )
      const role = await mcpCall(customer, 'list_tickets', {})
      expect(role).toMatchObject({
        isError: true,
        text: 'Error: This operation requires a team member (admin or member) role.',
      })

      // 3. Permission: a key whose creator lacks ticket.assign.
      const mate = newTeammate(
        `No assign ${marker}`,
        INBOX_PERMISSIONS.filter((p) => p !== 'ticket.assign')
      )
      const noAssignKey = createKey({ creatorEmail: mate.email })
      const noAssign = await apiFor(playwright, baseURL, noAssignKey.key)
      const perm = await mcpCall(noAssign, 'link_ticket', {
        trackerTicketId: generateId('ticket'),
        ticketId: generateId('ticket'),
      })
      expect(perm).toMatchObject({
        isError: true,
        text: "Error: This operation requires the 'ticket.assign' permission. Ask a workspace owner or an admin to grant it.",
      })

      // The key refusals are audited with their codes.
      const sql = supportDb()
      await expect
        .poll(async () => {
          const rows = await sql`SELECT credential_id, event_outcome, metadata FROM audit_log
          WHERE channel = 'mcp' AND credential_id IN (${roKey.id}, ${noAssignKey.id})`
          return rows
            .filter((r) => r.event_outcome === 'failure')
            .map((r) => JSON.stringify(r.metadata))
            .join(' ')
        })
        .toMatch(
          /INSUFFICIENT_SCOPE[\s\S]*MISSING_PERMISSION|MISSING_PERMISSION[\s\S]*INSUFFICIENT_SCOPE/
        )
      for (const api of [ro, roOAuth, customer, noAssign]) await api.dispose()
    }
  )

  test(
    'API-67 the tool listing advertises read:chat or write:chat per support tool',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const res = await mcpRpc(api, 'tools/list')
      const tools = (await expectJson(res, 200)).result.tools as Array<{
        name: string
        _meta?: { securitySchemes?: Array<{ type: string; scopes: string[] }> }
      }>
      for (const [name, scope] of Object.entries(SUPPORT_TOOLS)) {
        const tool = tools.find((t) => t.name === name)
        expect(tool, name).toBeTruthy()
        expect(tool!._meta?.securitySchemes, name).toEqual([{ type: 'oauth2', scopes: [scope] }])
      }
      await api.dispose()
    }
  )

  test(
    'API-68 navigate_workspace to conversations opens /admin/inbox and needs read:chat',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const ok = await mcpCall(api, 'navigate_workspace', { destination: 'conversations' })
      expect(ok.isError, ok.text).toBe(false)
      expect(ok.text).toContain('/admin/inbox')
      const feedbackOnly = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:feedback'],
      })
      const refused = await mcpCall(feedbackOnly, 'navigate_workspace', {
        destination: 'conversations',
      })
      expect(refused.isError).toBe(true)
      expect(refused.text).toContain('read:chat')
      const noView = newTeammate(`No view ${Date.now()}`, ['member.view'])
      const nv = await keyApi(playwright, baseURL, { creatorEmail: noView.email })
      const denied = await mcpCall(nv, 'navigate_workspace', { destination: 'conversations' })
      expect(denied.isError).toBe(true)
      expect(denied.text).toContain('conversation.view')
      for (const a of [api, feedbackOnly, nv]) await a.dispose()
    }
  )
})

test.describe('MCP conversations', () => {
  test(
    'API-54 list_conversations returns the compact shape and marks the subject untrusted',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const agent = newTeammate(`List ${marker}`, INBOX_PERMISSIONS)
      const older = await seedConv(`${marker} older`, {
        assigneePrincipalId: agent.principalId,
        ageMinutes: 2,
      })
      const newer = await seedConv(`${marker} newer`, { assigneePrincipalId: agent.principalId })
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const first = await mcpCall(api, 'list_conversations', {
        status: 'open',
        assignedAgentPrincipalId: agent.principalId,
        limit: 1,
      })
      expect(first.isError, first.text).toBe(false)
      expect(first.json.conversations).toHaveLength(1)
      expect(Object.keys(first.json.conversations[0]).sort()).toEqual(
        [
          'assignedAgentPrincipalId',
          'channel',
          'id',
          'lastMessageAt',
          'priority',
          'status',
          'subject',
          'visitorPrincipalId',
        ].sort()
      )
      expect(first.json.conversations[0].id).toBe(newer.conversationId)
      expect(first.json.hasMore).toBe(true)
      expect(JSON.stringify(first.json.untrusted)).toContain('conversations[].subject')
      const second = await mcpCall(api, 'list_conversations', {
        assignedAgentPrincipalId: agent.principalId,
        limit: 1,
        cursor: first.json.nextCursor,
      })
      expect(second.json.conversations.map((c: { id: string }) => c.id)).toEqual([
        older.conversationId,
      ])
      expect(second.json.hasMore).toBe(false)
      await api.dispose()
    }
  )

  test(
    'API-55 get_conversation: notes and assignment notices only with includeInternal',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, customerEmail, request }) => {
      const { conversationId } = await emailConversation(request, customerEmail, marker)
      const w = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      await expectJson(
        await w.post(`/api/v1/conversations/${conversationId}/note`, {
          data: { content: `Note ${marker}` },
        }),
        201
      )
      await expectJson(
        await w.post(`/api/v1/conversations/${conversationId}/assign`, {
          data: { assigneePrincipalId: people.people.agentB.principalId },
        }),
        200
      )
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const pub = await mcpCall(api, 'get_conversation', { conversationId })
      expect(pub.isError, pub.text).toBe(false)
      expect(pub.json.conversation).toMatchObject({
        id: conversationId,
        visitorEmail: customerEmail,
      })
      const contents = (r: typeof pub) => r.json.messages.map((m: { content: string }) => m.content)
      expect(contents(pub).some((c: string) => c.includes(marker))).toBe(true)
      expect(contents(pub)).not.toContain(`Note ${marker}`)
      expect(contents(pub).some((c: string) => c.startsWith('Conversation assigned to'))).toBe(
        false
      )
      for (const m of pub.json.messages) {
        expect(Object.keys(m)).toEqual(
          expect.arrayContaining([
            'id',
            'senderType',
            'isInternal',
            'authorName',
            'content',
            'createdAt',
          ])
        )
      }
      const untrusted = JSON.stringify(pub.json.untrusted)
      expect(untrusted).toContain('conversation.subject')
      expect(untrusted).toContain('conversation.visitorEmail')
      expect(untrusted).toMatch(/messages\[\d+\]\.content/)

      const all = await mcpCall(api, 'get_conversation', { conversationId, includeInternal: true })
      expect(contents(all)).toContain(`Note ${marker}`)
      expect(
        contents(all).some((c: string) =>
          c.startsWith(`Conversation assigned to ${people.people.agentB.displayName}`)
        )
      ).toBe(true)
      await api.dispose()
      await w.dispose()
    }
  )

  test(
    'API-56 ACC-25 get_conversation and get_ticket: missing or out of scope is not found',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const mate = newTeammate(`MCP scope ${marker}`, INBOX_PERMISSIONS, [people.teams.billing])
      const visible = await seedConv(`${marker} visible`, {
        teamId: people.teams.billing,
        ageMinutes: 1,
      })
      const hidden = await seedConv(`${marker} hidden`, { teamId: people.teams.support })
      const w = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const hiddenTicket = await restTicket(w, { type: 'back_office', title: `Hidden ${marker}` })
      await placeTicket(hiddenTicket.id, { teamId: people.teams.support })

      const api = await keyApi(playwright, baseURL, { creatorEmail: mate.email })
      for (const conversationId of [hidden.conversationId, generateId('conversation')]) {
        const res = await mcpCall(api, 'get_conversation', { conversationId })
        expect(res).toMatchObject({
          isError: true,
          text: 'Error: Conversation not found (code: CONVERSATION_NOT_FOUND)',
        })
      }
      expect(
        (await mcpCall(api, 'get_conversation', { conversationId: visible.conversationId })).isError
      ).toBe(false)
      for (const ticketId of [hiddenTicket.id, generateId('ticket')]) {
        const res = await mcpCall(api, 'get_ticket', { ticketId })
        expect(res).toMatchObject({
          isError: true,
          text: 'Error: Ticket not found (code: TICKET_NOT_FOUND)',
        })
      }

      // list_conversations omits the hidden one: walk newest first until the
      // visible (older) one shows up; the hidden (newer) would come first.
      const seen = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < 20 && !seen.has(visible.conversationId); page++) {
        const res = await mcpCall(api, 'list_conversations', {
          limit: 100,
          ...(cursor ? { cursor } : {}),
        })
        for (const c of res.json.conversations) seen.add(c.id)
        if (!res.json.hasMore) break
        cursor = res.json.nextCursor
      }
      expect(seen.has(visible.conversationId)).toBe(true)
      expect(seen.has(hidden.conversationId)).toBe(false)

      // The tool says what includeInternal adds.
      const listed = (await expectJson(await mcpRpc(api, 'tools/list'), 200)).result
        .tools as Array<{
        name: string
        inputSchema: { properties: Record<string, { description?: string }> }
      }>
      const get = listed.find((t) => t.name === 'get_conversation')!
      expect(get.inputSchema.properties.includeInternal.description).toContain('assignment notices')
      await api.dispose()
      await w.dispose()
    }
  )

  test(
    'API-57 reply_to_conversation: OAuth claims and fires conversation.assigned; a key does not',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const byKey = await seedConv(`${marker} key`)
      const byOAuth = await seedConv(`${marker} oauth`)
      const personal = createKey({ creatorEmail: people.people.admin.email })
      const keyApiCtx = await apiFor(playwright, baseURL, personal.key)
      const keyReply = await mcpCall(keyApiCtx, 'reply_to_conversation', {
        conversationId: byKey.conversationId,
        content: `**Key** ${marker}`,
      })
      expect(keyReply.isError, keyReply.text).toBe(false)
      expect(Object.keys(keyReply.json).sort()).toEqual([
        'conversationId',
        'createdAt',
        'id',
        'status',
      ])

      const oauth = await apiFor(
        playwright,
        baseURL,
        mcpOAuthToken(people.people.admin.email, ['read:chat', 'write:chat'])
      )
      const oauthReply = await mcpCall(oauth, 'reply_to_conversation', {
        conversationId: byOAuth.conversationId,
        content: `OAuth ${marker}`,
      })
      expect(oauthReply.isError, oauthReply.text).toBe(false)

      const sql = supportDb()
      const read = async (id: string) =>
        (
          await sql`SELECT assigned_agent_principal_id FROM conversations WHERE id = ${uuidOf(id)}`
        )[0].assigned_agent_principal_id
      expect(await read(byOAuth.conversationId)).toBe(uuidOf(people.people.admin.principalId))
      await waitForEvent(byOAuth.conversationId, 'conversation.assigned')
      expect(await read(byKey.conversationId)).toBeNull()
      expect(await eventsFor(byKey.conversationId, ['conversation.assigned'])).toEqual([])

      // Stored as plain text (no rich doc) and shown as the key's creator.
      const [msg] = await sql`SELECT content, content_json FROM conversation_messages
                            WHERE id = ${uuidOf(keyReply.json.id)}`
      expect(msg.content).toBe(`**Key** ${marker}`)
      expect(JSON.stringify(msg.content_json ?? '')).not.toContain('"bold"')
      const w = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const listed = await expectJson(
        await w.get(`/api/v1/conversations/${byKey.conversationId}/messages`),
        200
      )
      const reply = listed.data.find((m: { id: string }) => m.id === keyReply.json.id)
      expect(reply.authorName).toBe(people.people.admin.displayName)
      for (const a of [keyApiCtx, oauth, w]) await a.dispose()
    }
  )

  test(
    'API-58 set_conversation_status returns id and status and fires status_changed',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const first = await mcpCall(api, 'set_conversation_status', {
        conversationId,
        status: 'closed',
      })
      expect(first.json).toEqual({ id: conversationId, status: 'closed' })
      const [event] = await waitForEvent(conversationId, 'conversation.status_changed')
      expect(event.payload).toMatchObject({ previousStatus: 'open', newStatus: 'closed' })
      const again = await mcpCall(api, 'set_conversation_status', {
        conversationId,
        status: 'closed',
      })
      expect(again.json).toEqual({ id: conversationId, status: 'closed' })
      const tools = (await expectJson(await mcpRpc(api, 'tools/list'), 200)).result.tools as Array<{
        name: string
        annotations?: { idempotentHint?: boolean }
      }>
      expect(
        tools.find((t) => t.name === 'set_conversation_status')?.annotations?.idempotentHint
      ).toBe(true)
      // Pinned: whether a repeat close records a second event.
      await new Promise((r) => setTimeout(r, 1_000))
      const count = (await eventsFor(conversationId, ['conversation.status_changed'])).length
      test.info().annotations.push({ type: 'repeat close events', description: String(count) })
      expect(count).toBeGreaterThanOrEqual(1)
      await api.dispose()
    }
  )

  test(
    'API-59 suggest_post needs a resolved conversation and writes an internal card; share_post a public one',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { conversationId } = await seedConv(marker)
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const boards = await expectJson(await api.get('/api/v1/boards'), 200)
      const boardId = boards.data[0].id as string
      const args = { conversationId, boardId, title: `Track ${marker}`, content: 'From support' }

      const refused = await mcpCall(api, 'suggest_post', args)
      expect(refused.isError).toBe(true)
      expect(refused.text).toMatch(/resolved/i)

      await mcpCall(api, 'set_conversation_status', { conversationId, status: 'closed' })
      const suggested = await mcpCall(api, 'suggest_post', args)
      expect(suggested.isError, suggested.text).toBe(false)
      expect(suggested.json).toEqual({ messageId: expect.any(String), conversationId })
      const sql = supportDb()
      const [card] =
        await sql`SELECT is_internal FROM conversation_messages WHERE id = ${uuidOf(suggested.json.messageId)}`
      expect(card.is_internal).toBe(true)

      const post = await expectJson(
        await api.post('/api/v1/posts', {
          data: { boardId, title: `Post ${marker}`, content: 'x' },
        }),
        201
      )
      const shared = await mcpCall(api, 'share_post', { conversationId, postId: post.data.id })
      expect(shared.isError, shared.text).toBe(false)
      const [publicCard] =
        await sql`SELECT is_internal FROM conversation_messages WHERE id = ${uuidOf(shared.json.messageId)}`
      expect(publicCard.is_internal).toBe(false)
      await api.dispose()
    }
  )

  test(
    'API-65 upload_file returns a fileId usable in a reply; over 5 MB is refused; needs write:chat',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      test.setTimeout(90_000)
      const { conversationId } = await seedConv(marker)
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const upload = await mcpCall(api, 'upload_file', {
        name: `${marker}.txt`,
        contentBase64: Buffer.from(`hello ${marker}`).toString('base64'),
      })
      expect(upload.isError, upload.text).toBe(false)
      const fileId = (upload.json.fileId ?? upload.json.id) as string
      expect(fileId).toMatch(/^file_/)
      const reply = await mcpCall(api, 'reply_to_conversation', {
        conversationId,
        content: `With file ${marker}`,
        fileIds: [fileId],
      })
      expect(reply.isError, reply.text).toBe(false)
      const sql = supportDb()
      const [row] =
        await sql`SELECT attachments FROM conversation_messages WHERE id = ${uuidOf(reply.json.id)}`
      expect((row.attachments as Array<{ name: string }>)[0].name).toBe(`${marker}.txt`)

      // Over 5 MB decoded is refused. Its base64 body is over the transport's
      // 4 MiB request cap, so that cap answers first (413), before the tool's
      // own "File is too large" check can run.
      const big = await mcpRpc(api, 'tools/call', {
        name: 'upload_file',
        arguments: {
          name: 'big.bin',
          contentBase64: Buffer.alloc(5 * 1024 * 1024 + 10).toString('base64'),
        },
      })
      expect(big.status()).toBe(413)
      expect(await big.text()).toContain('Payload Too Large')

      const ro = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:chat'],
      })
      const noScope = await mcpCall(ro, 'upload_file', { name: 'a.txt', contentBase64: 'YQ==' })
      expect(noScope.text).toBe('Error: Insufficient scope. Required: write:chat')
      await api.dispose()
      await ro.dispose()
    }
  )
})

test.describe('MCP tickets', () => {
  test(
    'API-60 list_tickets returns the compact shape with inbox URLs',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const w = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })
      const ticket = await restTicket(w, {
        title: `List ${marker}`,
        requesterPrincipalId: customer.principalId,
      })
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const res = await mcpCall(api, 'list_tickets', {
        type: 'customer',
        statusCategory: 'open',
        requesterPrincipalId: customer.principalId,
      })
      expect(res.isError, res.text).toBe(false)
      expect(res.json.tickets).toHaveLength(1)
      const [t] = res.json.tickets
      expect(t).toMatchObject({
        id: ticket.id,
        url: `${baseURL}/admin/inbox?i=${ticket.id}`,
        type: 'customer',
        title: `List ${marker}`,
        statusCategory: 'open',
        requesterPrincipalId: customer.principalId,
      })
      expect(Object.keys(t)).toEqual(
        expect.arrayContaining([
          'number',
          'reference',
          'ticketType',
          'status',
          'stage',
          'priority',
          'updatedAt',
        ])
      )
      expect(res.json.nextCursor).toBeUndefined()
      expect(JSON.stringify(res.json.untrusted)).toContain('tickets[].title')
      await api.dispose()
      await w.dispose()
    }
  )

  test(
    'API-61 get_ticket returns first response, due date, messages with attachments and an oldest-id cursor',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const created = await mcpCall(api, 'create_ticket', {
        type: 'back_office',
        title: `Get ${marker}`,
      })
      const ticketId = created.json.id as string
      const upload = await mcpCall(api, 'upload_file', {
        name: `${marker}.txt`,
        contentBase64: Buffer.from('attached').toString('base64'),
      })
      const fileId = (upload.json.fileId ?? upload.json.id) as string
      await mcpCall(api, 'reply_to_ticket', { ticketId, content: `First ${marker}` })
      await mcpCall(api, 'reply_to_ticket', {
        ticketId,
        content: `Second ${marker}`,
        fileIds: [fileId],
      })
      const res = await mcpCall(api, 'get_ticket', { ticketId })
      expect(res.isError, res.text).toBe(false)
      expect(res.json.ticket).toMatchObject({ id: ticketId, title: `Get ${marker}` })
      expect(Object.keys(res.json.ticket)).toEqual(
        expect.arrayContaining(['firstResponseAt', 'dueAt'])
      )
      const withFile = res.json.messages.find((m: { content: string }) =>
        m.content.includes(`Second ${marker}`)
      )
      expect(withFile.content).toContain('Attachments:')
      expect(withFile.content).toContain(`${marker}.txt`)
      expect(res.json.nextCursor ?? null).toBe(res.json.hasMore ? res.json.messages[0].id : null)
      expect(JSON.stringify(res.json.untrusted)).toContain('ticket.title')
      await api.dispose()
    }
  )

  test(
    'API-62 create_ticket returns the compact ticket with a backing conversation',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const description = 'd'.repeat(6000) // over REST's 4000 characters, within MCP's 10000
      const res = await mcpCall(api, 'create_ticket', {
        type: 'customer',
        title: `MCP ${marker}`,
        description,
        requesterPrincipalId: customer.principalId,
      })
      expect(res.isError, res.text).toBe(false)
      expect(Object.keys(res.json).sort()).toEqual(
        ['id', 'number', 'priority', 'reference', 'stage', 'status', 'title', 'type'].sort()
      )
      expect(res.json).toMatchObject({ type: 'customer', title: `MCP ${marker}` })
      expect(await backingConversationOf(res.json.id)).toMatch(/^conversation_/)
      await waitForEvent(res.json.id, 'ticket.created')

      const ro = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:chat'],
      })
      const refused = await mcpCall(ro, 'create_ticket', { type: 'back_office', title: marker })
      expect(refused.text).toBe('Error: Insufficient scope. Required: write:chat')
      await api.dispose()
      await ro.dispose()
    }
  )

  test(
    'API-63 reply_to_ticket and add_ticket_note follow the REST redirect and note rules',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const created = await mcpCall(api, 'create_ticket', {
        type: 'customer',
        title: `Thread ${marker}`,
        requesterPrincipalId: customer.principalId,
      })
      const ticketId = created.json.id as string
      const conversationId = (await backingConversationOf(ticketId))!
      const reply = await mcpCall(api, 'reply_to_ticket', { ticketId, content: `Reply ${marker}` })
      expect(Object.keys(reply.json).sort()).toEqual(['createdAt', 'id', 'ticketId'])
      const note = await mcpCall(api, 'add_ticket_note', { ticketId, content: `Note ${marker}` })
      expect(Object.keys(note.json).sort()).toEqual(['createdAt', 'id', 'ticketId'])
      const sql = supportDb()
      const rows =
        await sql`SELECT id, conversation_id, ticket_id, is_internal FROM conversation_messages
                           WHERE id IN (${uuidOf(reply.json.id)}, ${uuidOf(note.json.id)})`
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
      // The reply lands on the linked conversation; the note stays on the ticket.
      expect(byId[uuidOf(reply.json.id)].conversation_id).toBe(uuidOf(conversationId))
      expect(byId[uuidOf(note.json.id)]).toMatchObject({ conversation_id: null, is_internal: true })
      await api.dispose()
    }
  )

  test(
    'API-63 reply_to_ticket and add_ticket_note take up to 10000 characters as advertised',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'The tools advertise content up to 10000 characters (mcp/tools/tickets.ts:328,371) but the shared message write refuses over 4000 (messages/message-core.ts:93).',
      },
    },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const created = await mcpCall(api, 'create_ticket', {
        type: 'back_office',
        title: `Long ${marker}`,
      })
      const ticketId = created.json.id as string
      for (const tool of ['reply_to_ticket', 'add_ticket_note']) {
        const res = await mcpCall(api, tool, { ticketId, content: 'x'.repeat(9000) })
        expect(res.isError, `${tool}: ${res.text}`).toBe(false)
      }
      await api.dispose()
    }
  )

  test(
    "API-64 link_ticket and unlink_ticket return the tracker's linked ids and need a tracker",
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const customer = await seedCustomer(`${marker}@customers.example`)
      const api = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const tracker = (
        await mcpCall(api, 'create_ticket', { type: 'tracker', title: `Tracker ${marker}` })
      ).json
      const other = (
        await mcpCall(api, 'create_ticket', { type: 'tracker', title: `Other ${marker}` })
      ).json
      const ticket = (
        await mcpCall(api, 'create_ticket', {
          type: 'customer',
          title: `Customer ${marker}`,
          requesterPrincipalId: customer.principalId,
        })
      ).json
      const linked = await mcpCall(api, 'link_ticket', {
        trackerTicketId: tracker.id,
        ticketId: ticket.id,
      })
      expect(linked.isError, linked.text).toBe(false)
      expect(linked.json).toEqual({ trackerTicketId: tracker.id, linkedTicketIds: [ticket.id] })
      const again = await mcpCall(api, 'link_ticket', {
        trackerTicketId: tracker.id,
        ticketId: ticket.id,
      })
      test.info().annotations.push({ type: 'link again', description: again.text })
      // A customer ticket belongs to at most one tracker.
      const second = await mcpCall(api, 'link_ticket', {
        trackerTicketId: other.id,
        ticketId: ticket.id,
      })
      expect(second.isError).toBe(true)
      // The tracker must be a tracker.
      const wrong = await mcpCall(api, 'link_ticket', {
        trackerTicketId: ticket.id,
        ticketId: tracker.id,
      })
      expect(wrong.isError).toBe(true)
      const unlinked = await mcpCall(api, 'unlink_ticket', {
        trackerTicketId: tracker.id,
        ticketId: ticket.id,
      })
      expect(unlinked.json).toEqual({ trackerTicketId: tracker.id, linkedTicketIds: [] })
      // Both tickets must be visible to the caller.
      const missing = await mcpCall(api, 'link_ticket', {
        trackerTicketId: tracker.id,
        ticketId: generateId('ticket'),
      })
      expect(missing.isError).toBe(true)
      expect(missing.text).toContain('not found')
      await api.dispose()
    }
  )
})
