import { describe, expect, it } from 'vitest'
import { INVITATION_EXPIRY_MS } from '@/lib/server/functions/invitation-magic-link'
import {
  INVITE_VALID_DAYS,
  addPeopleErrorCode,
  checkSeats,
  extractEmails,
  isFullEmail,
  primaryLabel,
  seatOverMessage,
  seatRefusalMessage,
  successMessage,
  summarySentences,
  withArticle,
  type AddChip,
} from '../add-people'

const person: AddChip = {
  kind: 'person',
  principalId: 'p1',
  name: 'Maya Chen',
  avatarUrl: null,
  detail: '',
}
const email: AddChip = { kind: 'email', address: 'a@acme.example' }
const member = { role: 'member' as const, label: 'Member' }

describe('add people rules', () => {
  it('says the invite lasts as long as the server keeps it', () => {
    expect(INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toBe(INVITATION_EXPIRY_MS)
  })

  it('knows a full email from a partial one', () => {
    expect(isFullEmail(' maya@acme.example ')).toBe(true)
    expect(isFullEmail('maya@acme')).toBe(false)
    expect(isFullEmail('maya')).toBe(false)
    expect(isFullEmail('maya@acme.example, bo@acme.example')).toBe(false)
  })

  it('reads every address out of pasted text once, lowercased', () => {
    expect(
      extractEmails('Ann <Ann@Acme.example>; bob@acme.example,\ncy@acme.example. ann@acme.example')
    ).toEqual(['ann@acme.example', 'bob@acme.example', 'cy@acme.example'])
    expect(extractEmails('no addresses here')).toEqual([])
  })

  it('counts seats with everyone in the dialog', () => {
    expect(checkSeats({ used: 9, limit: 10 }, 1)).toEqual({
      needed: 10,
      limit: 10,
      over: false,
      excess: 0,
    })
    const over = checkSeats({ used: 9, limit: 10 }, 3)!
    expect(over).toEqual({ needed: 12, limit: 10, over: true, excess: 2 })
    expect(seatOverMessage(3, over)).toBe(
      'Adding 3 people needs 12 seats and the plan has 10. Remove 2, or'
    )
    // A full plan with nobody chosen yet is not a problem until someone is.
    expect(checkSeats({ used: 10, limit: 10 }, 0)?.over).toBe(false)
    expect(checkSeats({ used: 40, limit: null }, 5)?.over).toBe(false)
    expect(checkSeats(undefined, 2)).toBeNull()
  })

  it('names the action by who is in the dialog', () => {
    expect(primaryLabel([])).toBe('Add people')
    expect(primaryLabel([person])).toBe('Add 1 person')
    expect(primaryLabel([email, { kind: 'email', address: 'b@acme.example' }])).toBe(
      'Invite 2 people'
    )
    expect(primaryLabel([person, email])).toBe('Add 2 people')
  })

  it('says what happens, one sentence for who joins and one for who is invited', () => {
    expect(summarySentences([person], { role: 'admin', label: 'Admin' })).toEqual([
      'Maya Chen joins now as an Admin and keeps signing in the way they do today.',
    ])
    const omar: AddChip = { ...person, principalId: 'p2', name: 'Omar' } as AddChip
    const tess: AddChip = { ...person, principalId: 'p3', name: 'Tess' } as AddChip
    expect(
      summarySentences(
        [person, omar, tess, email, { kind: 'email', address: 'b@acme.example' }],
        member
      )
    ).toEqual([
      'Maya Chen, Omar and Tess join now as Members and keep signing in the way they do today.',
      'a@acme.example and b@acme.example get an email invitation that works for 30 days.',
    ])
    expect(summarySentences([email], member)).toEqual([
      'a@acme.example gets an email invitation that works for 30 days.',
    ])
    expect(withArticle('Editor')).toBe('an Editor')
    expect(withArticle('Support lead')).toBe('a Support lead')
  })

  it('words the success toast', () => {
    expect(successMessage([{ name: 'Maya Chen' }], [], member)).toBe(
      'Maya Chen is now a Member. Their ideas, votes and comments stay with them.'
    )
    expect(successMessage([], [{ email: 'a@acme.example' }], member)).toBe(
      'Invitation sent to a@acme.example.'
    )
    expect(
      successMessage(
        [{ name: 'A' }, { name: 'B' }],
        [{ email: 'a@x.example' }, { email: 'b@x.example' }],
        { role: 'admin', label: 'Admin' }
      )
    ).toBe(
      'A and B are now Admins. Their ideas, votes and comments stay with them. Invitations sent to 2 people.'
    )
  })

  it('reads the error code from the error or its message', () => {
    expect(addPeopleErrorCode(Object.assign(new Error('x'), { code: 'SEAT_LIMIT' }))).toBe(
      'SEAT_LIMIT'
    )
    expect(addPeopleErrorCode(new Error('GRANT_CEILING: nope'))).toBe('GRANT_CEILING')
    expect(addPeopleErrorCode(new Error('something else'))).toBeNull()
    expect(addPeopleErrorCode(null)).toBeNull()
  })

  it('states a server seat refusal with its numbers', () => {
    expect(seatRefusalMessage(3, 1)).toBe(
      'Adding 3 people needs 3 seats, and 1 is free. Remove 2, or'
    )
    expect(seatRefusalMessage(1, 0)).toBe(
      'Adding 1 person needs 1 seat, and 0 are free. Remove 1, or'
    )
  })
})
