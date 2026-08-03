import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

// Hoisted mocks for every dependency the routes touch. The widget-profile
// service is loaded via dynamic `await import(...)`, but `vi.mock` is hoisted
// and intercepts those calls too, so the same pattern as the static-import
// routes works unchanged.
const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listWidgetApplicationsMock: vi.fn(),
  upsertWidgetApplicationMock: vi.fn(),
  upsertWidgetEnvironmentProfileMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
  assertScopeAllowed: (...args: unknown[]) => hoisted.assertScopeAllowedMock(...args),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => hoisted.loadPermissionSetMock(...args),
  hasPermission: (...args: unknown[]) => hoisted.hasPermissionMock(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/domains/widget-profiles/widget-profile.service', () => ({
  listWidgetApplications: (...args: unknown[]) => hoisted.listWidgetApplicationsMock(...args),
  upsertWidgetApplication: (...args: unknown[]) => hoisted.upsertWidgetApplicationMock(...args),
  upsertWidgetEnvironmentProfile: (...args: unknown[]) =>
    hoisted.upsertWidgetEnvironmentProfileMock(...args),
}))

import { Route as EnvironmentsRoute } from '../$applicationId.environments'
import { Route as WidgetProfilesRoute } from '../index'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const widgetHandlers = (WidgetProfilesRoute as unknown as RouteWithHandlers).options.server.handlers
const environmentHandlers = (EnvironmentsRoute as unknown as RouteWithHandlers).options.server
  .handlers

const PRINCIPAL = 'principal_admin'
const APPLICATION = 'widget_app_123'

// Fixed dates so we can assert the serialiser's ISO conversion deterministically.
const CREATED_AT = new Date('2026-01-02T03:04:05.000Z')
const UPDATED_AT = new Date('2026-02-03T04:05:06.000Z')
const ARCHIVED_AT = new Date('2026-03-04T05:06:07.000Z')

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/widget-profiles')
) {
  return { request, params: handlerParams }
}

// An environment profile row carrying real Date objects so the serialiser's
// toIsoString / toIsoStringOrNull branches are exercised.
function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'widget_env_1',
    applicationId: APPLICATION,
    environment: 'production',
    displayName: 'Production',
    enabled: true,
    allowedOrigins: ['https://example.com'],
    configOverrides: { theme: 'dark' },
    contentFilters: { profanity: true },
    supportConfig: { email: 'support@example.com' },
    archivedAt: ARCHIVED_AT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APPLICATION,
    key: 'acme',
    name: 'Acme',
    description: 'An app',
    archivedAt: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

async function readData(response: Response) {
  return (await response.json()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: PRINCIPAL,
    role: 'team',
    key: { scopes: [] },
  })
  hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
  hoisted.hasPermissionMock.mockReturnValue(true)
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
})

describe('GET /api/v1/widget-profiles', () => {
  it('lists widget applications with serialised environment profiles', async () => {
    const app = applicationRow({ profiles: [profileRow()] })
    hoisted.listWidgetApplicationsMock.mockResolvedValue([app])

    const response = await widgetHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.WIDGET_VIEW
    )
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith(PRINCIPAL)
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(expect.any(Set), PERMISSIONS.WIDGET_VIEW)

    const data = await readData(response)
    // Dates are serialised to ISO strings; profiles are nested + serialised.
    expect(data).toEqual([
      {
        id: APPLICATION,
        key: 'acme',
        name: 'Acme',
        description: 'An app',
        archivedAt: null,
        createdAt: CREATED_AT.toISOString(),
        updatedAt: UPDATED_AT.toISOString(),
        profiles: [
          {
            id: 'widget_env_1',
            applicationId: APPLICATION,
            environment: 'production',
            displayName: 'Production',
            enabled: true,
            allowedOrigins: ['https://example.com'],
            configOverrides: { theme: 'dark' },
            contentFilters: { profanity: true },
            supportConfig: { email: 'support@example.com' },
            archivedAt: ARCHIVED_AT.toISOString(),
            createdAt: CREATED_AT.toISOString(),
            updatedAt: UPDATED_AT.toISOString(),
          },
        ],
      },
    ])
  })

  it('defaults profiles to an empty array when the application has none', async () => {
    // Covers the `app.profiles ?? []` branch in serializeWidgetApplication.
    const app = applicationRow({ profiles: undefined })
    hoisted.listWidgetApplicationsMock.mockResolvedValue([app])

    const response = await widgetHandlers.GET(args())

    expect(response.status).toBe(200)
    const data = await readData(response)
    expect(data[0].profiles).toEqual([])
  })

  it('returns 403 when the principal lacks widget.view', async () => {
    hoisted.hasPermissionMock.mockReturnValueOnce(false)

    const response = await widgetHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.listWidgetApplicationsMock).not.toHaveBeenCalled()
  })

  it('routes domain errors through handleDomainError', async () => {
    // Covers the catch branch of the GET handler.
    hoisted.listWidgetApplicationsMock.mockRejectedValue(new Error('boom'))

    const response = await widgetHandlers.GET(args())

    expect(response.status).toBe(500)
  })
})

