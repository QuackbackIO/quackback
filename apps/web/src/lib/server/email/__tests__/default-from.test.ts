/**
 * Pooled From is the workspace registry field; self-host stays EMAIL_FROM.
 *
 * Pins the production install in `ensureEmailLogSink`, not a copy of the
 * resolver. `registered` is once-per-process, so this file does not reset
 * the resolver between cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmailFrom } from '@quackback/email'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'
import { withWorkspace } from '@/lib/server/__tests__/workspace-scope'
import { ensureEmailLogSink } from '../email-log.sink'

describe('pooled default From', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_FROM', 'Fleet <noreply@fleet.example>')
    ensureEmailLogSink()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is the workspace registry From inside a pooled scope', () => {
    withWorkspace('inst_alpha', () => {
      expect(getEmailFrom()).toBe('support@inst_alpha.example.com')
    })
    withWorkspace('inst_bravo', () => {
      expect(getEmailFrom()).toBe('support@inst_bravo.example.com')
    })
  })

  it('gives two workspaces different From addresses from one process', () => {
    const seen: string[] = []
    withWorkspace('inst_alpha', () => seen.push(getEmailFrom()))
    withWorkspace('inst_bravo', () => seen.push(getEmailFrom()))
    expect(seen).toEqual(['support@inst_alpha.example.com', 'support@inst_bravo.example.com'])
    expect(new Set(seen).size).toBe(2)
  })

  it('falls back to EMAIL_FROM outside a workspace scope', () => {
    expect(getEmailFrom()).toBe('Fleet <noreply@fleet.example>')
  })
})

describe('self-host default From', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_FROM', 'Selfhost <noreply@self.example>')
    vi.stubEnv('QUACKBACK_TENANCY', 'single')
    ensureEmailLogSink()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is EMAIL_FROM with no workspace scope, matching an OSS install', () => {
    expect(getCurrentWorkspace()).toBeNull()
    expect(getEmailFrom()).toBe('Selfhost <noreply@self.example>')
  })
})
