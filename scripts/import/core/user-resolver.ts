/**
 * User resolution utilities
 *
 * Resolves email addresses to existing member IDs,
 * with optional creation of new user+member records.
 */

import type { MemberId, UserId } from '@quackback/ids'
import { createId } from '@quackback/ids'
import type { Database } from '@quackback/db'
import { user, member, eq } from '@quackback/db'

export interface UserResolverOptions {
  /** Create new users for unknown emails */
  createUsers: boolean
}

interface PendingUser {
  memberId: MemberId
  userId: UserId
  email: string
  name?: string
}

/**
 * User resolver with caching
 *
 * Looks up users by email and returns their member ID.
 * The member table links to user via userId, so we need to:
 * 1. Find the user by email
 * 2. Find the member by userId
 */
export class UserResolver {
  private cache = new Map<string, MemberId | null>()
  private pendingCreates: PendingUser[] = []

  constructor(
    private db: Database,
    private options: UserResolverOptions
  ) {}

  /**
   * Resolve an email to a member ID.
   * Returns null if user doesn't exist and createUsers is false.
   */
  async resolve(email: string, name?: string): Promise<MemberId | null> {
    if (!email) return null

    const normalizedEmail = email.toLowerCase().trim()

    if (this.cache.has(normalizedEmail)) {
      return this.cache.get(normalizedEmail) ?? null
    }

    // Look up user by email, then get their member record
    const existing = await this.db
      .select({ memberId: member.id })
      .from(user)
      .innerJoin(member, eq(member.userId, user.id))
      .where(eq(user.email, normalizedEmail))
      .limit(1)

    if (existing.length > 0) {
      const memberId = existing[0].memberId as MemberId
      this.cache.set(normalizedEmail, memberId)
      return memberId
    }

    if (!this.options.createUsers) {
      this.cache.set(normalizedEmail, null)
      return null
    }

    // Queue for creation - need both user and member
    const userId = createId('user')
    const memberId = createId('member')
    this.pendingCreates.push({ memberId: memberId, userId, email: normalizedEmail, name })
    this.cache.set(normalizedEmail, memberId)
    return memberId
  }

  /**
   * Flush pending user creations to database.
   * Creates both user and member records.
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

      // Then create member records linking to users
      await this.db.insert(member).values(
        chunk.map((u) => ({
          id: u.memberId,
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
