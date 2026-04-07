/**
 * Portal user identify (upsert) and update operations
 *
 * Provides identifyPortalUser (create-or-update by email) and
 * updatePortalUser (update existing user by principal ID).
 */

import { db, eq, and, principal, user } from '@/lib/server/db'
import type { PrincipalId, UserId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import type {
  IdentifyPortalUserInput,
  IdentifyPortalUserResult,
  UpdatePortalUserInput,
  UpdatePortalUserResult,
} from './user.types'
import {
  USER_COLUMNS,
  EXTERNAL_ID_KEY,
  parseUserAttributes,
  extractExternalId,
  mergeMetadata,
  validateInputAttributes,
} from './user.attributes'

/**
 * Identify (create or update) a portal user by email.
 *
 * - If the user exists: update name, image, emailVerified, and merge attributes.
 * - If the user does not exist: create user + principal with role='user'.
 *
 * Attributes must be configured in Settings > User Attributes before they can be set.
 */
export async function identifyPortalUser(
  input: IdentifyPortalUserInput
): Promise<IdentifyPortalUserResult> {
  const normalizedEmail = input.email.trim().toLowerCase()
  const defaultName = input.name || normalizedEmail.split('@')[0]

  const { validAttrs, attrRemovals } = await validateInputAttributes(input.attributes)

  // Apply updates to an existing user record and sync the principal
  async function applyUpdates(record: {
    id: UserId
    name: string
    email: string | null
    image: string | null
    emailVerified: boolean
    metadata: string | null
    createdAt: Date
  }) {
    const userUpdates: Record<string, unknown> = {}
    if (input.name !== undefined && input.name !== record.name) userUpdates.name = input.name
    if (input.image !== undefined && input.image !== record.image) userUpdates.image = input.image
    if (input.emailVerified !== undefined && input.emailVerified !== record.emailVerified) {
      userUpdates.emailVerified = input.emailVerified
    }
    // Merge attributes and externalId into metadata
    const metadataUpdates = { ...validAttrs }
    const metadataRemovals = [...attrRemovals]
    if (input.externalId !== undefined) {
      if (input.externalId === null) {
        metadataRemovals.push(EXTERNAL_ID_KEY)
      } else {
        metadataUpdates[EXTERNAL_ID_KEY] = input.externalId
      }
    }
    if (Object.keys(metadataUpdates).length > 0 || metadataRemovals.length > 0) {
      userUpdates.metadata = mergeMetadata(record.metadata, metadataUpdates, metadataRemovals)
    }

    if (Object.keys(userUpdates).length > 0) {
      userUpdates.updatedAt = new Date()
      await db.update(user).set(userUpdates).where(eq(user.id, record.id))
    }

    // Sync principal displayName and avatarUrl if changed
    const principalUpdates: Record<string, unknown> = {}
    if (input.name !== undefined) principalUpdates.displayName = input.name
    if (input.image !== undefined) principalUpdates.avatarUrl = input.image
    if (Object.keys(principalUpdates).length > 0) {
      await db.update(principal).set(principalUpdates).where(eq(principal.userId, record.id))
    }

    // Re-read to get updated values — record must exist since we just updated it
    const updated = await db.query.user.findFirst({
      where: eq(user.id, record.id),
      columns: USER_COLUMNS,
    })
    if (!updated) {
      throw new Error(`Failed to re-read user ${record.id} after update`)
    }
    return updated
  }

  // Try to find existing user
  let userRecord = await db.query.user.findFirst({
    where: eq(user.email, normalizedEmail),
    columns: USER_COLUMNS,
  })

  let created = false

  if (userRecord) {
    userRecord = await applyUpdates(userRecord)
  } else {
    const initialMeta: Record<string, unknown> = { ...validAttrs }
    if (input.externalId) initialMeta[EXTERNAL_ID_KEY] = input.externalId
    const metadata = Object.keys(initialMeta).length > 0 ? JSON.stringify(initialMeta) : null

    try {
      const [newUser] = await db
        .insert(user)
        .values({
          id: generateId('user'),
          name: defaultName,
          email: normalizedEmail,
          emailVerified: input.emailVerified ?? false,
          image: input.image ?? null,
          metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()
      userRecord = newUser

      await db.insert(principal).values({
        id: generateId('principal'),
        userId: newUser.id,
        role: 'user',
        displayName: defaultName,
        avatarUrl: input.image ?? null,
        createdAt: new Date(),
      })

      created = true
    } catch (err) {
      // Handle concurrent insert race condition (unique constraint on email)
      if ((err as { code?: string }).code === '23505') {
        userRecord = (await db.query.user.findFirst({
          where: eq(user.email, normalizedEmail),
          columns: USER_COLUMNS,
        }))!
        userRecord = await applyUpdates(userRecord)
      } else {
        throw err
      }
    }
  }

  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.userId, userRecord.id),
    columns: { id: true },
  })
  if (!principalRecord) {
    throw new NotFoundError('PRINCIPAL_NOT_FOUND', `No principal found for user ${userRecord.id}`)
  }

  return {
    principalId: principalRecord.id as PrincipalId,
    userId: userRecord.id,
    name: userRecord.name ?? defaultName,
    email: userRecord.email ?? normalizedEmail, // identify always provides email
    image: userRecord.image ?? null,
    emailVerified: userRecord.emailVerified,
    externalId: extractExternalId(userRecord.metadata ?? null),
    attributes: parseUserAttributes(userRecord.metadata ?? null),
    createdAt: userRecord.createdAt,
    created,
  }
}

