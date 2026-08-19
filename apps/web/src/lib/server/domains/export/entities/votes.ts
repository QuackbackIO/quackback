/**
 * Post votes exporter — one row per vote with the voter's resolved email
 * (anonymous/placeholder addresses pass through realEmail like the other
 * exports).
 */
import { db, postVotes, principal, user, asc, eq, inArray } from '@/lib/server/db'
import { escapeCSV } from '@/lib/server/utils/csv'
import { realEmail } from '@/lib/shared/anonymous-email'
import type { EntityExporter } from '../types'

async function fetchVotes(offset: number, limit: number) {
  const page = await db.query.postVotes.findMany({
    orderBy: asc(postVotes.createdAt),
    offset,
    limit,
    columns: { id: true, postId: true, principalId: true, sourceType: true, createdAt: true },
  })
  if (page.length === 0) return []

  const emails = await db
    .select({ principalId: principal.id, email: user.email })
    .from(principal)
    .innerJoin(user, eq(principal.userId, user.id))
    .where(inArray(principal.id, [...new Set(page.map((v) => v.principalId))]))
  const emailByPrincipal = new Map(emails.map((e) => [e.principalId, e.email]))

  return page.map((v) => ({ ...v, voterEmail: emailByPrincipal.get(v.principalId) ?? null }))
}
type VoteRow = Awaited<ReturnType<typeof fetchVotes>>[number]

export const votesExporter: EntityExporter<VoteRow> = {
  key: 'post_votes',
  fileName: 'post_votes.csv',
  pageSize: 10000,
  header: 'id,post_id,voter_email,source_type,created_at',
  fetchPage: fetchVotes,
  serialize: (v) =>
    [
      v.id,
      v.postId,
      escapeCSV(realEmail(v.voterEmail) ?? ''),
      escapeCSV(v.sourceType ?? ''),
      v.createdAt.toISOString(),
    ].join(','),
}
