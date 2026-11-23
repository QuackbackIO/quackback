/**
 * MCP feedback tools and resources (/api/mcp): step-up on a feedback write,
 * the quackback:// resources, search and get_details on posts, the post,
 * vote, comment and merge-suggestion tools.
 *
 * Journeys: API-M-13, API-M-33, API-M-34, API-M-37, API-M-40, API-M-41,
 * API-M-44, API-M-45, API-M-46, API-M-49, API-M-52, API-M-53, API-M-55,
 * API-M-56, API-M-58, API-M-60, API-M-61, API-M-66.
 *
 * Callers: the worker's admin workspace key, fresh keys of teammates made
 * with exactly the permissions a journey needs, and OAuth tokens signed with
 * the app's own keys (support/api-client.ts mcpOAuthToken). Portal-user OAuth
 * needs portal MCP access on (fixture enablePortalMcp, which only turns it on).
 */
import { fromUuid, generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { waitForMail } from '../../support/mailpit'
import { fixture, mcpCall, mcpRpc, newTeammate, seedCustomer } from '../../support/api-client'
import {
  ALL_SCOPES,
  activityOf,
  adminApi,
  eventTypes,
  expectToolError,
  keyApi,
  newBoard,
  newComment,
  newPost,
  newTag,
  oauthApi,
  postRow,
  rawRpc,
  readResource,
  seedSuggestion,
  setBoardAccess,
  statusId,
  suggestionRow,
  toolAudit,
  toolCallMsg,
  uuid,
  waitForAudit,
  waitForEventType,
} from '../../product/mcp'

test.describe.configure({ timeout: 60_000 })

const TEAM_ROLE_ERROR = 'Error: This operation requires a team member (admin or member) role.'
const permissionError = (perm: string) =>
  `Error: This operation requires the '${perm}' permission. Ask a workspace owner or an admin to grant it.`

/** Permissions a teammate needs to run the feedback tools a journey does not narrow. */
const FEEDBACK_PERMS = [
  'post.view_private',
  'post.create',
  'post.set_status',
  'post.set_tags',
  'post.set_owner',
  'post.vote_on_behalf',
  'post.merge',
  'post.delete',
  'comment.moderate',
  'member.view',
]

test.describe('MCP feedback writes need write:feedback', () => {
  test(
    'API-M-13 an OAuth token without write:feedback is stepped up on create_post and nothing is created',
    { tag: '@smoke' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const oauth = await oauthApi(playwright, baseURL, people.people.admin.email, [
        'read:feedback',
      ])

      const res = await rawRpc(
        oauth,
        toolCallMsg('create_post', { boardId: board.id, title: `${marker} stepped up` })
      )

      const description =
        'This connection is not allowed to make changes to Feedback (missing scope: write:feedback). Reconnect and choose Full access to allow it.'
      const header =
        `Bearer error="insufficient_scope", error_description="${description}", ` +
        `scope="read:feedback write:feedback", ` +
        `resource_metadata="${baseURL}/.well-known/oauth-protected-resource"`
      expect(res.status, JSON.stringify(res.body)).toBe(403)
      expect(res.headers['www-authenticate']).toBe(header)
      expect(res.body.error).toBeUndefined()
      expect(res.body.result).toEqual({
        content: [{ type: 'text', text: description }],
        isError: true,
        _meta: { 'mcp/www_authenticate': [header] },
      })
      const rows = await supportDb()`SELECT id FROM posts WHERE board_id = ${uuid(board.id)}`
      expect(rows).toHaveLength(0)
    }
  )
})

test.describe('MCP resources', () => {
  test(
    'API-M-33 teammates read the boards, statuses, tags, roadmaps and members resources',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const gone = await newBoard(admin, marker, 'gone')
      expect((await admin.delete(`/api/v1/boards/${gone.id}`)).status()).toBeLessThan(300)
      const tag = await newTag(admin, `${marker} tag`)
      const roadmap = (
        await (
          await admin.post('/api/v1/roadmaps', {
            data: { name: `${marker} roadmap`, slug: `${marker}-rm`.slice(0, 100) },
          })
        ).json()
      ).data

      const list = await mcpRpc(admin, 'resources/list')
      const listed = (await list.json()).result.resources.map((r: { uri: string }) => r.uri)
      expect(listed.sort()).toEqual(
        [
          'quackback://boards',
          'quackback://help-center/categories',
          'quackback://members',
          'quackback://roadmaps',
          'quackback://statuses',
          'quackback://tags',
        ].sort()
      )

      const boards = await readResource(admin, 'quackback://boards')
      expect(boards.mimeType).toBe('application/json')
      expect(boards.json).toContainEqual({ id: board.id, name: board.name, slug: board.slug })
      expect(boards.json.map((b: { id: string }) => b.id)).not.toContain(gone.id)

      const statuses = await readResource(admin, 'quackback://statuses')
      expect(statuses.json).toContainEqual({
        id: await statusId('planned'),
        name: 'Planned',
        slug: 'planned',
        color: expect.any(String),
      })
      // Active statuses first, then complete, then closed.
      const slugs: string[] = statuses.json.map((s: { slug: string }) => s.slug)
      expect(slugs.indexOf('in_progress')).toBeLessThan(slugs.indexOf('complete'))
      expect(slugs.indexOf('complete')).toBeLessThan(slugs.indexOf('closed'))

      const tags = await readResource(admin, 'quackback://tags')
      expect(tags.json).toContainEqual({ id: tag.id, name: tag.name, color: expect.any(String) })

      const roadmaps = await readResource(admin, 'quackback://roadmaps')
      expect(roadmaps.json).toContainEqual({
        id: roadmap.id,
        name: roadmap.name,
        slug: roadmap.slug,
      })

      const members = await readResource(admin, 'quackback://members')
      const me = members.json.find((m: { id: string }) => m.id === people.people.admin.principalId)
      expect(me).toEqual({ id: people.people.admin.principalId, name: 'Ada Admin', role: 'admin' })
    }
  )

  test(
    "API-M-34 a portal user's OAuth token does not read team-only boards, internal tags, team roadmaps or the team roster",
    {
      tag: '@core',
    },
    async ({ playwright, baseURL, people, marker }) => {
      fixture({ op: 'enablePortalMcp' })
      const admin = await adminApi(playwright, baseURL, people)
      const secret = await newBoard(admin, marker, 'team only')
      await setBoardAccess(secret.id, {
        view: 'team',
        vote: 'team',
        submit: 'team',
        comment: 'team',
      })
      const internal = await newTag(admin, `${marker} internal`, false)
      const teamRoadmap = await admin.post('/api/v1/roadmaps', {
        data: { name: `${marker} team roadmap`, slug: `${marker}-trm`, visibility: 'team' },
      })
      expect(teamRoadmap.status(), await teamRoadmap.text()).toBe(201)
      const customer = await seedCustomer(`${marker}@customers.example`, `Customer ${marker}`)
      const portal = await oauthApi(playwright, baseURL, `${marker}@customers.example`, [
        'read:feedback',
      ])

      const boards = await readResource(portal, 'quackback://boards')
      const tags = await readResource(portal, 'quackback://tags')
      const roadmaps = await readResource(portal, 'quackback://roadmaps')
      const members = await readResource(portal, 'quackback://members')
      expect(customer.principalId).toMatch(/^principal_/)
      expect(boards.text).not.toContain(secret.slug)
      expect(tags.text).not.toContain(internal.name)
      expect(roadmaps.text).not.toContain(`${marker} team roadmap`)
      expect(members.text).not.toContain('Ada Admin')
    }
  )
})