describe('POST /api/v1/widget-profiles', () => {
  it('creates or updates a widget application and returns 201', async () => {
    // Application returned without a `profiles` field also exercises the
    // `?? []` default inside serializeWidgetApplication on the create path.
    const app = applicationRow()
    hoisted.upsertWidgetApplicationMock.mockResolvedValue(app)

    const response = await widgetHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/widget-profiles', 'POST', {
          id: APPLICATION,
          key: 'acme',
          name: 'Acme',
          description: 'An app',
        })
      )
    )

    expect(response.status).toBe(201)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.WIDGET_MANAGE
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.WIDGET_MANAGE
    )
    expect(hoisted.upsertWidgetApplicationMock).toHaveBeenCalledWith({
      id: APPLICATION,
      key: 'acme',
      name: 'Acme',
      description: 'An app',
    })

    const data = await readData(response)
    expect(data.id).toBe(APPLICATION)
    expect(data.createdAt).toBe(CREATED_AT.toISOString())
    expect(data.profiles).toEqual([])
  })

  it('returns 403 when the principal lacks widget.manage', async () => {
    hoisted.hasPermissionMock.mockReturnValueOnce(false)

    const response = await widgetHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/widget-profiles', 'POST', { key: 'acme', name: 'Acme' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.upsertWidgetApplicationMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body and does not call the service', async () => {
    const response = await widgetHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/widget-profiles', 'POST', { key: '', name: '' }))
    )

    expect(response.status).toBe(400)
    expect(hoisted.upsertWidgetApplicationMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the request body is not valid JSON', async () => {
    // `request.json().catch(() => null)` yields null, which fails safeParse.
    const badRequest = new Request('http://test/api/v1/widget-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const response = await widgetHandlers.POST(args({}, badRequest))

    expect(response.status).toBe(400)
    expect(hoisted.upsertWidgetApplicationMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the upsert resolves to no application', async () => {
    hoisted.upsertWidgetApplicationMock.mockResolvedValue(null)

    const response = await widgetHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/widget-profiles', 'POST', { key: 'acme', name: 'Acme' })
      )
    )

    expect(response.status).toBe(404)
  })

  it('routes domain errors through handleDomainError', async () => {
    hoisted.upsertWidgetApplicationMock.mockRejectedValue(new Error('boom'))

    const response = await widgetHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/widget-profiles', 'POST', { key: 'acme', name: 'Acme' })
      )
    )

    expect(response.status).toBe(500)
  })
})

