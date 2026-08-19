/**
 * Users exporter — full people directory (users AND leads), same columns as
 * the interactive /api/export/users route.
 *
 * listPortalUsers pages one lifecycle at a time, so this exporter is a
 * stateful factory: it fills each page to the limit, crossing from 'users'
 * into 'leads' mid-page, and only returns a short page when both lifecycles
 * are exhausted (which is what tells the orchestrator to stop).
 */
import { listPortalUsers } from '@/lib/server/domains/users/user.service'
import type { PortalUserListItem } from '@/lib/server/domains/users'
import { escapeCSV } from '@/lib/server/utils/csv'
import { realEmail } from '@/lib/shared/anonymous-email'
import type { EntityExporter } from '../types'

export function createUsersExporter(): EntityExporter<PortalUserListItem> {
  let phase: 'users' | 'leads' | 'done' = 'users'
  let page = 1

  async function fetchPage(_offset: number, limit: number): Promise<PortalUserListItem[]> {
    const out: PortalUserListItem[] = []
    while (out.length < limit && phase !== 'done') {
      const res = await listPortalUsers({ lifecycle: phase, page, limit: limit - out.length })
      out.push(...res.items)
      if (res.hasMore) {
        page++
      } else if (phase === 'users') {
        phase = 'leads'
        page = 1
      } else {
        phase = 'done'
      }
    }
    return out
  }

  return {
    key: 'users',
    fileName: 'users.csv',
    pageSize: 5000,
    header:
      'name,email,verified,lifecycle,segments,joined_at,last_seen_at,post_count,comment_count,vote_count',
    fetchPage,
    serialize: (u) =>
      [
        escapeCSV(u.name ?? ''),
        escapeCSV(realEmail(u.email) ?? realEmail(u.contactEmail) ?? ''),
        String(u.emailVerified),
        u.isLead ? 'lead' : 'user',
        escapeCSV(u.segments.map((s) => s.name).join(',')),
        u.joinedAt.toISOString(),
        u.lastSeenAt ? u.lastSeenAt.toISOString() : '',
        String(u.postCount),
        String(u.commentCount),
        String(u.voteCount),
      ].join(','),
  }
}
