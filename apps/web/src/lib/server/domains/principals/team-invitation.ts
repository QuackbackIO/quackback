/**
 * Team invitations by email: where an address stands, the grant ceiling on
 * the invited role, and the mint / insert / deliver steps the add-people
 * batch (team-additions.ts, the one invite path) composes.
 */
import {
  generateId,
  type InviteId,
  type PrincipalId,
  type RoleId,
  type UserId,
} from '@quackback/ids'
import {
  and,
  db,
  eq,
  inArray,
  invitation,
  principal,
  sql,
  user,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import { sendInvitationEmail } from '@quackback/email'
import { getBaseUrl } from '@/lib/server/config'
import {
  INVITATION_EXPIRY_MS,
  generateInvitationMagicLink,
} from '@/lib/server/functions/invitation-magic-link'
import { ValidationError } from '@/lib/shared/errors'
import type { PermissionKey } from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'
import { assertCanGrantTeamRole } from '@/lib/server/domains/roles/role.grants'
import { mapWithConcurrency } from '@/lib/server/utils/concurrency'

/** Links minted at once; each mint writes a verification row. */
const MINT_CONCURRENCY = 5

/** The person granting team access, as resolved at the request gate. */
export interface TeamGranter {
  principalId: PrincipalId
  userId: UserId
  name: string
  role: Role
  permissions: readonly PermissionKey[]
}

/** The request's caller as a team granter: who they are and the ceiling they grant under. */
export function teamGranterFromAuth(auth: AuthContext): TeamGranter {
  return {
    principalId: auth.principal.id,
    userId: auth.user.id,
    name: auth.user.name,
    role: auth.principal.role,
    permissions: auth.permissions,
  }
}

/** Workspace branding carried into the invitation email. */
export interface InviteWorkspace {
  name: string
  logoKey: string | null
}

export type InviteEmailStatus =
  | { status: 'new'; principalId?: PrincipalId; userId?: UserId }
  | {
      status: 'pending_invite'
      invitationId: InviteId
      invitedAt: Date
      role: string
      roleId: RoleId | null
    }
  | { status: 'member'; principalId: PrincipalId }

/**
 * Where each email stands for a team invite: a pending team invite, an
 * existing teammate, or invitable ('new', which includes a portal user
 * holding that address: accepting the invite promotes them). Two queries for
 * the whole list, matched case-insensitively. `emails` must be lowercased.
 * Pass the write transaction as `executor` to re-check under the seat-ledger
 * lock.
 */
export async function classifyInviteEmails(
  emails: readonly string[],
  executor: Database | Transaction = db
): Promise<Map<string, InviteEmailStatus>> {
  const out = new Map<string, InviteEmailStatus>()
  if (emails.length === 0) return out
  const list = [...emails]
  const [pending, people] = await Promise.all([
    executor
      .select({
        id: invitation.id,
        email: sql<string>`lower(${invitation.email})`,
        createdAt: invitation.createdAt,
        role: invitation.role,
        roleId: invitation.roleId,
      })
      .from(invitation)
      .where(
        and(
          eq(invitation.kind, 'team'),
          eq(invitation.status, 'pending'),
          inArray(sql`lower(${invitation.email})`, list)
        )
      ),
    executor
      .select({
        userId: user.id,
        email: sql<string>`lower(${user.email})`,
        principalId: principal.id,
        role: principal.role,
      })
      .from(user)
      .leftJoin(principal, eq(principal.userId, user.id))
      .where(inArray(sql`lower(${user.email})`, list)),
  ])

  for (const p of people) {
    if (p.principalId && p.role && p.role !== 'user') {
      out.set(p.email, { status: 'member', principalId: p.principalId as PrincipalId })
    } else {
      out.set(p.email, {
        status: 'new',
        principalId: (p.principalId as PrincipalId | null) ?? undefined,
        userId: p.userId as UserId,
      })
    }
  }
  // A pending invite is reported ahead of the person it addresses.
  for (const inv of pending) {
    out.set(inv.email, {
      status: 'pending_invite',
      invitationId: inv.id as InviteId,
      invitedAt: inv.createdAt,
      role: inv.role ?? 'member',
      roleId: (inv.roleId as RoleId | null) ?? null,
    })
  }
  for (const email of list) if (!out.has(email)) out.set(email, { status: 'new' })
  return out
}

/** classifyInviteEmails for one address. */
export async function classifyInviteEmail(email: string): Promise<InviteEmailStatus> {
  return (await classifyInviteEmails([email])).get(email) ?? { status: 'new' }
}

/**
 * The grant ceiling on an invited role: a custom role rides 'member', never
 * points at the Owner preset and stays within the inviter's own permissions;
 * the Admin role is granted only by an admin. Returns the custom role's name.
 */
export async function assertInviteGrant(
  role: 'admin' | 'member',
  roleId: RoleId | undefined,
  granter: Pick<TeamGranter, 'role' | 'permissions'>
): Promise<string | null> {
  let roleName: string | null = null
  if (roleId) {
    if (role !== 'member') {
      throw new ValidationError('VALIDATION_ERROR', 'Custom role invites use the member role')
    }
    const { assertGrantableRole } = await import('@/lib/server/domains/roles/role.grants')
    roleName = (await assertGrantableRole(roleId, granter.permissions)).name
  }
  assertCanGrantTeamRole(role, granter.role)
  return roleName
}

export interface MintedTeamInvite {
  invitationId: InviteId
  email: string
  inviteLink: string
  magicLinkToken: string
  minted: Awaited<ReturnType<typeof generateInvitationMagicLink>>
}

/**
 * Mint the invite's magic link before the insert so the row records its token
 * in its token set (cancel revokes every token in the set). The invitation id
 * is fixed here, so the callback path is already known.
 */
async function mintTeamInvite(email: string): Promise<MintedTeamInvite> {
  const invitationId = generateId('invite')
  const portalUrl = getBaseUrl()
  const callbackURL = `/complete-signup/${invitationId}`
  const minted = await generateInvitationMagicLink(email, callbackURL, portalUrl)
  return {
    invitationId,
    email,
    inviteLink: minted.url,
    magicLinkToken: minted.token,
    minted,
  }
}

/**
 * Mint links for a batch of emails, a few at a time. Links minted before a
 * failure are returned through `onMinted` so the caller can revoke them.
 */
export async function mintTeamInvites(
  emails: readonly string[],
  onMinted: (invite: MintedTeamInvite) => void
): Promise<MintedTeamInvite[]> {
  const minted: MintedTeamInvite[] = new Array(emails.length)
  await mapWithConcurrency(emails, MINT_CONCURRENCY, async (email, i) => {
    minted[i] = await mintTeamInvite(email)
    onMinted(minted[i])
  })
  return minted
}

/** Insert the pending team invites on the caller's (seat-locked) transaction, in one statement. */
export async function insertTeamInvites(
  tx: Transaction,
  invites: readonly MintedTeamInvite[],
  details: { role: 'admin' | 'member'; roleId?: RoleId; inviterId: UserId }
): Promise<void> {
  if (invites.length === 0) return
  const now = new Date()
  await tx.insert(invitation).values(
    invites.map((invite) => ({
      id: invite.invitationId,
      email: invite.email,
      name: null,
      role: details.role,
      roleId: details.roleId ?? null,
      status: 'pending',
      expiresAt: new Date(now.getTime() + INVITATION_EXPIRY_MS),
      lastSentAt: now,
      inviterId: details.inviterId,
      createdAt: now,
      magicLinkTokens: [invite.magicLinkToken],
    }))
  )
}

/** Send the invitation email. Returns whether it went out. */
export async function deliverTeamInvite(
  invite: MintedTeamInvite,
  opts: { inviterName: string; inviteeName?: string | null; workspace: InviteWorkspace }
): Promise<{ sent: boolean }> {
  const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
  const logoUrl = getEmailSafeUrl(opts.workspace.logoKey) ?? undefined
  // Sealed class: the invitee has no account yet, so the address the token
  // was minted for is the only correct recipient.
  const { sealedRecipient } = await import('@/lib/server/email/recipient')
  const result = await sendInvitationEmail({
    to: sealedRecipient(invite.minted),
    invitedByName: opts.inviterName,
    inviteeName: opts.inviteeName || undefined,
    workspaceName: opts.workspace.name,
    inviteLink: invite.inviteLink,
    logoUrl,
  })
  return { sent: result.sent }
}