test.describe('MCP search and get_details on posts', () => {
  test(
    'API-M-37 search posts returns the compact shape with section links, without test-customer posts or an audit row',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const tag = await newTag(admin, `${marker} t`)
      const real = await newPost(admin, board.id, `${marker} real post`, { tagIds: [tag.id] })
      // A teammate's test customer (one per teammate) authors the second post.
      const owner = newTeammate(`${marker} owner`, ['member.view'])
      const testCustomer = fromUuid('principal', uuid(generateId('principal')))
      await supportDb()`
        INSERT INTO principal (id, user_id, role, type, display_name, created_at, test_owner_principal_id)
        VALUES (${uuid(testCustomer)}, NULL, 'user', 'anonymous', 'Test customer', NOW(),
                ${uuid(owner.principalId)})`
      const testPost = await newPost(admin, board.id, `${marker} test post`, {
        authorPrincipalId: testCustomer,
      })
      const reader = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
      })

      const res = await mcpCall(reader.api, 'search', { query: marker })
      expect(res.isError, res.text).toBe(false)
      expect(res.json.hasMore).toBe(false)
      expect(res.json.nextCursor).toBeNull()
      const ids = res.json.posts.map((p: { id: string }) => p.id)
      expect(ids).toEqual([real.id])
      expect(ids).not.toContain(testPost.id)
      const [hit] = res.json.posts
      expect(Object.keys(hit).sort()).toEqual(
        [
          'id',
          'title',
          'url',
          'excerpt',
          'voteCount',
          'commentCount',
          'boardId',
          'boardName',
          'statusId',
          'authorName',
          'ownerPrincipalId',
          'tags',
          'summary',
          'canonicalPostId',
          'isCommentsLocked',
          'createdAt',
          'deletedAt',
        ].sort()
      )
      expect(hit).toMatchObject({
        title: `${marker} real post`,
        excerpt: `${marker} real post body`,
        boardId: board.id,
        boardName: board.name,
        voteCount: 1,
        commentCount: 0,
        tags: [{ id: tag.id, name: tag.name }],
        canonicalPostId: null,
        deletedAt: null,
      })
      expect(hit.url).toMatch(new RegExp(`^https?://[^/]+/b/${board.slug}/posts/${real.id}$`))
      // Reads are never audited.
      expect(await toolAudit({ tool: 'search', credentialId: reader.id })).toEqual([])
    }
  )

  test(
    'API-M-40 search and get_details are team-only and permission-gated',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      fixture({ op: 'enablePortalMcp' })
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} post`)
      const entry = (
        await (
          await admin.post('/api/v1/changelog', {
            data: { title: `${marker} entry`, content: 'notes' },
          })
        ).json()
      ).data
      await seedCustomer(`${marker}@customers.example`)
      const portal = await oauthApi(playwright, baseURL, `${marker}@customers.example`, [
        'read:feedback',
        'read:article',
      ])

      for (const [tool, args] of [
        ['search', {}],
        ['get_details', { id: post.id }],
        ['get_details', { id: entry.id }],
        ['search', { entity: 'articles' }],
      ] as const) {
        expectToolError(await mcpCall(portal, tool, args), TEAM_ROLE_ERROR)
      }

      const blind = newTeammate(`${marker} blind`, ['post.create', 'member.view'])
      const blindKey = await keyApi(playwright, baseURL, { creatorEmail: blind.email })
      expectToolError(
        await mcpCall(blindKey.api, 'search', {}),
        permissionError('post.view_private')
      )

      const noHc = newTeammate(`${marker} nohc`, ['post.view_private', 'member.view'])
      const noHcKey = await keyApi(playwright, baseURL, { creatorEmail: noHc.email })
      expectToolError(
        await mcpCall(noHcKey.api, 'search', { entity: 'articles' }),
        permissionError('help_center.manage')
      )
      // The same key reads posts.
      const ok = await mcpCall(noHcKey.api, 'search', { query: marker })
      expect(ok.isError, ok.text).toBe(false)
      expect(ok.json.posts.map((p: { id: string }) => p.id)).toEqual([post.id])
      // Refused reads are not audited.
      expect(await toolAudit({ tool: 'search', credentialId: blindKey.id })).toEqual([])
    }
  )

  test(
    'API-M-41 get_details on a post returns the full thread, private notes and merged duplicates included',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} canonical`)
      const dup = await newPost(admin, board.id, `${marker} duplicate`)
      const top = await newComment(admin, post.id, `${marker} public comment`)
      const reply = await newComment(admin, post.id, `${marker} reply`, { parentId: top.id })
      const note = await newComment(admin, post.id, `${marker} private note`, { isPrivate: true })
      await supportDb()`UPDATE posts SET pinned_comment_id = ${uuid(top.id)}, pinned_at = NOW()
                        WHERE id = ${uuid(post.id)}`
      const merged = await admin.post(`/api/v1/posts/${dup.id}/merge`, {
        data: { canonicalPostId: post.id },
      })
      expect(merged.status(), await merged.text()).toBe(200)

      const res = await mcpCall(admin, 'get_details', { id: post.id })
      expect(res.isError, res.text).toBe(false)
      const d = res.json
      expect(d).toMatchObject({
        id: post.id,
        title: `${marker} canonical`,
        content: `${marker} canonical body`,
        boardId: board.id,
        boardName: board.name,
        boardSlug: board.slug,
        canonicalPostId: null,
        deletedAt: null,
      })
      for (const key of [
        'voteCount',
        'commentCount',
        'statusId',
        'authorName',
        'ownerPrincipalId',
        'tags',
        'pinnedComment',
        'summaryJson',
        'isCommentsLocked',
        'mergedPosts',
        'createdAt',
        'updatedAt',
        'comments',
      ]) {
        expect(d, key).toHaveProperty(key)
      }
      expect(d.pinnedComment).toMatchObject({ id: top.id })
      expect(d.mergedPosts.map((p: { id: string }) => p.id)).toEqual([dup.id])
      const byId = new Map(d.comments.map((c: { id: string }) => [c.id, c]))
      expect(byId.get(top.id)).toMatchObject({ isPrivate: false })
      expect((byId.get(top.id) as { replies: { id: string }[] }).replies.map((r) => r.id)).toEqual([
        reply.id,
      ])
      expect(byId.get(note.id)).toMatchObject({ isPrivate: true })
    }
  )
})

