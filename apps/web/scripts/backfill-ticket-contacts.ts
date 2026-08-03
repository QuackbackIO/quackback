#!/usr/bin/env bun
/**
 * Backfill historical data for the portal-tickets identity model.
 *
 * Closes the gap left by Phases A + B for rows that already existed before
 * those landed:
 *
 *   Phase 1 — link existing portal users to CRM contacts via
 *             `contact_user_links`. Mirrors the better-auth
 *             `databaseHooks.user.create.after` behavior, applied
 *             retroactively. Gated on `emailVerified = true` so we only
 *             link identities the user has demonstrably proven they own.
 *
 *   Phase 2 — populate `tickets.requesterContactId` for tickets that were
 *             filed with a `requesterPrincipalId` but no contact (the
 *             pre-Phase-B portal-creation path). Resolves principal → user
 *             → email → contact and writes the contact id back.
 *
 * Both phases are idempotent — re-running is a no-op for rows already in
 * the desired state. Use `--dry-run` for a preview that reports candidate
 * counts without writing.
 *
 * Usage:
 *   bun apps/web/scripts/backfill-ticket-contacts.ts             # Run both phases
 *   bun apps/web/scripts/backfill-ticket-contacts.ts --dry-run   # Preview
 *   bun apps/web/scripts/backfill-ticket-contacts.ts --users-only
 *   bun apps/web/scripts/backfill-ticket-contacts.ts --tickets-only
 *   bun apps/web/scripts/backfill-ticket-contacts.ts --batch-size=200
 *   bun apps/web/scripts/backfill-ticket-contacts.ts --limit=1000
 *   bun apps/web/scripts/backfill-ticket-contacts.ts --help
 *
 * Environment:
 *   DATABASE_URL — Required. PostgreSQL connection string.
 */

// Load .env if available — same pattern as sibling backfill scripts.
try {
  const { config } = await import('dotenv')
  config({ path: '.env', quiet: true })
} catch {
  // dotenv not available, rely on environment variables
}

import { db, eq, and, isNull, isNotNull, gt, asc, tickets, principal, user } from '@/lib/server/db'
import type { ContactId, PrincipalId, TicketId, UserId } from '@quackback/ids'
import { linkContactForUser } from '@/lib/server/auth/link-contact'
import {
  findOrCreateByEmail,
  linkContactToUser,
} from '@/lib/server/domains/organizations/contact.service'

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface Flags {
  dryRun: boolean
  usersOnly: boolean
  ticketsOnly: boolean
  batchSize: number
  limit: number | null
}

function printUsage(): void {
  console.log(`Backfill ticket-contact identity links.

Usage:
  bun apps/web/scripts/backfill-ticket-contacts.ts [flags]

Flags:
  --dry-run          Preview without writing.
  --users-only       Skip the ticket backfill phase.
  --tickets-only     Skip the user-link phase.
  --batch-size=N     Rows per batch (default 100, max 500).
  --limit=N          Cap total processed rows per phase.
  --help             Show this message.

Environment:
  DATABASE_URL       Required. PostgreSQL connection string.
`)
}