/**
 * Update an existing portal user's profile and attributes.
 *
 * Only updates fields that are provided in the input.
 * Attributes must be configured in Settings > User Attributes before they can be set.
 */
export async function updatePortalUser(
  principalId: PrincipalId,
  input: UpdatePortalUserInput
): Promise<UpdatePortalUserResult> {
  const principalRecord = await db
    .select({
      principalId: principal.id,
      userId: principal.userId,
    })
    .from(principal)
    .where(and(eq(principal.id, principalId), eq(principal.role, 'user')))
    .limit(1)

  if (principalRecord.length === 0 || !principalRecord[0].userId) {
    throw new NotFoundError(
      'MEMBER_NOT_FOUND',
      `Portal user with principal ID ${principalId} not found`
    )
  }

  const userId = principalRecord[0].userId

  const { validAttrs, attrRemovals } = await validateInputAttributes(input.attributes)

  const userRecord = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: USER_COLUMNS,
  })
  if (!userRecord) {
    throw new NotFoundError('MEMBER_NOT_FOUND', 'User record not found')
  }

  const userUpdates: Record<string, unknown> = {}
  if (input.name !== undefined && input.name !== userRecord.name) userUpdates.name = input.name
  if (input.image !== undefined && input.image !== userRecord.image) userUpdates.image = input.image
  if (input.emailVerified !== undefined && input.emailVerified !== userRecord.emailVerified) {
    userUpdates.emailVerified = input.emailVerified
  }
  // Merge attributes and externalId into metadata
  const metadataUpdates = { ...validAttrs }
  const metadataRemovals = [...attrRemovals]
  if (input.externalId !== undefined) {
    if (input.externalId === null) {
      metadataRemovals.push(EXTERNAL_ID_KEY)
    } else {
      metadataUpdates[EXTERNAL_ID_KEY] = input.externalId
    }
  }
  if (Object.keys(metadataUpdates).length > 0 || metadataRemovals.length > 0) {
    userUpdates.metadata = mergeMetadata(
      userRecord.metadata ?? null,
      metadataUpdates,
      metadataRemovals
    )
  }

  if (Object.keys(userUpdates).length > 0) {
    userUpdates.updatedAt = new Date()
    await db.update(user).set(userUpdates).where(eq(user.id, userId))
  }

  const principalUpdates: Record<string, unknown> = {}
  if (input.name !== undefined) principalUpdates.displayName = input.name
  if (input.image !== undefined) principalUpdates.avatarUrl = input.image
  if (Object.keys(principalUpdates).length > 0) {
    await db.update(principal).set(principalUpdates).where(eq(principal.id, principalId))
  }

  const updated = (await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: USER_COLUMNS,
  }))!

  return {
    principalId,
    userId: updated.id,
    name: updated.name ?? updated.email?.split('@')[0] ?? 'User',
    email: updated.email,
    image: updated.image ?? null,
    emailVerified: updated.emailVerified,
    externalId: extractExternalId(updated.metadata ?? null),
    attributes: parseUserAttributes(updated.metadata ?? null),
    createdAt: updated.createdAt,
  }
}