test.describe('MCP post write tools', () => {
  test(
    'API-M-44 triage_post changes the status once: event, activity, subscriber email and audit; the same status again records nothing',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const email = `${marker}@customers.example`
      const customer = await seedCustomer(email, `Customer ${marker}`)
      const post = await newPost(admin, board.id, `${marker} subscribed post`, {
        authorPrincipalId: customer.principalId,
      })
      const inProgress = await statusId('in_progress')
      const oauth = await oauthApi(playwright, baseURL, people.people.admin.email, ALL_SCOPES)

      const res = await mcpCall(oauth, 'triage_post', { postId: post.id, statusId: inProgress })
      expect(res.isError, res.text).toBe(false)
      // The title is the customer's, so the result also names it untrusted.
      expect(Object.keys(res.json).sort()).toEqual(
        ['id', 'title', 'statusId', 'ownerPrincipalId', 'updatedAt', 'untrusted'].sort()
      )
      expect(res.json.untrusted.fields).toEqual(['title'])
      expect(res.json).toMatchObject({ id: post.id, statusId: inProgress })

      const [payload] = await waitForEventType(post.id, 'post.status_changed')
      expect(payload).toMatchObject({ previousStatus: 'Open', newStatus: 'In Progress' })
      // The activity row is written after the response, so wait for it.
      const statusActivity = async () =>
        (await activityOf(post.id)).filter((a) => a.type === 'status.changed')
      await expect.poll(async () => (await statusActivity()).length).toBe(1)
      const activity = await statusActivity()
      expect(activity[0].metadata).toMatchObject({
        fromName: 'Open',
        toName: 'In Progress',
        toSlug: 'in_progress',
        toColor: expect.any(String),
      })
      const mail = await waitForMail({ to: email, timeoutMs: 20_000 })
      expect(mail.Text ?? mail.HTML).toContain('In Progress')
      const [audit] = await waitForAudit({ tool: 'triage_post', targetId: post.id })
      expect(audit).toMatchObject({ event_outcome: 'success', channel: 'mcp' })

      const again = await mcpCall(oauth, 'triage_post', { postId: post.id, statusId: inProgress })
      expect(again.isError, again.text).toBe(false)
      await new Promise((r) => setTimeout(r, 1500))
      expect((await eventTypes(post.id)).filter((t) => t === 'post.status_changed')).toHaveLength(1)
      expect((await activityOf(post.id)).filter((a) => a.type === 'status.changed')).toHaveLength(1)
    }
  )

  test(
    'API-M-45 triage_post is refused field by field on the permission the field needs',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} triage`)
      const tag = await newTag(admin, `${marker} t`)
      const mate = newTeammate(
        `${marker} triager`,
        FEEDBACK_PERMS.filter((p) => p !== 'post.set_status')
      )
      const key = await keyApi(playwright, baseURL, { creatorEmail: mate.email })

      const denied = await mcpCall(key.api, 'triage_post', {
        postId: post.id,
        statusId: await statusId('planned'),
      })
      expectToolError(denied, permissionError('post.set_status'))
      const [audit] = await waitForAudit({ tool: 'triage_post', credentialId: key.id })
      expect(audit).toMatchObject({
        event_outcome: 'failure',
        metadata: { tool: 'triage_post', errorCode: 'MISSING_PERMISSION' },
      })
      expect((await postRow(post.id))?.status_id).toBe(uuid(post.statusId))

      const tagged = await mcpCall(key.api, 'triage_post', { postId: post.id, tagIds: [tag.id] })
      expect(tagged.isError, tagged.text).toBe(false)
      const tagRows = await supportDb()`SELECT tag_id FROM post_tag_assignments
                                        WHERE post_id = ${uuid(post.id)}`
      expect(tagRows.map((r) => r.tag_id)).toEqual([uuid(tag.id)])

      const before = await eventTypes(post.id)
      const nothing = await mcpCall(key.api, 'triage_post', { postId: post.id })
      expect(nothing.isError, nothing.text).toBe(false)
      expect(nothing.json).toMatchObject({ id: post.id, statusId: post.statusId })
      await new Promise((r) => setTimeout(r, 1000))
      expect(await eventTypes(post.id)).toEqual(before)
    }
  )

  test(
    'API-M-46 triage_post assigns the OAuth teammate for "me", another teammate by id, and unassigns with null',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} owner`)
      const oauth = await oauthApi(playwright, baseURL, people.people.agentB.email, ALL_SCOPES)

      const me = await mcpCall(oauth, 'triage_post', { postId: post.id, ownerPrincipalId: 'me' })
      expect(me.isError, me.text).toBe(false)
      expect(me.json.ownerPrincipalId).toBe(people.people.agentB.principalId)
      const [assigned] = await waitForEventType(post.id, 'post.owner_assigned')
      expect(assigned).toMatchObject({
        ownerPrincipalId: people.people.agentB.principalId,
        previousOwnerPrincipalId: null,
      })
      await expect
        .poll(async () => (await activityOf(post.id)).map((a) => a.type))
        .toContain('owner.assigned')

      const other = await mcpCall(oauth, 'triage_post', {
        postId: post.id,
        ownerPrincipalId: people.people.admin.principalId,
      })
      expect(other.json.ownerPrincipalId).toBe(people.people.admin.principalId)
      await expect
        .poll(async () => (await eventTypes(post.id)).filter((t) => t === 'post.owner_assigned'))
        .toHaveLength(2)

      const cleared = await mcpCall(oauth, 'triage_post', {
        postId: post.id,
        ownerPrincipalId: null,
      })
      expect(cleared.json.ownerPrincipalId).toBeNull()
      expect((await postRow(post.id))?.owner_principal_id).toBeNull()
      await expect
        .poll(async () => (await activityOf(post.id)).map((a) => a.type))
        .toContain('owner.unassigned')
      await new Promise((r) => setTimeout(r, 1000))
      expect((await eventTypes(post.id)).filter((t) => t === 'post.owner_assigned')).toHaveLength(2)
    }
  )

  test(
    'API-M-49 vote_post toggles the caller vote and announces only the vote',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} votes`)
      const oauth = await oauthApi(playwright, baseURL, people.people.agentB.email, ALL_SCOPES)

      const first = await mcpCall(oauth, 'vote_post', { postId: post.id })
      expect(first.json).toEqual({ postId: post.id, voted: true, voteCount: post.voteCount + 1 })
      await waitForEventType(post.id, 'post.voted')
      const votes =
        await supportDb()`SELECT principal_id FROM post_votes WHERE post_id = ${uuid(post.id)}`
      expect(votes.map((v) => v.principal_id)).toContain(uuid(people.people.agentB.principalId))

      const second = await mcpCall(oauth, 'vote_post', { postId: post.id })
      expect(second.json).toEqual({ postId: post.id, voted: false, voteCount: post.voteCount })
      await new Promise((r) => setTimeout(r, 1000))
      expect((await eventTypes(post.id)).filter((t) => t === 'post.voted')).toHaveLength(1)
    }
  )

  test(
    'API-M-52 proxy_vote adds and removes a vote on behalf of a person, past the board vote tier',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      fixture({ op: 'enablePortalMcp' })
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      await setBoardAccess(board.id, { vote: 'team' })
      const post = await newPost(admin, board.id, `${marker} proxy`)
      const voter = await seedCustomer(`${marker}@customers.example`)

      const add = await mcpCall(admin, 'proxy_vote', {
        postId: post.id,
        voterPrincipalId: voter.principalId,
        sourceType: 'slack',
        sourceExternalUrl: 'https://slack.example/archives/1',
      })
      expect(add.json).toEqual({
        postId: post.id,
        voterPrincipalId: voter.principalId,
        voted: true,
        voteCount: post.voteCount + 1,
      })
      const [vote] = await supportDb()`SELECT source_type, source_external_url FROM post_votes
        WHERE post_id = ${uuid(post.id)} AND principal_id = ${uuid(voter.principalId)}`
      expect(vote).toEqual({
        source_type: 'slack',
        source_external_url: 'https://slack.example/archives/1',
      })
      await expect
        .poll(async () => (await activityOf(post.id)).filter((a) => a.type === 'vote.proxy'))
        .toEqual([expect.objectContaining({ metadata: { voterPrincipalId: voter.principalId } })])

      const again = await mcpCall(admin, 'proxy_vote', {
        postId: post.id,
        voterPrincipalId: voter.principalId,
      })
      expect(again.json).toMatchObject({ voted: false, voteCount: post.voteCount + 1 })

      const removed = await mcpCall(admin, 'proxy_vote', {
        action: 'remove',
        postId: post.id,
        voterPrincipalId: voter.principalId,
      })
      expect(removed.json).toMatchObject({ removed: true, voteCount: post.voteCount })
      await expect
        .poll(async () => (await activityOf(post.id)).map((a) => a.type))
        .toContain('vote.removed')
      expect((await activityOf(post.id)).filter((a) => a.type === 'vote.proxy')).toHaveLength(1)

      const mate = newTeammate(
        `${marker} nobehalf`,
        FEEDBACK_PERMS.filter((p) => p !== 'post.vote_on_behalf')
      )
      const key = await keyApi(playwright, baseURL, { creatorEmail: mate.email })
      expectToolError(
        await mcpCall(key.api, 'proxy_vote', {
          postId: post.id,
          voterPrincipalId: voter.principalId,
        }),
        permissionError('post.vote_on_behalf')
      )
      const portal = await oauthApi(playwright, baseURL, `${marker}@customers.example`, ALL_SCOPES)
      expectToolError(
        await mcpCall(portal, 'proxy_vote', {
          postId: post.id,
          voterPrincipalId: voter.principalId,
        }),
        TEAM_ROLE_ERROR
      )
    }
  )

  test(
    'API-M-53 create_post by a teammate: default status, author vote and subscription, event and audit',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const oauth = await oauthApi(playwright, baseURL, people.people.agentB.email, ALL_SCOPES)

      const res = await mcpCall(oauth, 'create_post', {
        boardId: board.id,
        title: `${marker} from mcp`,
        content: '## Heading\nSome **bold** text',
      })
      expect(res.isError, res.text).toBe(false)
      expect(Object.keys(res.json).sort()).toEqual(
        ['id', 'title', 'boardId', 'statusId', 'createdAt'].sort()
      )
      expect(res.json).toMatchObject({
        title: `${marker} from mcp`,
        boardId: board.id,
        statusId: await statusId('open'),
      })
      const id = res.json.id as string
      const row = await postRow(id)
      expect(row).toMatchObject({
        principal_id: uuid(people.people.agentB.principalId),
        vote_count: 1,
        moderation_state: 'published',
      })
      const subs =
        await supportDb()`SELECT principal_id FROM post_subscriptions WHERE post_id = ${uuid(id)}`
      expect(subs.map((s) => s.principal_id)).toContain(uuid(people.people.agentB.principalId))
      await waitForEventType(id, 'post.created')
      // The audit target is the call's first TypeID argument (tool-call-audit.ts
      // mcpToolTarget), here the board.
      const [audit] = await waitForAudit({ tool: 'create_post', targetId: board.id })
      expect(audit).toMatchObject({ event_outcome: 'success', auth_method: 'oauth' })
    }
  )

  test(
    'API-M-55 a portal user cannot create_post on a board whose submit tier is team-only',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      fixture({ op: 'enablePortalMcp' })
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      await setBoardAccess(board.id, { submit: 'team' })
      await seedCustomer(`${marker}@customers.example`)
      const portal = await oauthApi(playwright, baseURL, `${marker}@customers.example`, ALL_SCOPES)

      const res = await mcpCall(portal, 'create_post', { boardId: board.id, title: `${marker} p` })
      expectToolError(res, /\(code: POST_CREATE_DENIED\)$/)
      const rows = await supportDb()`SELECT id FROM posts WHERE board_id = ${uuid(board.id)}`
      expect(rows).toHaveLength(0)
    }
  )

  test(
    "API-M-55 a portal user's create_post takes the board default status and no tags",
    {
      tag: '@core',
    },
    async ({ playwright, baseURL, people, marker }) => {
      fixture({ op: 'enablePortalMcp' })
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const internal = await newTag(admin, `${marker} internal`, false)
      await seedCustomer(`${marker}@customers.example`)
      const portal = await oauthApi(playwright, baseURL, `${marker}@customers.example`, ALL_SCOPES)

      const res = await mcpCall(portal, 'create_post', {
        boardId: board.id,
        title: `${marker} chosen status`,
        statusId: await statusId('complete'),
        tagIds: [internal.id],
      })
      expect(res.isError, res.text).toBe(false)
      const id = res.json.id as string
      expect((await postRow(id))?.status_id).toBe(uuid(await statusId('open')))
      const tags = await supportDb()`SELECT 1 FROM post_tag_assignments WHERE post_id = ${uuid(id)}`
      expect(tags).toHaveLength(0)
    }
  )

  test(
    'API-M-56 merge_post folds a duplicate into its canonical post and unmerge_post restores it',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const canonical = await newPost(admin, board.id, `${marker} canonical`)
      const dup = await newPost(admin, board.id, `${marker} duplicate`)
      const voter = await seedCustomer(`${marker}@customers.example`)
      await mcpCall(admin, 'proxy_vote', { postId: dup.id, voterPrincipalId: voter.principalId })

      const merged = await mcpCall(admin, 'merge_post', {
        duplicatePostId: dup.id,
        canonicalPostId: canonical.id,
      })
      expect(merged.isError, merged.text).toBe(false)
      expect(merged.json.canonicalPost).toMatchObject({ id: canonical.id })
      expect(merged.json.duplicatePost).toMatchObject({ id: dup.id })
      expect(merged.json.canonicalPost.voteCount).toBeGreaterThan(canonical.voteCount)
      expect((await postRow(dup.id))?.canonical_post_id).toBe(uuid(canonical.id))
      await waitForEventType(dup.id, 'post.merged')
      await expect.poll(async () => (await activityOf(canonical.id)).length).toBeGreaterThan(0)

      const unmerged = await mcpCall(admin, 'unmerge_post', { postId: dup.id })
      expect(unmerged.isError, unmerged.text).toBe(false)
      expect(unmerged.json.post).toMatchObject({ id: dup.id })
      expect(unmerged.json.canonicalPost).toMatchObject({ id: canonical.id })
      expect((await postRow(dup.id))?.canonical_post_id).toBeNull()
      expect((await postRow(canonical.id))?.vote_count).toBe(canonical.voteCount)
      await waitForEventType(dup.id, 'post.unmerged')

      const mate = newTeammate(
        `${marker} nomerge`,
        FEEDBACK_PERMS.filter((p) => p !== 'post.merge')
      )
      const key = await keyApi(playwright, baseURL, { creatorEmail: mate.email })
      expectToolError(
        await mcpCall(key.api, 'merge_post', {
          duplicatePostId: dup.id,
          canonicalPostId: canonical.id,
        }),
        permissionError('post.merge')
      )
    }
  )

  test(
    'API-M-58 delete_post and restore_post: soft delete, refusals, restore and the 30-day window',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} lifecycle`)
      const old = await newPost(admin, board.id, `${marker} too old`)

      const del = await mcpCall(admin, 'delete_post', { postId: post.id })
      expect(del.json).toEqual({ deleted: true, postId: post.id })
      expect((await postRow(post.id))?.deleted_at).not.toBeNull()
      await waitForEventType(post.id, 'post.deleted')
      const portalPage = await (
        await playwright.request.newContext({ baseURL })
      ).get(`/b/${board.slug}/posts/${post.id}`)
      expect(await portalPage.text()).not.toContain(`${marker} lifecycle`)

      expectToolError(
        await mcpCall(admin, 'delete_post', { postId: post.id }),
        'Error: Post has already been deleted (code: DELETE_NOT_ALLOWED)'
      )

      const restored = await mcpCall(admin, 'restore_post', { postId: post.id })
      expect(restored.json).toMatchObject({
        restored: true,
        postId: post.id,
        title: `${marker} lifecycle`,
      })
      expect((await postRow(post.id))?.deleted_at).toBeNull()
      await waitForEventType(post.id, 'post.restored')

      expectToolError(
        await mcpCall(admin, 'restore_post', { postId: post.id }),
        /Post is not deleted \(code: VALIDATION_ERROR\)$/
      )

      await mcpCall(admin, 'delete_post', { postId: old.id })
      await supportDb()`UPDATE posts SET deleted_at = NOW() - interval '31 days'
                        WHERE id = ${uuid(old.id)}`
      expectToolError(
        await mcpCall(admin, 'restore_post', { postId: old.id }),
        /Posts can only be restored within 30 days of deletion/
      )
      expect((await postRow(old.id))?.deleted_at).not.toBeNull()
    }
  )
})

