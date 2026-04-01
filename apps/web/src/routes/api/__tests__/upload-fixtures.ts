/**
 * Shared typed mock fixtures for upload handler tests.
 *
 * Each fixture satisfies the full type expected by the corresponding mock,
 * derived from the actual function return types via ReturnType.
 */
import type { auth } from '@/lib/server/auth'
import type { db } from '@/lib/server/db'
import type { WidgetConfig } from '@/lib/server/domains/settings/settings.types'

// Derive types from the actual functions so tests stay in sync
type SessionResult = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
type PrincipalRecord = NonNullable<Awaited<ReturnType<typeof db.query.principal.findFirst>>>
type SessionRecord = NonNullable<Awaited<ReturnType<typeof db.query.session.findFirst>>>

/** Create a mock Better Auth session result */
export function mockSession(
  overrides: Partial<{ user: Partial<SessionResult['user']> }> = {}
): SessionResult {
  return {
    session: {
      id: 'test-session-id',
      token: 'test-token',
      userId: 'user_test1',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: 'user_test1',
      email: 'user@example.com',
      name: 'User',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides.user,
    },
  } as SessionResult
}

/** Create a mock principal record */
export function mockPrincipal(
  overrides: Partial<Pick<PrincipalRecord, 'type' | 'role'>> = {}
): PrincipalRecord {
  return {
    id: 'principal_test1',
    userId: 'user_test1',
    role: 'user',
    type: 'user',
    displayName: null,
    avatarUrl: null,
    avatarKey: null,
    serviceMetadata: null,
    createdAt: new Date(),
    ...overrides,
  } as PrincipalRecord
}

/** Create a mock DB session record (for widget Bearer token auth) */
export function mockDbSession(
  overrides: Partial<Pick<SessionRecord, 'token' | 'userId'>> = {}
): SessionRecord {
  return {
    id: 'test-session-id',
    token: 'valid-token',
    userId: 'user_test1',
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ipAddress: null,
    userAgent: null,
    ...overrides,
  } as SessionRecord
}

/** Create a mock widget config */
export function mockWidgetConfig(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    enabled: true,
    imageUploadsInWidget: true,
    ...overrides,
  }
}
