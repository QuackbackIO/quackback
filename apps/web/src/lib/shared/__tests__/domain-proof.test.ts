import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '../permissions'
import {
  SSO_VERIFY_RECORD_HOST,
  pendingProvenLabel,
  shownProofSource,
  ssoVerifyRecordValue,
  verifiedThroughLabel,
} from '../domain-proof'

describe('shownProofSource', () => {
  it('names the source only to a viewer who may see what proved it', () => {
    expect(shownProofSource('email-sending', [PERMISSIONS.CHANNEL_ACCOUNT_MANAGE])).toBe(
      'email-sending'
    )
    expect(shownProofSource('web-address', [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN])).toBe(
      'web-address'
    )
    expect(shownProofSource('sso', [PERMISSIONS.AUTH_MANAGE])).toBe('sso')
  })

  it('says only that this workspace proved it to anyone else', () => {
    expect(shownProofSource('email-sending', [PERMISSIONS.AUTH_MANAGE])).toBe('workspace')
    expect(
      shownProofSource('web-address', [PERMISSIONS.AUTH_MANAGE, PERMISSIONS.CHANNEL_ACCOUNT_MANAGE])
    ).toBe('workspace')
    expect(shownProofSource('email-sending', [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN])).toBe(
      'workspace'
    )
    expect(shownProofSource('sso', [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN])).toBe('workspace')
  })
})

describe('labels', () => {
  it('reads naturally for a named and a generic source', () => {
    expect(verifiedThroughLabel('email-sending')).toBe('Verified through email sending')
    expect(verifiedThroughLabel('workspace')).toBe('Verified by this workspace')
    expect(pendingProvenLabel('email-sending')).toBe('Already verified through email sending')
    expect(pendingProvenLabel('workspace')).toBe('Already verified by this workspace')
    expect(pendingProvenLabel('sso')).toBe('Already verified through single sign-on')
  })
})

describe('single sign-on verification record', () => {
  it('is the TXT the sign-in domain check looks for', () => {
    expect(SSO_VERIFY_RECORD_HOST).toBe('_quackback-verify')
    expect(ssoVerifyRecordValue('abc123')).toBe('qb-domain-verify=abc123')
  })
})