describe('POST /api/v1/widget-profiles/:applicationId/environments', () => {
  it('creates an environment profile and returns 201', async () => {
    hoisted.upsertWidgetEnvironmentProfileMock.mockResolvedValue(profileRow())

    const response = await environmentHandlers.POST(
      args(
        { applicationId: APPLICATION },
        jsonRequest('http://test/api/v1/widget-profiles/widget_app_123/environments', 'POST', {
          id: 'widget_env_1',
          environment: 'production',
          displayName: 'Production',
          enabled: true,
          allowedOrigins: ['https://example.com'],
          configOverrides: { theme: 'dark' },
          contentFilters: { profanity: true },
          supportConfig: { email: 'support@example.com' },
        })
      )
    )

    expect(response.status).toBe(201)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.WIDGET_MANAGE
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(
      APPLICATION,
      'widget_app',
      'application ID'
    )
    // The applicationId from the path is merged into the parsed body.
    expect(hoisted.upsertWidgetEnvironmentProfileMock).toHaveBeenCalledWith({
      id: 'widget_env_1',
      environment: 'production',
      displayName: 'Production',
      enabled: true,
      allowedOrigins: ['https://example.com'],
      configOverrides: { theme: 'dark' },
      contentFilters: { profanity: true },
      supportConfig: { email: 'support@example.com' },
      applicationId: APPLICATION,
    })

    const data = await readData(response)
    expect(data.id).toBe('widget_env_1')
    expect(data.archivedAt).toBe(ARCHIVED_AT.toISOString())
    expect(data.createdAt).toBe(CREATED_AT.toISOString())
  })

  it('serialises a null archivedAt as null', async () => {
    // Covers the null branch of toIsoStringOrNull in the profile serialiser.
    hoisted.upsertWidgetEnvironmentProfileMock.mockResolvedValue(profileRow({ archivedAt: null }))

    const response = await environmentHandlers.POST(
      args(
        { applicationId: APPLICATION },
        jsonRequest('http://test/api/v1/widget-profiles/widget_app_123/environments', 'POST', {
          environment: 'staging',
        })
      )
    )

    expect(response.status).toBe(201)
    const data = await readData(response)
    expect(data.archivedAt).toBeNull()
  })

  it('returns 403 when the principal lacks widget.manage', async () => {
    hoisted.hasPermissionMock.mockReturnValueOnce(false)

    const response = await environmentHandlers.POST(
      args(
        { applicationId: APPLICATION },
        jsonRequest('http://test/api/v1/widget-profiles/widget_app_123/environments', 'POST', {
          environment: 'production',
        })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.upsertWidgetEnvironmentProfileMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body and does not call the service', async () => {
    const response = await environmentHandlers.POST(
      args(
        { applicationId: APPLICATION },
        jsonRequest('http://test/api/v1/widget-profiles/widget_app_123/environments', 'POST', {
          environment: '',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.upsertWidgetEnvironmentProfileMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the upsert resolves to no profile', async () => {
    hoisted.upsertWidgetEnvironmentProfileMock.mockResolvedValue(null)

    const response = await environmentHandlers.POST(
      args(
        { applicationId: APPLICATION },
        jsonRequest('http://test/api/v1/widget-profiles/widget_app_123/environments', 'POST', {
          environment: 'production',
        })
      )
    )

    expect(response.status).toBe(404)
  })

  it('routes domain errors through handleDomainError', async () => {
    hoisted.upsertWidgetEnvironmentProfileMock.mockRejectedValue(new Error('boom'))

    const response = await environmentHandlers.POST(
      args(
        { applicationId: APPLICATION },
        jsonRequest('http://test/api/v1/widget-profiles/widget_app_123/environments', 'POST', {
          environment: 'production',
        })
      )
    )

    expect(response.status).toBe(500)
  })
})

describe('PUT /api/v1/widget-profiles/:applicationId/environments', () => {
  it('creates or updates an environment profile and returns 200', async () => {
    // The PUT path shares upsertProfileHandler but passes created=false, so a
    // successful upsert returns 200 rather than 201.
    hoisted.upsertWidgetEnvironmentProfileMock.mockResolvedValue(profileRow())

    const response = await environmentHandlers.PUT(
      args(
        { applicationId: APPLICATION },
        jsonRequest('http://test/api/v1/widget-profiles/widget_app_123/environments', 'PUT', {
          environment: 'production',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(hoisted.upsertWidgetEnvironmentProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'production', applicationId: APPLICATION })
    )
  })

  it('returns 403 when the principal lacks widget.manage', async () => {
    hoisted.hasPermissionMock.mockReturnValueOnce(false)

    const response = await environmentHandlers.PUT(
      args(
        { applicationId: APPLICATION },
        jsonRequest('http://test/api/v1/widget-profiles/widget_app_123/environments', 'PUT', {
          environment: 'production',
        })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.upsertWidgetEnvironmentProfileMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body', async () => {
    const response = await environmentHandlers.PUT(
      args(
        { applicationId: APPLICATION },
        jsonRequest('http://test/api/v1/widget-profiles/widget_app_123/environments', 'PUT', {})
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.upsertWidgetEnvironmentProfileMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the upsert resolves to no profile', async () => {
    hoisted.upsertWidgetEnvironmentProfileMock.mockResolvedValue(null)

    const response = await environmentHandlers.PUT(
      args(
        { applicationId: APPLICATION },
        jsonRequest('http://test/api/v1/widget-profiles/widget_app_123/environments', 'PUT', {
          environment: 'production',
        })
      )
    )

    expect(response.status).toBe(404)
  })
})
