/**
 * Shared typed mock fixtures for upload handler tests.
 *
 * Each fixture satisfies the full type expected by the corresponding mock,
 * derived from the actual function return types via ReturnType.
 */
import type { auth } from '@/lib/server/auth'
import type { db } from '@/lib/server/db'

// Derive types from the actual functions so tests stay in sync
type SessionResult = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
type PrincipalRecord = NonNullable<Awaited<ReturnType<typeof db.query.principal.findFirst>>>

/**
 * Minimal valid magic bytes per allowed image type, so upload fixtures pass
 * the content sniff the same way a real file of that type would.
 */
const IMAGE_MAGIC_BYTES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0],
  'image/gif': [...'GIF89a'].map((c) => c.charCodeAt(0)).concat([0, 0]),
  'image/webp': [...'RIFFxxxxWEBP'].map((c, i) => (i >= 4 && i < 8 ? 0 : c.charCodeAt(0))),
}

/** Create a File whose bytes match its declared image type. */
export function mockImageFile(name: string, type: string, extraBytes = 0): File {
  const magic = IMAGE_MAGIC_BYTES[type]
  if (!magic) throw new Error(`no magic bytes fixture for ${type}`)
  return new File([new Uint8Array([...magic, ...new Array<number>(extraBytes).fill(0)])], name, {
    type,
  })
}

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
    contactEmail: null,
    companyId: null,
    chatAvailability: 'online',
    createdAt: new Date(),
    lastSsoSignInAt: null,
    ...overrides,
  } as PrincipalRecord
}
