/**
 * ticket.recipients — portal-aware recipient resolver.
 *
 * Locks the contract used by the notification dispatcher:
 *   - contact-only participants AND requesterContactId expand to portal
 *     principals via `contact_user_links`,
 *   - direct-`principalId` participants are returned but NOT marked as
 *     portal-linked (they're addressable by RBAC),
 *   - empty input never issues SQL,
 *   - duplicates are deduped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// SQL chain mocks
// ---------------------------------------------------------------------------

const participantRows: Array<{ principalId: string | null; contactId: string | null }> = []
const principalLinkRows: Array<{ id: string }> = []
const innerJoinSpy = vi.fn()
const whereSpyParticipants = vi.fn()
const whereSpyLinks = vi.fn()

vi.mock('@/lib/server/db', () => {
  function makeSelectChain() {
    const chain: { from: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn> } = {
      from: vi.fn((tbl: { _name: string }) => {
        const isParticipants = tbl?._name === 'ticket_participants'
        chain.where = vi.fn((arg: unknown) => {
          if (isParticipants) {
            whereSpyParticipants(arg)
            return Promise.resolve(participantRows)
          }
          return Promise.resolve([])
        })
        return chain
      }),
      where: vi.fn(),
    }
    return chain
  }

  function makeSelectDistinctChain() {
    const chain: {
      from: ReturnType<typeof vi.fn>
      innerJoin: ReturnType<typeof vi.fn>
      where: ReturnType<typeof vi.fn>
    } = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn((tbl: unknown, on: unknown) => {
        innerJoinSpy(tbl, on)
        return chain
      }),
      where: vi.fn((arg: unknown) => {
        whereSpyLinks(arg)
        return Promise.resolve(principalLinkRows)
      }),
    }
    return chain
  }

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      selectDistinct: vi.fn(() => makeSelectDistinctChain()),
    },
    eq: vi.fn((col, val) => ({ _op: 'eq', col, val })),
    inArray: vi.fn((col, vals) => ({ _op: 'inArray', col, vals })),
    contactUserLinks: {
      _name: 'contact_user_links',
      contactId: 'contact_user_links.contact_id',
      userId: 'contact_user_links.user_id',
    },
    principal: {
      _name: 'principal',
      id: 'principal.id',
      userId: 'principal.user_id',
    },
    ticketParticipants: {
      _name: 'ticket_participants',
      ticketId: 'ticket_participants.ticket_id',
      principalId: 'ticket_participants.principal_id',
      contactId: 'ticket_participants.contact_id',
    },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  participantRows.length = 0
  principalLinkRows.length = 0
})

describe('resolvePrincipalsForContacts', () => {
  it('returns deduped principal IDs for the linked users', async () => {
    principalLinkRows.push({ id: 'principal_a' }, { id: 'principal_b' })
    const { resolvePrincipalsForContacts } = await import('../ticket.recipients')
    const result = await resolvePrincipalsForContacts(['contact_1' as never, 'contact_2' as never])
    expect(result).toEqual(['principal_a', 'principal_b'])
    expect(whereSpyLinks).toHaveBeenCalledTimes(1)
  })

  it('short-circuits on empty input without issuing SQL', async () => {
    const { resolvePrincipalsForContacts } = await import('../ticket.recipients')
    const result = await resolvePrincipalsForContacts([])
    expect(result).toEqual([])
    expect(whereSpyLinks).not.toHaveBeenCalled()
  })
})

describe('resolvePortalLinkedRecipients', () => {
  it('expands requesterContactId + contact-participants and flags portalLinked', async () => {
    participantRows.push(
      { principalId: null, contactId: 'contact_part' },
      { principalId: 'principal_direct', contactId: null }
    )
    principalLinkRows.push({ id: 'principal_portal_a' }, { id: 'principal_portal_b' })

    const { resolvePortalLinkedRecipients } = await import('../ticket.recipients')
    const result = await resolvePortalLinkedRecipients({
      id: 'ticket_1' as never,
      requesterContactId: 'contact_req' as never,
    })

    // principalIds = direct ∪ portal-linked (deduped)
    expect([...result.principalIds].sort()).toEqual(
      ['principal_direct', 'principal_portal_a', 'principal_portal_b'].sort()
    )
    // portalLinked excludes the direct participant.
    expect(Array.from(result.portalLinked).sort()).toEqual(
      ['principal_portal_a', 'principal_portal_b'].sort()
    )
    expect(result.portalLinked.has('principal_direct' as never)).toBe(false)
  })

  it('returns empty sets when ticket has no contact-side references', async () => {
    // No participants, no requesterContactId → no contact-link query at all.
    const { resolvePortalLinkedRecipients } = await import('../ticket.recipients')
    const result = await resolvePortalLinkedRecipients({
      id: 'ticket_1' as never,
      requesterContactId: null,
    })
    expect(result.principalIds).toEqual([])
    expect(result.portalLinked.size).toBe(0)
    expect(whereSpyLinks).not.toHaveBeenCalled()
  })

  it('does NOT mark a direct-principal participant as portal-linked even if also linked via contact', async () => {
    participantRows.push({ principalId: 'principal_x', contactId: null })
    // The contact-link query happens to return the same principal as the
    // direct participant — it must NOT appear in portalLinked.
    principalLinkRows.push({ id: 'principal_x' })
    const { resolvePortalLinkedRecipients } = await import('../ticket.recipients')
    const result = await resolvePortalLinkedRecipients({
      id: 'ticket_1' as never,
      requesterContactId: 'contact_req' as never,
    })
    expect([...result.principalIds]).toEqual(['principal_x'])
    expect(result.portalLinked.size).toBe(0)
  })
})
