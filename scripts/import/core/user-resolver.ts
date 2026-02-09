/**
 * User resolution utilities
 *
 * Resolves email addresses to existing principal IDs,
 * with optional creation of new user+principal records.
 */

import type { PrincipalId, UserId } from '@quackback/ids'
import { createId } from '@quackback/ids'
import type { Database } from '@quackback/db'
import { user, principal, eq } from '@quackback/db'

export interface UserResolverOptions {
  /** Create new users for unknown emails */
  createUsers: boolean
}

interface PendingUser {
  principalId: PrincipalId
  userId: UserId
  email: string
  name?: string
}

/**
 * User resolver with caching
 *
 * Looks up users by email and returns their principal ID.
 * The principal table links to user via userId, so we need to:
 * 1. Find the user by email
 * 2. Find the principal by userId
 */
export class UserResolver {
  private cache = new Map<string, PrincipalId | null>()
  private pendingCreates: PendingUser[] = []

  constructor(
    private db: Database,
    private options: UserResolverOptions
  ) {}

  /**
   * Resolve an email to a principal ID.
   * Returns null if user doesn't exist and createUsers is false.
   */
  async resolve(email: string, name?: string): Promise<PrincipalId | null> {
    if (!email) return null

    const normalizedEmail = email.toLowerCase().trim()

    if (this.cache.has(normalizedEmail)) {
      return this.cache.get(normalizedEmail) ?? null
    }

    // Look up user by email, then get their principal record
    const existing = await this.db
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

    if (!this.options.createUsers) {
      this.cache.set(normalizedEmail, null)
      return null
    }

    // Queue for creation - need both user and principal
    const userId = createId('user')
    const principalId = createId('principal')
    this.pendingCreates.push({ principalId: principalId, userId, email: normalizedEmail, name })
    this.cache.set(normalizedEmail, principalId)
    return principalId
  }

  /**
   * Flush pending user creations to database.
   * Creates both user and principal records.
   */
  async flushPendingCreates(): Promise<number> {
    if (this.pendingCreates.length === 0) return 0

    const toCreate = [...this.pendingCreates]
    this.pendingCreates = []

    const chunkSize = 100
    for (let i = 0; i < toCreate.length; i += chunkSize) {
      const chunk = toCreate.slice(i, i + chunkSize)

      // First create user records
      await this.db.insert(user).values(
        chunk.map((u) => ({
          id: u.userId,
          email: u.email,
          name: u.name ?? u.email.split('@')[0],
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      )

      // Then create principal records linking to users
      await this.db.insert(principal).values(
        chunk.map((u) => ({
          id: u.principalId,
          userId: u.userId,
          role: 'user' as const, // Portal users get 'user' role
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
