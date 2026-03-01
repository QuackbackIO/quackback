/**
 * Author resolution for feedback ingestion.
 *
 * Resolves external authors to real user+principal records,
 * following the ImportUserResolver pattern.
 */

import { db, eq, user, principal, externalUserMappings } from '@/lib/server/db'
import { createId, type PrincipalId } from '@quackback/ids'
import type { FeedbackSourceType } from '@/lib/server/integrations/feedback-source-types'

/**
 * Resolve a feedback author to a principalId.
 *
 * Resolution order:
 * 1. If principalId already set (quackback sources), use directly.
 * 2. If email present, look up existing user or create new one.
 * 3. If only externalUserId, resolve via external_user_mappings table.
 * 4. Returns null if no resolution is possible.
 */
export async function resolveAuthorPrincipal(
  author: {
    email?: string
    externalUserId?: string
    principalId?: string
    name?: string
  },
  sourceType: FeedbackSourceType
): Promise<PrincipalId | null> {
  // 1. Already resolved (quackback/API sources pass principalId directly)
  if (author.principalId) {
    return author.principalId as PrincipalId
  }

  // 2. Email-based resolution
  if (author.email) {
    const normalizedEmail = author.email.toLowerCase().trim()
    if (normalizedEmail) {
      return resolveByEmail(normalizedEmail, author.name)
    }
  }

  // 3. External ID-based resolution (Slack users without email)
  if (author.externalUserId) {
    return resolveByExternalId(sourceType, author.externalUserId, author.name, author.email)
  }

  return null
}

async function resolveByEmail(email: string, name?: string): Promise<PrincipalId> {
  // Look up existing principal by email
  const existing = await db
    .select({ principalId: principal.id })
    .from(user)
    .innerJoin(principal, eq(principal.userId, user.id))
    .where(eq(user.email, email))
    .limit(1)

  if (existing.length > 0) {
    return existing[0].principalId as PrincipalId
  }

  // Create new user + principal
  const userId = createId('user')
  const principalId = createId('principal')
  const displayName = name?.trim() || email.split('@')[0]

  await db.insert(user).values({
    id: userId,
    email,
    name: displayName,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await db.insert(principal).values({
    id: principalId,
    userId,
    role: 'user' as const,
    createdAt: new Date(),
  })

  return principalId
}

async function resolveByExternalId(
  sourceType: FeedbackSourceType,
  externalUserId: string,
  name?: string,
  email?: string
): Promise<PrincipalId> {
  // Check existing mapping
  const existing = await db.query.externalUserMappings.findFirst({
    where: (t, { and, eq }) =>
      and(eq(t.sourceType, sourceType), eq(t.externalUserId, externalUserId)),
    columns: { principalId: true },
  })

  if (existing) {
    return existing.principalId as PrincipalId
  }

  // If we also have an email, resolve by email first
  if (email) {
    const principalId = await resolveByEmail(email.toLowerCase().trim(), name)

    // Create the external mapping for future lookups
    await db
      .insert(externalUserMappings)
      .values({
        sourceType,
        externalUserId,
        principalId,
        externalName: name,
        externalEmail: email,
      })
      .onConflictDoNothing()

    return principalId
  }

  // Create a new user from external ID only (no email)
  const userId = createId('user')
  const principalId = createId('principal')
  const displayName = name?.trim() || `${sourceType}:${externalUserId}`

  await db.insert(user).values({
    id: userId,
    email: `${sourceType}+${externalUserId}@external.quackback.io`,
    name: displayName,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await db.insert(principal).values({
    id: principalId,
    userId,
    role: 'user' as const,
    createdAt: new Date(),
  })

  // Create mapping
  await db
    .insert(externalUserMappings)
    .values({
      sourceType,
      externalUserId,
      principalId,
      externalName: name,
      externalEmail: email,
    })
    .onConflictDoNothing()

  return principalId
}
