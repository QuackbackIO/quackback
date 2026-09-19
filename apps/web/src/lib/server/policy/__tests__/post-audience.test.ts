/**
 * The post audience axis: `canViewPost` and `postViewFilter` over
 * `posts.audience`.
 *
 * Audience is deliberately NOT moderation. A pending post is visible to the
 * person who wrote it, because pending means "waiting for review", and review
 * can end in publication. An internal post is never visible to the person it
 * is attributed to, because internal means "team-only evidence about this
 * customer", and no later event turns it into something they may read. The two
 * axes therefore compose rather than collapse: the strictest of the two wins.
 *
 * The parity file (post-view-filter-parity.test.ts) proves the SQL predicate
 * and the in-memory decision agree row for row against a real database; this
 * file pins the decision itself, including the cases that file cannot seed
 * cheaply (a segment member, a service principal).
 */
import { describe, it, expect } from 'vitest'
import { canViewPost, postViewFilter, boardCapabilitiesForActor } from '../posts'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import { createId, type PrincipalId } from '@quackback/ids'
import type { BoardAccess, ModerationState, PostAudience } from '@/lib/server/db'
import { MODERATION_STATES, POST_AUDIENCES } from '@/lib/server/db'
import { PgDialect } from 'drizzle-orm/pg-core'

const CUSTOMER = 'p_customer' as PrincipalId

const admin: Actor = {
  principalId: 'p_admin' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}
const member: Actor = {
  principalId: 'p_member' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
}
/** The customer the internal post is attributed to. Authorship is not access. */
const author: Actor = {
  principalId: CUSTOMER,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}
const otherCustomer: Actor = {
  principalId: 'p_other' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}
const service: Actor = {
  principalId: 'p_svc' as PrincipalId,
  role: 'user',
  principalType: 'service',
  segmentIds: new Set(),
}

function publicAccess(): BoardAccess {
  return {
    view: 'anonymous',
    vote: 'anonymous',
    comment: 'anonymous',
    submit: 'anonymous',
    segments: { view: [], vote: [], comment: [], submit: [] },
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  }
}

const board = { access: publicAccess() }

function post(audience: PostAudience, moderationState: ModerationState = 'published') {
  return { moderationState, principalId: CUSTOMER, audience }
}

describe('canViewPost: the internal audience', () => {
  it('denies the customer the post is attributed to', () => {
    expect(canViewPost(author, post('internal'), board).allowed).toBe(false)
  })

  it('denies every other non-team viewer, on a fully public board', () => {
    for (const actor of [otherCustomer, ANONYMOUS_ACTOR, service]) {
      expect(canViewPost(actor, post('internal'), board).allowed).toBe(false)
    }
  })

  it('allows a teammate carrying the private-post capability', () => {
    for (const actor of [admin, member]) {
      expect(canViewPost(actor, post('internal'), board).allowed).toBe(true)
    }
  })

  it('denies the author on every moderation state, not only published', () => {
    for (const state of MODERATION_STATES) {
      expect(canViewPost(author, post('internal', state), board).allowed).toBe(false)
    }
  })

  it('leaves the board audience unchanged: pending is still the author own-post hatch', () => {
    expect(canViewPost(author, post('board', 'pending'), board).allowed).toBe(true)
    expect(canViewPost(otherCustomer, post('board', 'pending'), board).allowed).toBe(false)
    expect(canViewPost(author, post('board', 'published'), board).allowed).toBe(true)
  })

  it('gives the denial the same copy as an invisible post, so it cannot be probed apart', () => {
    const internal = canViewPost(author, post('internal'), board)
    const pending = canViewPost(otherCustomer, post('board', 'pending'), board)
    expect(internal.allowed).toBe(false)
    expect(pending.allowed).toBe(false)
    if (!internal.allowed && !pending.allowed) {
      expect(internal.reason).toBe(pending.reason)
    }
  })
})

describe('postViewFilter: the internal audience', () => {
  const dialect = new PgDialect()
  function rendered(actor: Actor): string {
    return dialect.sqlToQuery(postViewFilter(actor)).sql
  }
  // Rendering binds principal ids through the TypeID column mapper, so these
  // actors need real ids rather than the readable ones above.
  const withRealId = (actor: Actor): Actor =>
    actor.principalId === null
      ? actor
      : { ...actor, principalId: createId('principal') as PrincipalId }

  it('constrains audience for a non-team viewer', () => {
    for (const actor of [author, otherCustomer, ANONYMOUS_ACTOR, service].map(withRealId)) {
      expect(rendered(actor)).toContain('audience')
    }
  })

  it('does not constrain audience for a viewer who may see private posts', () => {
    for (const actor of [admin, member].map(withRealId)) {
      expect(rendered(actor)).not.toContain('audience')
    }
  })
})

describe('board capabilities are audience-independent', () => {
  it('a board a customer may submit to stays submittable', () => {
    const caps = boardCapabilitiesForActor(author, publicAccess(), true)
    expect(caps).toEqual({ canSubmit: true, canVote: true, canComment: true })
  })
})

describe('the audience vocabulary', () => {
  it('is exactly board and internal', () => {
    expect([...POST_AUDIENCES]).toEqual(['board', 'internal'])
  })
})
