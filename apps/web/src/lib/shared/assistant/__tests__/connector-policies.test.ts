/**
 * The per-use connector policy resolver.
 *
 * Every case here is about independence: what the customer column says must
 * never be readable from the teammate column, and an absent column must not
 * borrow the other one's answer. The old shared map could not express any of
 * this, which is why the matrix is enumerated rather than sampled.
 */
import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_TOOL_POLICIES,
  DEFAULT_CONNECTOR_PROFILE_POLICY,
  projectSharedPoliciesToProfiles,
  resolveConnectorToolAccess,
  type ConnectorProfilePolicies,
  type ConnectorToolPolicy,
} from '../connectors'

function profiles(
  agent: ConnectorToolPolicy | null,
  copilot: ConnectorToolPolicy | null
): ConnectorProfilePolicies {
  const out: ConnectorProfilePolicies = {}
  if (agent) out.agent = { groupDefaults: { read: agent, write: agent }, tools: {} }
  if (copilot) out.copilot = { groupDefaults: { read: copilot, write: copilot }, tools: {} }
  return out
}

function access(
  profilePolicies: ConnectorProfilePolicies,
  profile: 'agent' | 'copilot',
  overrides: Partial<Parameters<typeof resolveConnectorToolAccess>[0]> = {}
) {
  return resolveConnectorToolAccess({
    profilePolicies,
    profile,
    toolName: 'issue_refund',
    group: 'write',
    reviewed: true,
    schemaSupported: true,
    ...overrides,
  })
}

describe('resolveConnectorToolAccess: independent matrix', () => {
  for (const customer of CONNECTOR_TOOL_POLICIES) {
    for (const teammate of CONNECTOR_TOOL_POLICIES) {
      it(`customer ${customer} with teammate ${teammate} resolves each use on its own`, () => {
        const policies = profiles(customer, teammate)
        expect(access(policies, 'agent').policy).toBe(customer)
        expect(access(policies, 'copilot').policy).toBe(teammate)
      })
    }
  }
})

describe('resolveConnectorToolAccess: denials', () => {
  it('denies a use with no policy record rather than borrowing the other use', () => {
    const customerOnly = profiles('always', null)
    expect(access(customerOnly, 'agent').policy).toBe('always')
    const teammate = access(customerOnly, 'copilot')
    expect(teammate.policy).toBe('never')
    expect(teammate.reason).toBe('no_profile_policy')
  })

  it('denies an empty policy map for both uses', () => {
    expect(access({}, 'agent').policy).toBe('never')
    expect(access({}, 'copilot').policy).toBe('never')
  })

  it('denies an unreviewed tool for both uses, whatever the policy says', () => {
    const policies = profiles('always', 'always')
    for (const profile of ['agent', 'copilot'] as const) {
      const decision = access(policies, profile, { reviewed: false })
      expect(decision.policy).toBe('never')
      expect(decision.reason).toBe('tool_unreviewed')
    }
  })

  it('denies a tool whose input schema uses unsupported constructs', () => {
    const decision = access(profiles('always', 'always'), 'agent', { schemaSupported: false })
    expect(decision.policy).toBe('never')
    expect(decision.reason).toBe('schema_unsupported')
  })

  it('reports the review gate before the schema gate so the actionable one shows', () => {
    const decision = access(profiles('always', 'always'), 'agent', {
      reviewed: false,
      schemaSupported: false,
    })
    expect(decision.reason).toBe('tool_unreviewed')
  })
})

describe('resolveConnectorToolAccess: overrides', () => {
  it('resolves an exact override ahead of the use group default', () => {
    const policies: ConnectorProfilePolicies = {
      agent: {
        groupDefaults: { read: 'always', write: 'approval' },
        tools: { issue_refund: 'never' },
      },
      copilot: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
    }
    const customer = access(policies, 'agent')
    expect(customer.policy).toBe('never')
    expect(customer.reason).toBe('override')
    expect(customer.isOverride).toBe(true)

    const teammate = access(policies, 'copilot')
    expect(teammate.policy).toBe('approval')
    expect(teammate.reason).toBe('group_default')
    expect(teammate.isOverride).toBe(false)
  })

  it('keeps one use override out of the other use', () => {
    const policies: ConnectorProfilePolicies = {
      agent: { groupDefaults: { read: 'never', write: 'never' }, tools: { get_invoice: 'always' } },
      copilot: { groupDefaults: { read: 'never', write: 'never' }, tools: {} },
    }
    expect(access(policies, 'agent', { toolName: 'get_invoice', group: 'read' }).policy).toBe(
      'always'
    )
    expect(access(policies, 'copilot', { toolName: 'get_invoice', group: 'read' }).policy).toBe(
      'never'
    )
  })

  it('resolves the group the tool belongs to, not the other one', () => {
    const policies: ConnectorProfilePolicies = {
      agent: { groupDefaults: { read: 'always', write: 'never' }, tools: {} },
    }
    expect(access(policies, 'agent', { group: 'read' }).policy).toBe('always')
    expect(access(policies, 'agent', { group: 'write' }).policy).toBe('never')
  })
})

describe('projectSharedPoliciesToProfiles', () => {
  const shared = {
    groupDefaults: { read: 'always' as const, write: 'approval' as const },
    tools: { issue_refund: 'never' as const },
  }

  it('copies the shared map into each assigned use and nowhere else', () => {
    const projected = projectSharedPoliciesToProfiles(shared, { agent: true, copilot: false })
    expect(projected.agent?.groupDefaults).toEqual(shared.groupDefaults)
    expect(projected.agent?.tools).toEqual(shared.tools)
    expect(projected.agent?.origin).toBe('migrated_from_shared')
    expect(projected.copilot).toBeUndefined()
    expect(projected.workspace).toBeUndefined()
  })

  it('never expands assignments: an unassigned connector gets no policy at all', () => {
    expect(projectSharedPoliciesToProfiles(shared, { agent: false, copilot: false })).toEqual({})
  })

  it('projects the workspace use when it is assigned', () => {
    const projected = projectSharedPoliciesToProfiles(shared, {
      agent: false,
      copilot: false,
      workspace: true,
    })
    expect(projected.workspace?.tools).toEqual(shared.tools)
    expect(projected.agent).toBeUndefined()
  })

  it('falls back to the recommended defaults when the shared map is absent', () => {
    const projected = projectSharedPoliciesToProfiles(undefined, { agent: true, copilot: true })
    expect(projected.agent?.groupDefaults).toEqual(DEFAULT_CONNECTOR_PROFILE_POLICY.groupDefaults)
    expect(projected.copilot?.groupDefaults).toEqual(DEFAULT_CONNECTOR_PROFILE_POLICY.groupDefaults)
  })
})