test.describe('MCP comment tools', () => {
  test(
    'API-M-60 add_comment by a teammate counts, announces and emails the subscriber; replies stay on their post',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const email = `${marker}@customers.example`
      const customer = await seedCustomer(email, `Customer ${marker}`)
      const post = await newPost(admin, board.id, `${marker} thread`, {
        authorPrincipalId: customer.principalId,
      })
      const other = await newPost(admin, board.id, `${marker} other`)
      const customerComment = await newComment(admin, post.id, `${marker} customer says`, {
        authorPrincipalId: customer.principalId,
      })
      const before = Number((await postRow(post.id))?.comment_count)
      const oauth = await oauthApi(playwright, baseURL, people.people.agentB.email, ALL_SCOPES)

      const res = await mcpCall(oauth, 'add_comment', {
        postId: post.id,
        content: `${marker} team answer`,
      })
      expect(res.isError, res.text).toBe(false)
      expect(res.json).toMatchObject({
        postId: post.id,
        content: `${marker} team answer`,
        parentId: null,
        isPrivate: false,
        isTeamMember: true,
      })
      expect(Number((await postRow(post.id))?.comment_count)).toBe(before + 1)
      await waitForEventType(res.json.id, 'comment.created')
      const mail = await waitForMail({ to: email, timeoutMs: 20_000 })
      expect(mail.Text ?? mail.HTML).toContain(`${marker} team answer`)

      const reply = await mcpCall(oauth, 'add_comment', {
        postId: post.id,
        parentId: customerComment.id,
        content: `${marker} reply`,
      })
      expect(reply.json).toMatchObject({ parentId: customerComment.id })

      expectToolError(
        await mcpCall(oauth, 'add_comment', {
          postId: other.id,
          parentId: customerComment.id,
          content: `${marker} misplaced`,
        }),
        /Parent comment belongs to a different post \(code: VALIDATION_ERROR\)$/
      )
    }
  )

  test(
    'API-M-61 internal notes stay internal and a portal user cannot post or reply privately',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      fixture({ op: 'enablePortalMcp' })
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} notes`)
      const mate = newTeammate(`${marker} noter`, ['post.view_private', 'member.view'])
      const key = await keyApi(playwright, baseURL, { creatorEmail: mate.email })
      const before = Number((await postRow(post.id))?.comment_count)

      const note = await mcpCall(key.api, 'add_comment', {
        postId: post.id,
        content: `${marker} internal`,
        isPrivate: true,
      })
      expect(note.isError, note.text).toBe(false)
      expect(note.json.isPrivate).toBe(true)
      expect(Number((await postRow(post.id))?.comment_count)).toBe(before)

      await seedCustomer(`${marker}@customers.example`)
      const portal = await oauthApi(playwright, baseURL, `${marker}@customers.example`, ALL_SCOPES)
      const forbidden =
        /Only team members can post private comments \(code: PRIVATE_COMMENT_FORBIDDEN\)$/
      expectToolError(
        await mcpCall(portal, 'add_comment', {
          postId: post.id,
          parentId: note.json.id,
          content: `${marker} reply to note`,
        }),
        forbidden
      )
      expectToolError(
        await mcpCall(portal, 'add_comment', {
          postId: post.id,
          content: `${marker} my note`,
          isPrivate: true,
        }),
        forbidden
      )
      const rows = await supportDb()`SELECT id FROM post_comments WHERE post_id = ${uuid(post.id)}`
      expect(rows).toHaveLength(1)
    }
  )
})

test.describe('MCP merge suggestions', () => {
  test(
    'API-M-66 accept_suggestion merges, resolves the suggestion and dismisses its siblings; swapDirection merges the other way',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const pa = await newPost(admin, board.id, `${marker} A`)
      const pb = await newPost(admin, board.id, `${marker} B`)
      const pc = await newPost(admin, board.id, `${marker} C`)
      const s1 = await seedSuggestion(pa.id, pb.id)
      const s2 = await seedSuggestion(pa.id, pc.id)

      const res = await mcpCall(admin, 'accept_suggestion', { id: s1 })
      expect(res.json).toEqual({ accepted: true, id: s1 })
      expect((await postRow(pa.id))?.canonical_post_id).toBe(uuid(pb.id))
      expect((await suggestionRow(s1)).status).toBe('accepted')
      expect((await suggestionRow(s2)).status).toBe('dismissed')
      await waitForEventType(pa.id, 'post.merged')

      const pd = await newPost(admin, board.id, `${marker} D`)
      const pe = await newPost(admin, board.id, `${marker} E`)
      const s3 = await seedSuggestion(pd.id, pe.id)
      const swapped = await mcpCall(admin, 'accept_suggestion', { id: s3, swapDirection: true })
      expect(swapped.json).toEqual({ accepted: true, id: s3 })
      expect((await postRow(pe.id))?.canonical_post_id).toBe(uuid(pd.id))
      expect((await postRow(pd.id))?.canonical_post_id).toBeNull()
    }
  )
})
