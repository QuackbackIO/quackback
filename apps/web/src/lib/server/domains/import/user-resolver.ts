/**
 * User resolution for CSV import.
 *
 * Resolves email addresses to existing member IDs,
 * creating new user+member records when needed.
 *
 * Adapted from scripts/import/core/user-resolver.ts for
 * use within the in-app CSV import flow.
 */

import { db, eq } from '@/lib/server/db'
import { user, principal } from '@quackback/db'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'

interface PendingUser {
  principalId: PrincipalId
  userId: UserId
  email: string
  name: string
}

/**
 * Resolves CSV author emails to member IDs.
 *
 * - Caches lookups per instance (create once per import job)
 * - Batches user+member creation via flushPendingCreates()
 * - Case-insensitive email matching
 */
export class ImportUserResolver {
  private cache = new Map<string, PrincipalId>()
  private pendingCreates: PendingUser[] = []

  /**
   * Resolve an email to a member ID.
   *
   * If the email has an existing user+member, returns the principalId.
   * If not, queues a new user+member for creation and returns a pre-generated principalId.
   * If email is null/empty, returns the fallbackPrincipalId.
   */
  async resolve(
    email: string | null | undefined,
    name: string | null | undefined,
    fallbackPrincipalId: PrincipalId
  ): Promise<PrincipalId> {
    if (!email) return fallbackPrincipalId

    const normalizedEmail = email.toLowerCase().trim()
    if (!normalizedEmail) return fallbackPrincipalId

    if (this.cache.has(normalizedEmail)) {
      return this.cache.get(normalizedEmail)!
    }

    // Look up existing principal by email
    const existing = await db
      .select({ principalId: principal.id })
      .from(user)
      .innerJoin(principal, eq(principal.userId, user.id))
      .where(eq(user.email, normalizedEmail))
      .limit(1)

    if (existing.length > 0) {
      const principalId = existing[0].principalId as PrincipalId
      this.cache.set(normalizedEmail, principalId)
      return principalId
    }

    // Queue for creation
    const userId = createId('user')
    const principalId = createId('principal')
    const displayName = name?.trim() || normalizedEmail.split('@')[0]

    this.pendingCreates.push({ principalId, userId, email: normalizedEmail, name: displayName })
    this.cache.set(normalizedEmail, principalId)
    return principalId
  }

  /**
   * Flush all pending user+member creations to the database.
   * Call this once per batch after all resolves are done.
   */
  async flushPendingCreates(): Promise<number> {
    if (this.pendingCreates.length === 0) return 0

    const toCreate = [...this.pendingCreates]
    this.pendingCreates = []

    const chunkSize = 100
    for (let i = 0; i < toCreate.length; i += chunkSize) {
      const chunk = toCreate.slice(i, i + chunkSize)

      // Create user records
      await db.insert(user).values(
        chunk.map((u) => ({
          id: u.userId,
          email: u.email,
          name: u.name,
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      )

      // Create principal records
      await db.insert(principal).values(
        chunk.map((u) => ({
          id: u.principalId,
          userId: u.userId,
          role: 'user' as const,
          createdAt: new Date(),
        }))
      )
    }

    return toCreate.length
  }

  get pendingCount(): number {
    return this.pendingCreates.length
  }
}
