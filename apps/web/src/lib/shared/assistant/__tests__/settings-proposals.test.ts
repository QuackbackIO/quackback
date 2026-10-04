import { describe, expect, it } from 'vitest'
import {
  settingsChangeInputSchema,
  settingsProposalInputSchema,
  selectSettingsChanges,
  settingsProposalSchema,
} from '../settings-proposals'
import { updateThemeSchema } from '@/lib/shared/schemas/settings'

const changes = [
  {
    id: 'branding.light.primary',
    area: 'branding',
    path: ['light', 'primary'],
    before: '#111111',
    after: '#0F766E',
    settingsHref: '/admin/settings/branding',
  },
  {
    id: 'messenger.enabled',
    area: 'messenger',
    path: ['enabled'],
    before: false,
    after: true,
    settingsHref: '/admin/settings/widget',
  },
]

describe('settings proposals', () => {
  it('accepts a website only as proposal input and keeps persisted settings website-free', () => {
    const input = {
      changes: [
        { area: 'branding', patch: { website: 'https://example.com/docs' } },
        { area: 'messenger', patch: { enabled: true } },
      ],
    }
    expect(settingsProposalInputSchema.parse(input)).toEqual(input)
    for (const website of ['example.com:443', 'http://example.com:80', 'http://example.com:443'])
      expect(
        settingsProposalInputSchema.safeParse({
          changes: [{ area: 'branding', patch: { website } }],
        }).success
      ).toBe(true)
    expect(settingsChangeInputSchema.safeParse(input.changes[0]).success).toBe(false)
    for (const website of [
      'javascript:alert(1)',
      'https://you:password@example.com',
      '',
      'example.com:8080',
      'https://example.com:8443/docs',
      'http://example.com:22',
    ])
      expect(
        settingsProposalInputSchema.safeParse({
          changes: [{ area: 'branding', patch: { website } }],
        }).success
      ).toBe(false)
    expect(
      settingsProposalInputSchema.safeParse({
        changes: [
          { area: 'branding', patch: { website: 'example.com', logoKey: 'logos/other.png' } },
        ],
      }).success
    ).toBe(false)
    expect(
      settingsProposalInputSchema.safeParse({
        changes: [
          { area: 'branding', patch: { website: 'example.com' } },
          { area: 'branding', patch: { website: 'https://other.example.com' } },
        ],
      }).success
    ).toBe(false)
    expect(
      settingsProposalSchema.safeParse({
        kind: 'settings',
        version: 1,
        changes: [
          { ...changes[0], id: 'branding.website', path: ['website'], after: 'example.com' },
        ],
      }).success
    ).toBe(false)
  })
  it('rejects injected font and shadow CSS in model branding patches', () => {
    for (const light of [
      { fontSans: 'Inter; } body { display: none' },
      { fontSans: 'url(https://example.com/font)' },
      { primary: 'var(--unsafe)' },
      { radius: '1rem; color: red' },
      { shadow: '0px 1px; background: url(https://example.com/image)' },
    ]) {
      expect(
        settingsChangeInputSchema.safeParse({ area: 'branding', patch: { light } }).success
      ).toBe(false)
    }
  })
  it('uses a strict typed patch for each area', () => {
    expect(
      settingsChangeInputSchema.parse({
        area: 'messenger',
        patch: { enabled: true, welcomeMessage: 'Hello' },
      })
    ).toEqual({ area: 'messenger', patch: { enabled: true, welcomeMessage: 'Hello' } })
    expect(
      settingsChangeInputSchema.safeParse({ area: 'messenger', patch: { oauth: true } }).success
    ).toBe(false)
    expect(
      settingsChangeInputSchema.safeParse({
        area: 'branding',
        patch: { light: { primary: 'url(javascript:alert(1))' } },
      }).success
    ).toBe(false)
    expect(
      settingsChangeInputSchema.safeParse({
        area: 'branding',
        patch: { logoKey: 'logos/foreign.png' },
      }).success
    ).toBe(false)
    expect(
      settingsChangeInputSchema.safeParse({ area: 'billing', patch: { plan: 'business' } }).success
    ).toBe(false)
    expect(
      settingsChangeInputSchema.safeParse({ area: 'modules', patch: { feedback: false } }).success
    ).toBe(false)
    expect(
      settingsChangeInputSchema.safeParse({ area: 'portal', patch: { displayName: '   ' } }).success
    ).toBe(false)
    expect(
      settingsChangeInputSchema.safeParse({
        area: 'portal',
        patch: { headerDisplayName: 'Ideas' },
      }).success
    ).toBe(false)
    expect(
      settingsChangeInputSchema.safeParse({
        area: 'portal',
        patch: { headerDisplayMode: 'logo_only' },
      }).success
    ).toBe(false)
  })
  it('limits model branding patches to tokens consumed by the production theme', () => {
    for (const patch of [
      { preset: 'default' },
      { light: { primaryForeground: '#123456' } },
      { light: { accentInk: '#123456' } },
      { light: { chart1: '#123456' } },
      { light: { sidebarBackground: '#123456' } },
      { light: { shadowMd: '0 1px 2px #111111' } },
    ]) {
      expect(settingsChangeInputSchema.safeParse({ area: 'branding', patch }).success).toBe(false)
      expect(updateThemeSchema.safeParse({ brandingConfig: patch }).success).toBe(true)
    }
    expect(
      settingsChangeInputSchema.parse({
        area: 'branding',
        patch: {
          themeMode: 'dark',
          light: { primary: '#0F766E', fontSans: 'Inter', radius: '1rem' },
        },
      })
    ).toMatchObject({ area: 'branding', patch: { light: { primary: '#0F766E' } } })
  })
  it('takes a partial office hours patch without restating or defaulting the rest', () => {
    expect(
      settingsChangeInputSchema.parse({ area: 'office_hours', patch: { enabled: true } })
    ).toEqual({ area: 'office_hours', patch: { enabled: true } })
    expect(
      settingsChangeInputSchema.parse({
        area: 'office_hours',
        patch: { intervals: [{ day: 1, start: '09:00', end: '17:00' }] },
      }).patch
    ).toEqual({ intervals: [{ day: 1, start: '09:00', end: '17:00' }] })
    expect(
      settingsChangeInputSchema.safeParse({
        area: 'office_hours',
        patch: { timezone: 'Not/AZone' },
      }).success
    ).toBe(false)
    expect(
      settingsChangeInputSchema.safeParse({ area: 'office_hours', patch: { open: true } }).success
    ).toBe(false)
  })
  it('selects stored changes without accepting a client patch', () => {
    const proposal = settingsProposalSchema.parse({ kind: 'settings', version: 1, changes })
    expect(selectSettingsChanges(proposal, ['messenger.enabled'])).toEqual([changes[1]])
    expect(() => selectSettingsChanges(proposal, ['billing.plan'])).toThrow()
    expect(() => selectSettingsChanges(proposal, [])).toThrow()
    expect(() =>
      selectSettingsChanges(proposal, ['messenger.enabled', 'messenger.enabled'])
    ).toThrow()
  })
  it('rejects duplicated or forged stored change paths', () => {
    expect(
      settingsProposalSchema.safeParse({
        kind: 'settings',
        version: 1,
        changes: [changes[0], changes[0]],
      }).success
    ).toBe(false)
    expect(
      settingsProposalSchema.safeParse({
        kind: 'settings',
        version: 1,
        changes: [{ ...changes[0], id: 'branding.__proto__', path: ['__proto__'] }],
      }).success
    ).toBe(false)
  })
})
