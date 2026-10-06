/**
 * Team invitations by email: who may be invited, the grant ceiling on the
 * invited role, and the mint / insert / deliver steps. sendTeamInvitation is
 * the single-invite flow behind sendInvitationFn; the batch add-people path
 * composes the same steps so both apply one set of rules.
 */
import {
  generateId,
  type InviteId,
  type PrincipalId,
  type RoleId,
  type UserId,
} from '@quackback/ids'
import { and, db, eq, invitation, principal, sql, user, type Transaction } from '@/lib/server/db'
import { sendInvitationEmail } from '@quackback/email'
import { getBaseUrl } from '@/lib/server/config'
import {
  INVITATION_EXPIRY_MS,
  generateInvitationMagicLink,
} from '@/lib/server/functions/invitation-magic-link'
import { ConflictError, ValidationError } from '@/lib/shared/errors'
import { isSyntheticAnonEmail } from '@/lib/shared/anonymous-email'
import type { PermissionKey } from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'
import { assertCanGrantTeamRole } from '@/lib/server/domains/roles/role.grants'

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
 * Where an email stands for a team invite: a pending team invite, an existing
 * teammate, or invitable ('new', which includes a portal user holding that
 * address: accepting the invite promotes them). `email` must be lowercased.
 */
export async function classifyInviteEmail(email: string): Promise<InviteEmailStatus> {
  const [existingInvitation, existingUser] = await Promise.all([
    db.query.invitation.findFirst({
      where: and(
        eq(invitation.email, email),
        eq(invitation.status, 'pending'),
        eq(invitation.kind, 'team')
      ),
    }),
    db.query.user.findFirst({
      where: sql`lower(${user.email}) = ${email}`,
    }),
  ])

  if (existingInvitation) {
    return {
      status: 'pending_invite',
      invitationId: existingInvitation.id as InviteId,
      invitedAt: existingInvitation.createdAt,
      role: existingInvitation.role ?? 'member',
      roleId: (existingInvitation.roleId as RoleId | null) ?? null,
    }
  }
  if (!existingUser) return { status: 'new' }

  const existingPrincipal = await db.query.principal.findFirst({
    where: eq(principal.userId, existingUser.id),
  })
  if (existingPrincipal && existingPrincipal.role !== 'user') {
    return { status: 'member', principalId: existingPrincipal.id as PrincipalId }
  }
  return {
    status: 'new',
    principalId: (existingPrincipal?.id as PrincipalId | undefined) ?? undefined,
    userId: existingUser.id as UserId,
  }
}

/** Refuse an address that can never receive the invite (a minted placeholder). */
export function assertDeliverableInviteEmail(email: string): void {
  if (isSyntheticAnonEmail(email)) {
    throw new ValidationError('NOT_ELIGIBLE', 'This address cannot receive an invitation')
  }
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
export async function mintTeamInvite(email: string): Promise<MintedTeamInvite> {
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

/** Insert the pending team invite on the caller's (seat-locked) transaction. */
export async function insertTeamInvite(
  tx: Transaction,
  invite: MintedTeamInvite,
  details: { name?: string | null; role: 'admin' | 'member'; roleId?: RoleId; inviterId: UserId }
): Promise<void> {
  const now = new Date()
  await tx.insert(invitation).values({
    id: invite.invitationId,
    email: invite.email,
    name: details.name || null,
    role: details.role,
    roleId: details.roleId ?? null,
    status: 'pending',
    expiresAt: new Date(now.getTime() + INVITATION_EXPIRY_MS),
    lastSentAt: now,
    inviterId: details.inviterId,
    createdAt: now,
    magicLinkTokens: [invite.magicLinkToken],
  })
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

/**
 * Invite one person to the team by email. Refuses an address with a pending
 * team invite or belonging to a teammate; a portal user may be invited (the
 * accept promotes them). The seat count and the insert share one transaction
 * under the seat-ledger lock so two concurrent invites cannot both take the
 * last seat.
 */
export async function sendTeamInvitation(
  input: { email: string; name?: string; role: 'admin' | 'member'; roleId?: RoleId },
  granter: TeamGranter,
  workspace: InviteWorkspace
): Promise<{ invitationId: InviteId; emailSent: boolean; inviteLink?: string }> {
  const email = input.email.toLowerCase()
  assertDeliverableInviteEmail(email)

  const standing = await classifyInviteEmail(email)
  if (standing.status === 'pending_invite') {
    throw new ConflictError('INVITE_PENDING', 'An invitation has already been sent to this email')
  }
  if (standing.status === 'member') {
    throw new ConflictError('ALREADY_MEMBER', 'A team member with this email already exists')
  }

  await assertInviteGrant(input.role, input.roleId, granter)

  const invite = await mintTeamInvite(email)

  await db.transaction(async (tx) => {
    const { enforceSeatLimit } = await import('./seat-limit')
    await enforceSeatLimit({ executor: tx })
    await insertTeamInvite(tx, invite, {
      name: input.name,
      role: input.role,
      roleId: input.roleId,
      inviterId: granter.userId,
    })
  })

  const result = await deliverTeamInvite(invite, {
    inviterName: granter.name,
    inviteeName: input.name,
    workspace,
  })

  return {
    invitationId: invite.invitationId,
    emailSent: result.sent,
    inviteLink: !result.sent ? invite.inviteLink : undefined,
  }
}
