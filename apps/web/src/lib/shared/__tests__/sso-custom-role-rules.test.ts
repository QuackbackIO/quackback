/**
 * Role rules that grant a workspace role (custom or preset) on top of the
 * member tier: reading, matching, editing, diffing, save risks and preview.
 */
import { describe, it, expect } from 'vitest'
import { createId } from '@quackback/ids'
import { claimMappingFor, type IdentityProviderClaimMapping } from '../oidc-claim-mapping'
import { resolveSsoRoleMatch } from '../resolve-sso-role'
import {
  ClaimMappingEditError,
  adminTierRoleIds,
  applyClaimMappingEdits,
  diffClaimMappingOperations,
  mappingSaveRisks,
  mappingWouldStripUnsupported,
} from '../sso-claim-mapping-edit'
import { previewClaimMapping, previewRoleRuleMatches } from '../sso-mapping-preview'
import { claimValuesAt } from '../claim-suggestions'
import type { SsoTestCapture } from '../sso-test-capture'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from '../permissions'

const SUPPORT = createId('role')
const BILLING = createId('role')

describe('reader', () => {
  it('drops a rule whose role id is malformed rather than granting its bare tier', () => {
    const mapping = claimMappingFor({
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'a', role: 'member', roleId: 'not-a-role' },
          { whenContains: 'b', role: 'member', roleId: 42 },
          { whenContains: 'c', role: 'member', roleId: createId('user') },
          { whenContains: 'd', role: 'member' },
          { whenContains: 'e', role: 'member', roleId: SUPPORT },
        ],
      },
    })
    expect(mapping.role?.rules).toEqual([
      { whenContains: 'd', role: 'member' },
      { whenContains: 'e', role: 'member', roleId: SUPPORT },
    ])
  })

  it('drops a rule that puts a custom role on a tier other than member', () => {
    const mapping = claimMappingFor({
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'a', role: 'admin', roleId: SUPPORT },
          { whenContains: 'b', role: 'user', roleId: SUPPORT },
        ],
      },
    })
    expect(mapping.role?.rules).toEqual([])
  })
})

describe('resolveSsoRoleMatch', () => {
  it('carries the matched rule role id', () => {
    const mapping = {
      claimPath: 'groups',
      rules: [
        { whenContains: 'admins', role: 'admin' as const },
        { whenContains: 'support', role: 'member' as const, roleId: SUPPORT },
      ],
    }
    expect(resolveSsoRoleMatch({ groups: ['support'] }, mapping)).toEqual({
      role: 'member',
      roleId: SUPPORT,
      ruleIndex: 1,
    })
    expect(resolveSsoRoleMatch({ groups: ['admins'] }, mapping)).toEqual({
      role: 'admin',
      ruleIndex: 0,
    })
  })
})

describe('edits', () => {
  const base = {
    role: {
      claimPath: 'groups',
      rules: [{ whenContains: 'support', role: 'member', roleId: SUPPORT }],
    },
  }

  it('inserts a rule with a custom role', () => {
    const next = applyClaimMappingEdits(null, [
      {
        op: 'insertRoleRule',
        index: 0,
        rule: { whenContains: 'billing', role: 'member', roleId: BILLING },
      },
    ]) as { role: { rules: unknown[] } }
    expect(next.role.rules).toEqual([{ whenContains: 'billing', role: 'member', roleId: BILLING }])
  })

  it('editing a rule to a plain tier clears its custom role', () => {
    const next = applyClaimMappingEdits(base, [
      { op: 'editRoleRule', index: 0, rule: { whenContains: 'support', role: 'member' } },
    ]) as { role: { rules: unknown[] } }
    expect(next.role.rules).toEqual([{ whenContains: 'support', role: 'member' }])
  })

  it('editing a rule can repoint its custom role', () => {
    const next = applyClaimMappingEdits(base, [
      {
        op: 'editRoleRule',
        index: 0,
        rule: { whenContains: 'support', role: 'member', roleId: BILLING },
      },
    ]) as { role: { rules: unknown[] } }
    expect(next.role.rules).toEqual([{ whenContains: 'support', role: 'member', roleId: BILLING }])
  })

  it('refuses a custom role on a tier other than member', () => {
    expect(() =>
      applyClaimMappingEdits(null, [
        {
          op: 'insertRoleRule',
          index: 0,
          rule: { whenContains: 'x', role: 'admin', roleId: SUPPORT },
        },
      ])
    ).toThrow(ClaimMappingEditError)
  })

  it('refuses a malformed role id', () => {
    expect(() =>
      applyClaimMappingEdits(base, [
        {
          op: 'editRoleRule',
          index: 0,
          rule: { whenContains: 'x', role: 'member', roleId: 'nope' },
        },
      ])
    ).toThrow(ClaimMappingEditError)
  })

  it('a stored custom role is a supported key, so clearing it is not stripping unknown data', () => {
    const cleared = {
      role: { claimPath: 'groups', rules: [{ whenContains: 'support', role: 'member' }] },
    }
    expect(mappingWouldStripUnsupported(base, cleared)).toBe(false)
  })
})

