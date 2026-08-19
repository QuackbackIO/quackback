/**
 * SSO recovery codes — break-glass sign-in when SSO is broken.
 *
 * One row per active code, hashed with argon2id. Codes are issued to
 * admins ahead of time; on consumption we mark `used_at` so the code
 * can't be replayed. Regenerating a batch invalidates the prior batch
 * by deleting their rows (a clean reset rather than soft-invalidating
 * them) — see `generateRecoveryCodesFn`.
 *
 * The unique partial index on (user_id, code_hash) WHERE used_at IS
 * NULL prevents two active codes from sharing the same hash (a tiny
 * but real birthday risk with 60-bit codes).
 */
import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { user } from './auth'

export const ssoRecoveryCode = pgTable(
  'sso_recovery_code',
  {
    id: typeIdWithDefault('rcode')('id').primaryKey(),
    userId: typeIdColumn('user')('user_id').notNull(),
    /** argon2id digest of the user-facing code. Never stored plaintext. */
    codeHash: text('code_hash').notNull(),
    /** Set when the code is consumed. Null = active. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Named to match the constraint the SQL migration created.
    foreignKey({
      name: 'sso_recovery_code_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [user.id],
    }).onDelete('cascade'),
    index('sso_recovery_code_user_id_idx').on(table.userId),
    uniqueIndex('sso_recovery_code_active_hash_unique')
      .on(table.userId, table.codeHash)
      .where(sql`used_at IS NULL`),
  ]
)
