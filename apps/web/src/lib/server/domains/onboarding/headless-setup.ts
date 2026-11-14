/**
 * First-run setup without a browser.
 *
 * An operator who can reach the server but not click through the wizard sets a
 * `SETUP_TOKEN` (or reads the one the server prints on first boot) and calls
 * `POST /api/v1/setup` once. The request creates the first admin and the
 * workspace through the same code the wizard's workspace step runs
 * ({@link setupWorkspaceForUser}), then mints the workspace's first API key.
 *
 * The token is the operator's word that they own the install, so it works only
 * while there is nobody to own it yet: the moment a human admin exists, or the
 * workspace belongs to a control plane, the endpoint answers "already set up"
 * and the token opens nothing.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { PrincipalId, RoleId, UserId } from '@quackback/ids'
import type { Role } from '@/lib/shared/roles'
import { db, eq, principal, roles, session, user } from '@/lib/server/db'
import { recordAuditEvent } from '@/lib/server/audit/log'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import { API_KEY_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { SYSTEM_ROLES } from '@/lib/shared/permissions'
import {
  findHumanAdmin,
  isOpenToBootstrapClaim,
  isSetupOpenToClaim,
  namedSetupOwnerEmail,
} from '@/lib/server/domains/principals/bootstrap-admin'
import { createPortalUser } from '@/lib/server/domains/users/user.create'
import { setupWorkspaceForUser } from '@/lib/server/domains/onboarding/setup-workspace'
import {
  clearGeneratedToken,
  readGeneratedTokenHash,
  storeGeneratedTokenHash,
} from '@/lib/server/domains/onboarding/setup-token-store'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'headless-setup' })

/** Where the hash of a server-generated token lives until setup finishes. */
const GENERATED_TOKEN_PREFIX = 'qbs_'

/** An operator-chosen token shorter than this is ignored: it would be guessable. */
export const MIN_SETUP_TOKEN_LENGTH = 32

export const headlessSetupSchema = z.object({
  workspaceName: z
    .string()
    .trim()
    .min(2, 'workspaceName must be at least 2 characters')
    .max(100, 'workspaceName must be 100 characters or less'),
  adminEmail: z.string().trim().toLowerCase().email('adminEmail must be an email address').max(320),
  adminName: z
    .string()
    .trim()
    .min(2, 'adminName must be at least 2 characters')
    .max(100, 'adminName must be 100 characters or less'),
})

export type HeadlessSetupInput = z.infer<typeof headlessSetupSchema>

const sha256 = (value: string) => createHash('sha256').update(value).digest()

/** The token the operator put in the environment, or null when unset or too short. */
function configuredToken(): string | null {
  const raw = process.env.SETUP_TOKEN?.trim()
  if (!raw) return null
  return raw.length >= MIN_SETUP_TOKEN_LENGTH ? raw : null
}

/**
 * Constant-time comparison. Both sides are hashed first so the comparison runs
 * over equal-length digests whatever the caller sent: neither the content nor
 * the length of the real token is observable through timing.
 */
function digestsEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

export type SetupTokenCheck = 'ok' | 'invalid' | 'not_configured'

/**
 * Checks a presented bearer token against the environment's `SETUP_TOKEN`
 * and, failing that, the token the server generated on first boot.
 * `not_configured` means neither exists, so the endpoint should not exist.
 */
export async function verifySetupToken(presented: string): Promise<SetupTokenCheck> {
  const presentedDigest = sha256(presented)
  const fromEnv = configuredToken()
  const stored = await readGeneratedTokenHash()
  if (!fromEnv && !stored) return 'not_configured'

  // Evaluate both so the time taken does not say which source matched.
  const envMatch = fromEnv ? digestsEqual(presentedDigest, sha256(fromEnv)) : false
  const storedMatch = stored ? digestsEqual(presentedDigest, Buffer.from(stored, 'hex')) : false
  return envMatch || storedMatch ? 'ok' : 'invalid'
}

/** Is this install still waiting for its first admin? */
export async function isAwaitingFirstAdmin(): Promise<boolean> {
  if (await findHumanAdmin(db)) return false
  if (!(await isOpenToBootstrapClaim(db))) return false
  return isSetupOpenToClaim(db)
}

/**
 * On the first boot of an install that is still awaiting its first admin and
 * has no `SETUP_TOKEN`, generates a token and writes it to the log once. Only
 * its hash is stored, so a restart cannot print it again and a database
 * reader cannot recover it. An install that is already set up, or provisioned
 * by a control plane, gets nothing.
 */
