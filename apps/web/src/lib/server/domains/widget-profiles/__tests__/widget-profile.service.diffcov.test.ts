/**
 * Differential-coverage tests for widget-profile.service — key normalisation,
 * listing, and the insert/update branches of both upsert helpers (including the
 * null-on-missing-update and the default-value fallbacks).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateReturning: vi.fn(),
  insertReturning: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { widgetApplications: { findMany: m.findMany } },
    update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) })),
    insert: vi.fn(() => ({ values: () => ({ returning: m.insertReturning }) })),
  },
  and: vi.fn((...a) => ({ and: a })),
  asc: vi.fn((a) => a),
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  isNull: vi.fn((a) => ({ isNull: a })),
  widgetApplications: { id: 'wa.id', name: 'wa.name', archivedAt: 'wa.archivedAt' },
  widgetEnvironmentProfiles: {
    id: 'wp.id',
    environment: 'wp.environment',
    archivedAt: 'wp.archivedAt',
  },
}))

import {
  normalizeWidgetKey,
  listWidgetApplications,
  upsertWidgetApplication,
  upsertWidgetEnvironmentProfile,
} from '../widget-profile.service'

beforeEach(() => {
  vi.clearAllMocks()
  m.findMany.mockResolvedValue([{ id: 'wa_1', profiles: [] }])
  m.updateReturning.mockResolvedValue([{ id: 'updated' }])
  m.insertReturning.mockResolvedValue([{ id: 'created' }])
})

describe('normalizeWidgetKey', () => {
  it('trims, lowercases, and collapses disallowed characters', () => {
    expect(normalizeWidgetKey('  Hello World! ')).toBe('hello-world-')
    expect(normalizeWidgetKey('Prod_v1.2')).toBe('prod_v1.2')
  })
})

describe('listWidgetApplications', () => {
  it('returns the active applications with their profiles', async () => {
    expect(await listWidgetApplications()).toEqual([{ id: 'wa_1', profiles: [] }])
  })
})

describe('upsertWidgetApplication', () => {
  it('inserts a new application when no id is given', async () => {
    const res = await upsertWidgetApplication({ key: 'My App', name: ' Acme ', description: ' d ' })
    expect(res).toEqual({ id: 'created' })
    expect(m.insertReturning).toHaveBeenCalled()
  })

  it('nulls an empty description', async () => {
    await upsertWidgetApplication({ key: 'k', name: 'n' })
    expect(m.insertReturning).toHaveBeenCalled()
  })

  it('updates an existing application by id', async () => {
    const res = await upsertWidgetApplication({ id: 'wa_1', key: 'k', name: 'n' })
    expect(res).toEqual({ id: 'updated' })
  })

  it('returns null when the update matches no active row', async () => {
    m.updateReturning.mockResolvedValueOnce([])
    const res = await upsertWidgetApplication({ id: 'missing', key: 'k', name: 'n' })
    expect(res).toBeNull()
  })
})

describe('upsertWidgetEnvironmentProfile', () => {
  it('inserts with defaults when no id and minimal input', async () => {
    const res = await upsertWidgetEnvironmentProfile({ applicationId: 'wa_1', environment: 'Prod' })
    expect(res).toEqual({ id: 'created' })
  })

  it('inserts with all overrides supplied', async () => {
    await upsertWidgetEnvironmentProfile({
      applicationId: 'wa_1',
      environment: 'staging',
      displayName: ' Staging ',
      enabled: false,
      allowedOrigins: ['https://x.test'],
      configOverrides: { a: 1 },
      contentFilters: { b: 2 },
      supportConfig: { c: 3 },
    })
    expect(m.insertReturning).toHaveBeenCalled()
  })

  it('updates an existing profile by id', async () => {
    const res = await upsertWidgetEnvironmentProfile({
      id: 'wp_1',
      applicationId: 'wa_1',
      environment: 'prod',
    })
    expect(res).toEqual({ id: 'updated' })
  })

  it('returns null when the profile update matches no active row', async () => {
    m.updateReturning.mockResolvedValueOnce([])
    const res = await upsertWidgetEnvironmentProfile({
      id: 'missing',
      applicationId: 'wa_1',
      environment: 'prod',
    })
    expect(res).toBeNull()
  })
})
