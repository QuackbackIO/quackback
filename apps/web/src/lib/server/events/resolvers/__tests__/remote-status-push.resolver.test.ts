/**
 * Loop-safety + mapping gate for outbound two-way status sync (IF WO-15).
 * Exercises the pure target builder: who gets a push when a post/ticket status
 * changes, and — critically — that an inbound-reported change never re-pushes to
 * the integration that reported it, while still syncing out to OTHER linked
 * integrations.
 */
import { describe, it, expect } from 'vitest'
import { buildRemoteStatusPushTargets, type PushLinkRow } from '../remote-status-push.resolver'

const LINEAR_PRINCIPAL = 'prn_linear_service'
const GITHUB_PRINCIPAL = 'prn_github_service'
const STATUS = 'post_status_done'

const linearLink: PushLinkRow = {
  linkId: 'lnk_linear',
  externalId: 'LIN-1',
  integrationId: 'int_linear',
  integrationType: 'linear',
  integrationPrincipalId: LINEAR_PRINCIPAL,
  pushStatusMappings: { [STATUS]: 'Done' },
}
const githubLink: PushLinkRow = {
  linkId: 'lnk_github',
  externalId: 'owner/repo#7',
  integrationId: 'int_github',
  integrationType: 'github',
  integrationPrincipalId: GITHUB_PRINCIPAL,
  pushStatusMappings: { [STATUS]: 'closed' },
}

const allHavePush = () => true

describe('buildRemoteStatusPushTargets', () => {
  it('a human status change pushes to every capable, mapped link', () => {
    const targets = buildRemoteStatusPushTargets({
      links: [linearLink, githubLink],
      statusId: STATUS,
      actorType: 'user',
      actorId: 'prn_alice',
      entityType: 'post',
      hasPushCapability: allHavePush,
    })
    expect(targets).toHaveLength(2)
    expect(targets.every((t) => t.type === 'remote_status_push')).toBe(true)
    expect(targets.map((t) => (t.config as { remoteStatus: string }).remoteStatus).sort()).toEqual([
      'Done',
      'closed',
    ])
  })

  it('LOOP-SAFETY: an inbound change from Linear does NOT re-push to Linear, but DOES sync to GitHub', () => {
    const targets = buildRemoteStatusPushTargets({
      links: [linearLink, githubLink],
      statusId: STATUS,
      actorType: 'service',
      actorId: LINEAR_PRINCIPAL,
      entityType: 'post',
      hasPushCapability: allHavePush,
    })
    expect(targets).toHaveLength(1)
    const [t] = targets
    expect((t.target as { integrationType: string }).integrationType).toBe('github')
  })

  it('a service actor that is NOT a linked integration still pushes to all (e.g. workflow bot)', () => {
    const targets = buildRemoteStatusPushTargets({
      links: [linearLink, githubLink],
      statusId: STATUS,
      actorType: 'service',
      actorId: 'prn_workflow_bot',
      entityType: 'post',
      hasPushCapability: allHavePush,
    })
    expect(targets).toHaveLength(2)
  })

  it('skips links whose provider has no push capability', () => {
    const targets = buildRemoteStatusPushTargets({
      links: [linearLink, githubLink],
      statusId: STATUS,
      actorType: 'user',
      actorId: 'prn_alice',
      entityType: 'post',
      hasPushCapability: (type) => type === 'linear',
    })
    expect(targets).toHaveLength(1)
    expect((targets[0].target as { integrationType: string }).integrationType).toBe('linear')
  })

  it('skips a link whose new status is not in pushStatusMappings', () => {
    const targets = buildRemoteStatusPushTargets({
      links: [linearLink],
      statusId: 'post_status_unmapped',
      actorType: 'user',
      actorId: 'prn_alice',
      entityType: 'post',
      hasPushCapability: allHavePush,
    })
    expect(targets).toHaveLength(0)
  })

  it('skips a link with no integration id and emits an idempotent per-(link,status) delivery key', () => {
    const orphan: PushLinkRow = { ...linearLink, linkId: 'lnk_orphan', integrationId: null }
    const targets = buildRemoteStatusPushTargets({
      links: [orphan, linearLink],
      statusId: STATUS,
      actorType: 'user',
      actorId: 'prn_alice',
      entityType: 'post',
      hasPushCapability: allHavePush,
    })
    expect(targets).toHaveLength(1)
    expect(targets[0].deliveryKey).toBe(`push:lnk_linear:${STATUS}`)
  })
})