function parseFlags(argv: string[]): Flags {
  const dryRun = argv.includes('--dry-run')
  const usersOnly = argv.includes('--users-only')
  const ticketsOnly = argv.includes('--tickets-only')
  if (usersOnly && ticketsOnly) {
    console.error(
      '[backfill-ticket-contacts] --users-only and --tickets-only are mutually exclusive'
    )
    process.exit(2)
  }
  const batchSizeArg = argv.find((a) => a.startsWith('--batch-size='))
  let batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1] ?? '', 10) : 100
  if (!Number.isFinite(batchSize) || batchSize <= 0) batchSize = 100
  if (batchSize > 500) batchSize = 500
  const limitArg = argv.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '', 10) : NaN
  return {
    dryRun,
    usersOnly,
    ticketsOnly,
    batchSize,
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — link existing verified users to contacts
// ---------------------------------------------------------------------------

interface UserPhaseStats {
  candidates: number
  processed: number
  errors: number
}

async function phase1LinkUsers(flags: Flags): Promise<UserPhaseStats> {
  const stats: UserPhaseStats = { candidates: 0, processed: 0, errors: 0 }

  let cursor: string | null = null
  while (true) {
    if (flags.limit != null && stats.candidates >= flags.limit) break
    const remaining = flags.limit != null ? flags.limit - stats.candidates : flags.batchSize
    const take = Math.min(flags.batchSize, remaining)

    const rows = await db
      .select({ id: user.id, email: user.email, isAnonymous: user.isAnonymous })
      .from(user)
      .where(
        and(
          isNotNull(user.email),
          eq(user.emailVerified, true),
          eq(user.isAnonymous, false),
          cursor ? gt(user.id, cursor) : undefined
        )
      )
      .orderBy(asc(user.id))
      .limit(take)
    if (rows.length === 0) break

    for (const row of rows) {
      stats.candidates += 1
      cursor = row.id
      if (!row.email) continue // belt-and-suspenders; filtered above
      if (flags.dryRun) continue
      try {
        await linkContactForUser({
          userId: row.id as UserId,
          email: row.email,
          emailVerified: true,
          anonymous: row.isAnonymous,
        })
        stats.processed += 1
      } catch (err) {
        stats.errors += 1
        console.error('[backfill-ticket-contacts] phase1 user error', {
          userId: row.id,
          error: err instanceof Error ? err.message : err,
        })
      }
    }

    if (rows.length < take) break
  }

  return stats
}

// ---------------------------------------------------------------------------
// Phase 2 — backfill tickets.requesterContactId
// ---------------------------------------------------------------------------

interface TicketPhaseStats {
  candidates: number
  processed: number
  missingEmail: number
  errors: number
}

async function phase2BackfillTickets(flags: Flags): Promise<TicketPhaseStats> {
  const stats: TicketPhaseStats = { candidates: 0, processed: 0, missingEmail: 0, errors: 0 }

  let cursor: string | null = null
  while (true) {
    if (flags.limit != null && stats.candidates >= flags.limit) break
    const remaining = flags.limit != null ? flags.limit - stats.candidates : flags.batchSize
    const take = Math.min(flags.batchSize, remaining)

    const rows = await db
      .select({
        id: tickets.id,
        requesterPrincipalId: tickets.requesterPrincipalId,
      })
      .from(tickets)
      .where(
        and(
          isNotNull(tickets.requesterPrincipalId),
          isNull(tickets.requesterContactId),
          isNull(tickets.deletedAt),
          cursor ? gt(tickets.id, cursor) : undefined
        )
      )
      .orderBy(asc(tickets.id))
      .limit(take)
    if (rows.length === 0) break

    for (const row of rows) {
      stats.candidates += 1
      cursor = row.id
      try {
        const contactId = await resolveContactForTicket(row.requesterPrincipalId as PrincipalId)
        if (!contactId) {
          stats.missingEmail += 1
          continue
        }
        if (flags.dryRun) {
          console.log(
            `[backfill-ticket-contacts] [dry-run] would set ticket ${row.id}.requesterContactId = ${contactId}`
          )
          continue
        }
        await db
          .update(tickets)
          .set({ requesterContactId: contactId })
          .where(eq(tickets.id, row.id as TicketId))
        stats.processed += 1
      } catch (err) {
        stats.errors += 1
        console.error('[backfill-ticket-contacts] phase2 ticket error', {
          ticketId: row.id,
          error: err instanceof Error ? err.message : err,
        })
      }
    }

    if (rows.length < take) break
  }

  return stats
}

/**
 * Resolve the contact id for a ticket's requester principal.
 *
 * Mirrors `resolveRequesterContactId` in `ticket.service.ts` but exposed at
 * script level so we can decide policy (skip vs. error) per row. Returns
 * `null` when the principal isn't a user, has no email, or any link
 * step fails — those rows are reported as `missingEmail` and skipped.
 */
async function resolveContactForTicket(principalId: PrincipalId): Promise<ContactId | null> {
  const principalRow = await db.query.principal.findFirst({
    where: eq(principal.id, principalId),
    columns: { userId: true, type: true },
  })
  if (!principalRow || !principalRow.userId || principalRow.type !== 'user') return null
  const userRow = await db.query.user.findFirst({
    where: eq(user.id, principalRow.userId as UserId),
    columns: { email: true },
  })
  if (!userRow?.email) return null
  const contact = await findOrCreateByEmail({ email: userRow.email })
  // Best-effort link — keeps the user/contact pair joined for future queries.
  await linkContactToUser({
    contactId: contact.id,
    userId: principalRow.userId as UserId,
    linkedByPrincipalId: null,
  })
  return contact.id
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage()
    return
  }
  if (!process.env.DATABASE_URL) {
    console.error('[backfill-ticket-contacts] DATABASE_URL is required')
    process.exit(1)
  }
  const flags = parseFlags(argv)

  console.log('[backfill-ticket-contacts] start', {
    dryRun: flags.dryRun,
    usersOnly: flags.usersOnly,
    ticketsOnly: flags.ticketsOnly,
    batchSize: flags.batchSize,
    limit: flags.limit,
  })

  let userStats: UserPhaseStats | null = null
  let ticketStats: TicketPhaseStats | null = null

  if (!flags.ticketsOnly) {
    console.log('[backfill-ticket-contacts] phase 1 — link users to contacts')
    userStats = await phase1LinkUsers(flags)
    console.log('[backfill-ticket-contacts] phase 1 done', userStats)
  }
  if (!flags.usersOnly) {
    console.log('[backfill-ticket-contacts] phase 2 — backfill ticket.requesterContactId')
    ticketStats = await phase2BackfillTickets(flags)
    console.log('[backfill-ticket-contacts] phase 2 done', ticketStats)
  }

  console.log('[backfill-ticket-contacts] summary', {
    users: userStats,
    tickets: ticketStats,
  })

  const errors = (userStats?.errors ?? 0) + (ticketStats?.errors ?? 0)
  process.exit(errors > 0 ? 1 : 0)
}

await main()
