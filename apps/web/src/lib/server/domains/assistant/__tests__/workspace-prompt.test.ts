import { describe, expect, it } from 'vitest'
import { formatAskingTeammateContext } from '../workspace-prompt'

describe('formatAskingTeammateContext', () => {
  it('names the asking teammate and tells the model how to assign to them', () => {
    expect(
      formatAskingTeammateContext({
        principalId: 'principal_1',
        displayName: 'James',
        email: 'james@quackback.io',
        role: 'admin',
      })
    ).toBe(
      'Asking teammate: James (principal id principal_1, role admin). Email: james@quackback.io. When they ask who they are, answer from these facts. When they say "me" or "assign to me", use this principal id as ownerPrincipalId, or pass the token "me". Never invent a different person.'
    )
  })

  it('falls back to a generic label when name and email are missing', () => {
    expect(
      formatAskingTeammateContext({
        principalId: 'principal_1',
        displayName: null,
        email: null,
        role: 'member',
      })
    ).toContain('Asking teammate: a teammate (principal id principal_1, role member).')
    expect(
      formatAskingTeammateContext({
        principalId: 'principal_1',
        displayName: null,
        email: null,
        role: 'member',
      })
    ).not.toContain('Email:')
  })
})