export async function ensureBootSetupToken(): Promise<void> {
  if (!(await isAwaitingFirstAdmin())) {
    // Nothing left to open: forget any token an earlier boot generated.
    await clearGeneratedToken()
    return
  }
  if (configuredToken()) {
    log.info('SETUP_TOKEN is set: POST /api/v1/setup can create the first admin')
    return
  }
  if (process.env.SETUP_TOKEN?.trim()) {
    log.warn(
      { min_length: MIN_SETUP_TOKEN_LENGTH },
      'SETUP_TOKEN is shorter than the minimum and is ignored'
    )
  }
  // The operator already named who sets this install up. That is the answer to
  // "who may claim it", and a token anyone with log access could use is not.
  if (namedSetupOwnerEmail()) return

  const token = `${GENERATED_TOKEN_PREFIX}${randomBytes(24).toString('hex')}`
  if (!(await storeGeneratedTokenHash(sha256(token).toString('hex')))) return
  log.info(
    { setup_token: token },
    'First-run setup token (shown once, valid until the first admin exists). ' +
      'Send it as "Authorization: Bearer <token>" to POST /api/v1/setup, or set SETUP_TOKEN to choose your own.'
  )
}

export type HeadlessSetupResult =
  | {
      ok: true
      workspace: { id: string; name: string; slug: string }
      admin: { userId: UserId; principalId: PrincipalId; email: string; name: string }
      apiKey: { id: string; name: string; key: string }
      /** The address already had a verified account, which was promoted. */
      reusedExistingAccount: boolean
    }
  | { ok: false; reason: 'already_set_up' | 'account_unverified' }

/**
 * Creates the first admin and the workspace, and mints the setup key. The
 * caller has already verified the setup token.
 *
 * The setup key is a workspace key with the Owner role, not the admin's
 * personal key: a personal key acts as its creator, so a bot replying through
 * it would count as the admin's own reply and meet first-response and SLA
 * targets at once. A workspace key's replies stay automated. The admin is
 * recorded as its creator.
 */
export async function runHeadlessSetup(
  input: HeadlessSetupInput,
  headers?: Headers
): Promise<HeadlessSetupResult> {
  if (!(await isAwaitingFirstAdmin())) return { ok: false, reason: 'already_set_up' }

  // The address may already have an account. Only a verified one is reused:
  // on an install nobody has claimed, anyone can register an address with a
  // password they chose, and promoting that account would hand them the admin
  // role meant for the real owner of the address. Otherwise the operator
  // vouches for the address, as an admin-created account means everywhere else.
  const existing = await db.query.user.findFirst({
    where: eq(user.email, input.adminEmail),
    columns: { id: true, emailVerified: true },
  })
  if (existing && !existing.emailVerified) return { ok: false, reason: 'account_unverified' }
  const reusedExistingAccount = Boolean(existing)
  const userId: UserId = existing
    ? (existing.id as UserId)
    : (await createPortalUser({ name: input.adminName, email: input.adminEmail })).userId

  const saved = await setupWorkspaceForUser({
    userId,
    data: { workspaceName: input.workspaceName, userName: input.adminName },
    locale: undefined,
    operatorAuthorized: true,
  })
  if (!saved.ok) return { ok: false, reason: 'already_set_up' }

  // A reused account may hold sessions the operator never saw; the admin role
  // starts from a clean sign-in.
  if (reusedExistingAccount) await db.delete(session).where(eq(session.userId, userId))

  const admin = await db.query.principal.findFirst({
    where: eq(principal.userId, userId),
    columns: { id: true, role: true },
  })
  if (!admin) throw new Error('Setup finished without an admin principal')
  const principalId = admin.id as PrincipalId
  const adminRole = admin.role as Role

  const [owner] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, SYSTEM_ROLES.OWNER))
    .limit(1)
  if (!owner) throw new Error('Setup finished without the Owner role')
  const { apiKey, plainTextKey } = await createApiKey(
    { name: 'Setup key', scopes: API_KEY_SCOPES, kind: 'workspace', roleId: owner.id as RoleId },
    principalId,
    // The grant ceiling reads the principal as stored, so a setup that somehow
    // left no admin tier is refused rather than handed an Owner key.
    {
      role: adminRole,
      permissions: [...(await permissionsForPrincipal(principalId, adminRole))],
    },
    { source: 'setup_token' }
  )

  await recordAuditEvent({
    event: 'workspace.setup.completed',
    actor: { userId, email: input.adminEmail, role: 'admin', type: 'user' },
    headers,
    target: { type: 'workspace', id: saved.id },
    metadata: { via: 'setup_token', apiKeyId: apiKey.id, reusedExistingAccount },
  })
  await clearGeneratedToken()
  log.info({ workspace_id: saved.id, user_id: userId }, 'first admin created through setup token')

  return {
    ok: true,
    workspace: { id: saved.id, name: saved.name, slug: saved.slug },
    admin: { userId, principalId, email: input.adminEmail, name: input.adminName },
    apiKey: { id: apiKey.id, name: apiKey.name, key: plainTextKey },
    reusedExistingAccount,
  }
}
