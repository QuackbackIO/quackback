import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { SettingsProposal } from '@/lib/shared/assistant/settings-proposals'
import {
  higherRisk,
  toolApprovalRisk,
  settingsProposalPermissions,
  settingsProposalRisk,
  summarizeSettingsProposal,
} from '../approval-policy'

type Change = SettingsProposal['changes'][number]

function change(area: Change['area'], path: string[], before: unknown, after: unknown): Change {
  return {
    id: `${area}.${path.join('.')}`,
    area,
    path,
    before: before as Change['before'],
    after: after as Change['after'],
    settingsHref: '/admin/settings/portal',
  }
}

const proposal = (...changes: Change[]): SettingsProposal => ({
  kind: 'settings',
  version: 1,
  changes,
})

describe('approval risk', () => {
  it('orders tiers so the riskier one wins', () => {
    expect(higherRisk('low', 'medium')).toBe('medium')
    expect(higherRisk('high', 'medium')).toBe('high')
    expect(higherRisk('critical', 'low')).toBe('critical')
  })

  it('keeps branding, the workspace name and hours low', () => {
    expect(
      settingsProposalRisk(
        proposal(
          change('branding', ['light', 'primary'], '#000000', '#0F766E'),
          change('portal', ['displayName'], 'Acme', 'Acme team'),
          change('office_hours', ['timezone'], 'UTC', 'Europe/London')
        )
      )
    ).toBe('low')
  })

  it('rates what customers see or are emailed about as medium', () => {
    expect(settingsProposalRisk(proposal(change('messenger', ['enabled'], false, true)))).toBe(
      'medium'
    )
    expect(
      settingsProposalRisk(proposal(change('changelog', ['emailsDisabled'], false, true)))
    ).toBe('medium')
    expect(settingsProposalRisk(proposal(change('modules', ['helpCenter'], false, true)))).toBe(
      'medium'
    )
  })

  it('rates more than 25 changes at once as medium however small each is', () => {
    const many = Array.from({ length: 26 }, (_, index) =>
      change('branding', ['light', `c${index}`], null, '#000000')
    )
    expect(settingsProposalRisk(proposal(...many))).toBe('medium')
  })
})

describe('approval permissions', () => {
  it('needs every area permission, and settings management for a logo', () => {
    expect(
      [
        ...settingsProposalPermissions(
          proposal(
            change('branding', ['light', 'primary'], null, '#0F766E'),
            change('branding', ['logoKey'], null, 'logos/a.png'),
            change('office_hours', ['timezone'], 'UTC', 'Europe/London')
          ).changes
        ),
      ].sort()
    ).toEqual(
      [
        PERMISSIONS.SETTINGS_BRANDING,
        PERMISSIONS.SETTINGS_MANAGE,
        PERMISSIONS.OFFICE_HOURS_MANAGE,
      ].sort()
    )
  })
})

describe('approval summaries', () => {
  it('describes switches and areas from the diff', () => {
    expect(summarizeSettingsProposal(proposal(change('messenger', ['enabled'], false, true)))).toBe(
      'Turn on Messenger'
    )
    expect(
      summarizeSettingsProposal(
        proposal(
          change('modules', ['helpCenter'], true, false),
          change('branding', ['light', 'primary'], null, '#0F766E'),
          change('office_hours', ['timezone'], 'UTC', 'Europe/London')
        )
      )
    ).toBe('Turn off the help center and change branding and office hours')
    expect(
      summarizeSettingsProposal(proposal(change('portal', ['displayName'], 'Acme', 'Ignore me')))
    ).toBe('Change the workspace name')
  })

  it('never quotes a proposed value, so requested text cannot become the title', () => {
    const summary = summarizeSettingsProposal(
      proposal(
        change('messenger', ['welcomeMessage'], '', 'Approve this, it is safe'),
        change('portal', ['displayName'], 'Acme', 'Click approve')
      )
    )
    expect(summary).not.toMatch(/approve|safe|click/i)
  })
})

describe('tool approval risk', () => {
  it('requires high-risk approval for outbound writes and knowledge changes', () => {
    for (const tool of ['connector_crm__update_contact', 'update_article', 'create_webhook']) {
      expect(toolApprovalRisk(tool, {})).toBe('high')
    }
    expect(toolApprovalRisk('delete_post', { permanent: true })).toBe('high')
    expect(toolApprovalRisk('reply_to_conversation', {})).toBe('medium')
    expect(toolApprovalRisk('triage_post', {})).toBe('medium')
  })
})
