/**
 * The MCP boards, tags, roadmaps and members resources answer a portal user's
 * OAuth token with what the portal shows that person: no team-only board,
 * internal tag or team roadmap, and no team roster. Teammates keep the full
 * lists.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostTagId,
  type PrincipalId,
  type RoadmapId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postTags, principal, roadmaps, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import type { McpAuthContext } from '../types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { registerResources } from '../server'

type ReadCallback = (uri: URL, ctx: unknown) => Promise<{ contents: Array<{ text: string }> }>

const fixture = await createDbTestFixture()

function resourcesFor(auth: McpAuthContext): Map<string, ReadCallback> {
  const reads = new Map<string, ReadCallback>()
  registerResources(
    {
      registerResource: (_name: string, uri: string, _meta: unknown, read: ReadCallback) => {
        reads.set(uri, read)
      },
    } as never,
    auth
  )
  return reads
}

async function read(auth: McpAuthContext, uri: string): Promise<string> {
  const result = await resourcesFor(auth).get(uri)!(new URL(uri), {})
  return result.contents[0].text
}

const tag = Math.random().toString(36).slice(2, 8)
let customer: McpAuthContext
let teammate: McpAuthContext

describe.skipIf(!fixture.available)('MCP resources read as the viewer (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    const teamUser = createId('user') as UserId
    const teamPrincipal = createId('principal') as PrincipalId
    const portalUser = createId('user') as UserId
    const portalPrincipal = createId('principal') as PrincipalId
    await testDb.insert(user).values([
      { id: teamUser, name: `Ada Admin ${tag}`, email: `ada-${tag}@example.com` },
      { id: portalUser, name: `Carl Customer ${tag}`, email: `carl-${tag}@example.com` },
    ])
    await testDb.insert(principal).values([
      { id: teamPrincipal, userId: teamUser, role: 'admin', type: 'user', createdAt: new Date() },
      {
        id: portalPrincipal,
        userId: portalUser,
        role: 'user',
        type: 'user',
        createdAt: new Date(),
      },
    ])
    await testDb.insert(boards).values([
      { id: createId('board') as BoardId, name: `Public ${tag}`, slug: `public-${tag}` },
      {
        id: createId('board') as BoardId,
        name: `Secret ${tag}`,
        slug: `secret-${tag}`,
        access: {
          ...DEFAULT_BOARD_ACCESS,
          view: 'team',
          vote: 'team',
          submit: 'team',
          comment: 'team',
        },
      },
    ])
    await testDb.insert(postTags).values([
      { id: createId('post_tag') as PostTagId, name: `open-tag-${tag}` },
      { id: createId('post_tag') as PostTagId, name: `internal-tag-${tag}`, isPublic: false },
    ])
    await testDb.insert(roadmaps).values([
      { id: createId('roadmap') as RoadmapId, name: `Public map ${tag}`, slug: `pub-${tag}` },
      {
        id: createId('roadmap') as RoadmapId,
        name: `Team map ${tag}`,
        slug: `team-${tag}`,
        visibility: 'team',
      },
    ])
    customer = {
      principalId: portalPrincipal,
      userId: portalUser,
      name: `Carl Customer ${tag}`,
      role: 'user',
      authMethod: 'oauth',
      scopes: ['read:feedback'],
    }
    teammate = {
      principalId: teamPrincipal,
      userId: teamUser,
      name: `Ada Admin ${tag}`,
      role: 'admin',
      authMethod: 'oauth',
      scopes: ['read:feedback'],
    }
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('lists only the boards the portal shows a portal user', async () => {
    const text = await read(customer, 'quackback://boards')
    expect(text).toContain(`public-${tag}`)
    expect(text).not.toContain(`secret-${tag}`)
  })

  it('lists only public tags to a portal user', async () => {
    const text = await read(customer, 'quackback://tags')
    expect(text).toContain(`open-tag-${tag}`)
    expect(text).not.toContain(`internal-tag-${tag}`)
  })

  it('lists only public roadmaps to a portal user', async () => {
    const text = await read(customer, 'quackback://roadmaps')
    expect(text).toContain(`Public map ${tag}`)
    expect(text).not.toContain(`Team map ${tag}`)
  })

  it('refuses the team roster to a portal user', async () => {
    const text = await read(customer, 'quackback://members')
    expect(text).not.toContain(`Ada Admin ${tag}`)
    expect(text).toBe('Error: This resource requires a team member (admin or member) role.')
  })

  it('keeps the full lists for a teammate', async () => {
    expect(await read(teammate, 'quackback://boards')).toContain(`secret-${tag}`)
    expect(await read(teammate, 'quackback://tags')).toContain(`internal-tag-${tag}`)
    expect(await read(teammate, 'quackback://roadmaps')).toContain(`Team map ${tag}`)
    expect(await read(teammate, 'quackback://members')).toContain(`Ada Admin ${tag}`)
  })
})
