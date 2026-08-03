import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args?: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const mockRequireAuth = vi.fn()
vi.mock('../auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

const mockListWidgetApplications = vi.fn()
const mockUpsertWidgetApplication = vi.fn()
const mockUpsertWidgetEnvironmentProfile = vi.fn()
vi.mock('@/lib/server/domains/widget-profiles/widget-profile.service', () => ({
  listWidgetApplications: (...a: unknown[]) => mockListWidgetApplications(...a),
  upsertWidgetApplication: (...a: unknown[]) => mockUpsertWidgetApplication(...a),
  upsertWidgetEnvironmentProfile: (...a: unknown[]) => mockUpsertWidgetEnvironmentProfile(...a),
}))

// db is imported only for its drizzle table type re-exports; a bare object suffices.
vi.mock('@/lib/server/db', () => ({
  widgetApplications: {},
  widgetEnvironmentProfiles: {},
}))

vi.mock('@/lib/shared/utils/date', () => ({
  toIsoString: (d: Date | string) => (typeof d === 'string' ? d : (d as Date).toISOString()),
  toIsoStringOrNull: (d: Date | string | null | undefined) =>
    d == null ? null : typeof d === 'string' ? d : (d as Date).toISOString(),
}))

// Handler registration order in widget-profiles.ts.
const LIST = 0
const UPSERT_APP = 1
const UPSERT_PROFILE = 2

let listHandler: AnyHandler
let upsertAppHandler: AnyHandler
let upsertProfileHandler: AnyHandler

const APP_CREATED = new Date('2026-01-01T00:00:00.000Z')
const APP_UPDATED = new Date('2026-01-02T00:00:00.000Z')
const PROFILE_CREATED = new Date('2026-02-01T00:00:00.000Z')
const PROFILE_UPDATED = new Date('2026-02-02T00:00:00.000Z')
const PROFILE_ARCHIVED = new Date('2026-02-03T00:00:00.000Z')

function makeProfile() {
  return {
    id: 'wp_1',
    applicationId: 'wa_1',
    environment: 'production',
    displayName: 'Prod',
    enabled: true,
    allowedOrigins: ['https://example.com'],
    configOverrides: { theme: 'dark' },
    contentFilters: { feedback: { boardIds: ['board_1'] } },
    supportConfig: { allowChat: true },
    archivedAt: PROFILE_ARCHIVED,
    createdAt: PROFILE_CREATED,
    updatedAt: PROFILE_UPDATED,
  }
}

function makeApp(withProfiles: boolean) {
  return {
    id: 'wa_1',
    key: 'app-key',
    name: 'My App',
    description: 'desc',
    archivedAt: null,
    createdAt: APP_CREATED,
    updatedAt: APP_UPDATED,
    ...(withProfiles ? { profiles: [makeProfile()] } : {}),
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlersByIndex.length === 0) {
    await import('../widget-profiles')
  }
  listHandler = handlersByIndex[LIST]
  upsertAppHandler = handlersByIndex[UPSERT_APP]
  upsertProfileHandler = handlersByIndex[UPSERT_PROFILE]
  mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'admin' } })
})

describe('listWidgetApplicationsFn — serializeApplication + serializeProfile', () => {
  it('serializes applications with their nested profiles', async () => {
    mockListWidgetApplications.mockResolvedValue([makeApp(true)])

    const result = (await listHandler()) as Array<Record<string, unknown>>

    expect(mockRequireAuth).toHaveBeenCalledWith({ roles: ['admin'] })
    expect(result).toHaveLength(1)
    const app = result[0]
    expect(app).toMatchObject({
      id: 'wa_1',
      key: 'app-key',
      name: 'My App',
      description: 'desc',
      archivedAt: null,
      createdAt: APP_CREATED.toISOString(),
      updatedAt: APP_UPDATED.toISOString(),
    })
    const profiles = app.profiles as Array<Record<string, unknown>>
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toEqual({
      id: 'wp_1',
      applicationId: 'wa_1',
      environment: 'production',
      displayName: 'Prod',
      enabled: true,
      allowedOrigins: ['https://example.com'],
      configOverrides: { theme: 'dark' },
      contentFilters: { feedback: { boardIds: ['board_1'] } },
      supportConfig: { allowChat: true },
      archivedAt: PROFILE_ARCHIVED.toISOString(),
      createdAt: PROFILE_CREATED.toISOString(),
      updatedAt: PROFILE_UPDATED.toISOString(),
    })
  })

  it('defaults profiles to an empty array when none are present', async () => {
    mockListWidgetApplications.mockResolvedValue([makeApp(false)])

    const result = (await listHandler()) as Array<{ profiles: unknown[] }>

    expect(result[0].profiles).toEqual([])
  })
})

describe('upsertWidgetApplicationFn', () => {
  it('serializes the created application', async () => {
    mockUpsertWidgetApplication.mockResolvedValue(makeApp(false))

    const result = (await upsertAppHandler({ data: { key: 'app-key', name: 'My App' } })) as Record<
      string,
      unknown
    >

    expect(result.id).toBe('wa_1')
    expect(result.profiles).toEqual([])
  })

  it('returns null when the service returns nothing', async () => {
    mockUpsertWidgetApplication.mockResolvedValue(null)

    const result = await upsertAppHandler({ data: { key: 'app-key', name: 'My App' } })

    expect(result).toBeNull()
  })
})

describe('upsertWidgetEnvironmentProfileFn', () => {
  it('serializes the created profile', async () => {
    mockUpsertWidgetEnvironmentProfile.mockResolvedValue(makeProfile())

    const result = (await upsertProfileHandler({
      data: { applicationId: 'wa_1', environment: 'production' },
    })) as Record<string, unknown>

    expect(result.id).toBe('wp_1')
    expect(result.createdAt).toBe(PROFILE_CREATED.toISOString())
    expect(result.archivedAt).toBe(PROFILE_ARCHIVED.toISOString())
  })

  it('returns null when the service returns nothing', async () => {
    mockUpsertWidgetEnvironmentProfile.mockResolvedValue(null)

    const result = await upsertProfileHandler({
      data: { applicationId: 'wa_1', environment: 'production' },
    })

    expect(result).toBeNull()
  })
})