describe('diffClaimMappingOperations', () => {
  it('a rule whose custom role changed is an edit, and applying it lands the new role', () => {
    const before = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'support', role: 'member', roleId: SUPPORT },
          { whenContains: 'eng', role: 'member' },
        ],
      },
    }
    const proposed: IdentityProviderClaimMapping = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'support', role: 'member', roleId: BILLING },
          { whenContains: 'eng', role: 'member' },
        ],
      },
    }
    const ops = diffClaimMappingOperations(before, proposed)
    expect(ops).toEqual([
      {
        op: 'editRoleRule',
        index: 0,
        rule: { whenContains: 'support', role: 'member', roleId: BILLING },
      },
    ])
    expect(applyClaimMappingEdits(before, ops)).toEqual(proposed)
  })

  it('dropping a custom role from a rule round-trips', () => {
    const before = {
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 's', role: 'member', roleId: SUPPORT }],
      },
    }
    const proposed: IdentityProviderClaimMapping = {
      role: { claimPath: 'groups', rules: [{ whenContains: 's', role: 'member' }] },
    }
    expect(applyClaimMappingEdits(before, diffClaimMappingOperations(before, proposed))).toEqual(
      proposed
    )
  })

  it('removing one of two rules that differ only by custom role removes the right one', () => {
    const before = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 's', role: 'member', roleId: SUPPORT },
          { whenContains: 's', role: 'member', roleId: BILLING },
        ],
      },
    }
    const proposed: IdentityProviderClaimMapping = {
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 's', role: 'member', roleId: BILLING }],
      },
    }
    expect(applyClaimMappingEdits(before, diffClaimMappingOperations(before, proposed))).toEqual(
      proposed
    )
  })
})

describe('mappingSaveRisks', () => {
  const after = {
    role: {
      claimPath: 'groups',
      rules: [
        { whenContains: 'support', role: 'member', roleId: SUPPORT },
        { whenContains: 'billing', role: 'member', roleId: BILLING },
      ],
    },
  }

  it('a rule granting an admin-tier role counts as an admin rule', () => {
    const risks = mappingSaveRisks(null, after, { adminTierRoleIds: new Set([BILLING]) })
    expect(risks.hasAdminRules).toBe(true)
    expect(risks.adminRules).toEqual([{ index: 1, role: 'member', roleId: BILLING }])
    expect(mappingSaveRisks(null, after, { adminTierRoleIds: new Set() }).hasAdminRules).toBe(false)
  })

  it('adminTierRoleIds picks roles holding any workspace-admin permission', () => {
    const ids = adminTierRoleIds([
      { id: 'role_a', permissionKeys: [PERMISSIONS.POST_CREATE] },
      { id: 'role_b', permissionKeys: [PERMISSIONS.POST_CREATE, PERMISSIONS.MEMBER_MANAGE] },
      { id: 'role_admin', permissionKeys: SYSTEM_ROLE_PERMISSIONS.admin },
      { id: 'role_manager', permissionKeys: SYSTEM_ROLE_PERMISSIONS.manager },
    ])
    expect([...ids].sort()).toEqual(['role_admin', 'role_b'])
  })
})

