import { describe, expect, it } from 'vitest'
import {
  canEditPlatformCredentials,
  canInstallIntegration,
  showOAuthConnect,
} from '../integration-connect'

describe('canInstallIntegration', () => {
  it('lets a tenant open settings when env/CP already has the app credentials', () => {
    expect(canInstallIntegration({ available: false, managed: true })).toBe(true)
    expect(canInstallIntegration({ available: true, managed: true })).toBe(true)
  })

  it('keeps unconfigured self-hosted apps on the credentials dialog', () => {
    expect(canInstallIntegration({ available: false, managed: false })).toBe(false)
    expect(canInstallIntegration({ available: false })).toBe(false)
  })
})

describe('showOAuthConnect', () => {
  it('shows Connect for platform-managed apps even before a workspace install', () => {
    expect(
      showOAuthConnect({
        hasPlatformCredentialFields: true,
        platformCredentialsConfigured: false,
        platformCredentialsManaged: true,
      })
    ).toBe(true)
  })

  it('hides Connect until self-hosted credentials are pasted', () => {
    expect(
      showOAuthConnect({
        hasPlatformCredentialFields: true,
        platformCredentialsConfigured: false,
        platformCredentialsManaged: false,
      })
    ).toBe(false)
  })
})

describe('canEditPlatformCredentials', () => {
  it('locks the paste form when the platform owns the app', () => {
    expect(canEditPlatformCredentials(true)).toBe(false)
    expect(canEditPlatformCredentials(false)).toBe(true)
  })
})