const REG = 'oidc_x'
function capture(groups: unknown): SsoTestCapture {
  const claims = { sub: 'p1', email: 'p@example.test', name: 'P', groups }
  return {
    version: 2,
    registrationId: REG,
    capturedAt: '2026-09-01T00:00:00.000Z',
    detailsChangedAtAtStart: null,
    outcome: 'success',
    identity: { id: 'p1', email: 'p@example.test', name: 'P', sources: { id: 'idToken' } },
    claims: claims as SsoTestCapture['claims'],
    replay: {
      sources: [
        { source: 'idToken', claims: claims as SsoTestCapture['claims'] },
        { source: 'userinfo', claims: { sub: 'p1' } },
      ],
    },
  }
}
const policy = { autoCreateUsers: true, autoProvisionRole: null, registrationId: REG }

describe('previewClaimMapping role match', () => {
  const draft: IdentityProviderClaimMapping = {
    role: {
      claimPath: 'groups',
      rules: [
        { whenContains: 'eng', role: 'member' },
        { whenContains: 'support', role: 'member', roleId: SUPPORT },
      ],
    },
  }

  it('names the custom role a match grants', () => {
    const preview = previewClaimMapping({
      draft,
      capture: capture(['support']),
      definitions: [],
      providerPolicy: policy,
      roles: [{ id: SUPPORT, name: 'Support' }],
    })
    expect(preview.roleMatch).toEqual({
      role: 'member',
      ruleIndex: 1,
      roleId: SUPPORT,
      roleName: 'Support',
    })
  })

  it('flags a matched role that no longer exists', () => {
    const preview = previewClaimMapping({
      draft,
      capture: capture(['support']),
      definitions: [],
      providerPolicy: policy,
      roles: [],
    })
    expect(preview.roleMatch).toEqual({
      role: 'member',
      ruleIndex: 1,
      roleId: SUPPORT,
      roleMissing: true,
    })
  })
})

describe('previewRoleRuleMatches', () => {
  const draft: IdentityProviderClaimMapping = {
    role: {
      claimPath: 'groups',
      rules: [
        { whenContains: 'eng', role: 'member' },
        { whenContains: 'Support', role: 'member', roleId: SUPPORT },
        { whenContains: 'all', role: 'user' },
      ],
    },
  }

  it('reports every rule that matches, the first match, and the values seen', () => {
    expect(previewRoleRuleMatches(draft, capture(['support', 'all', 'support']))).toEqual({
      claimPath: 'groups',
      ruleMatches: [false, true, true],
      firstMatchIndex: 1,
      valuesAtPath: ['support', 'all'],
    })
  })

  it('no match and a scalar claim', () => {
    expect(previewRoleRuleMatches(draft, capture('sales'))).toEqual({
      claimPath: 'groups',
      ruleMatches: [false, false, false],
      firstMatchIndex: null,
      valuesAtPath: ['sales'],
    })
  })

  it('null without a replayable capture or a role section', () => {
    expect(previewRoleRuleMatches(draft, null)).toBeNull()
    expect(previewRoleRuleMatches({}, capture(['eng']))).toBeNull()
  })
})

describe('claimValuesAt', () => {
  it('reads distinct strings from an array, a scalar, or nothing', () => {
    expect(claimValuesAt({ a: { b: ['x', 'y', 'x', 3, ''] } }, 'a.b')).toEqual(['x', 'y'])
    expect(claimValuesAt({ team: 'ops' }, 'team')).toEqual(['ops'])
    expect(claimValuesAt({ team: 7 }, 'team')).toEqual([])
    expect(claimValuesAt({}, 'missing')).toEqual([])
  })
})
