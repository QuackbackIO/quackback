/**
 * Read-side server functions backing the post owner (assignee) control.
 *
 * The picker and the current-owner chip need the team roster and the post's
 * current owner, but neither surface can lean on the member.view-gated admin
 * roster fn: a narrowly-scoped role can hold post.set_owner without holding
 * member.view. Both fns therefore gate on the exact capability the control
 * needs — post.set_owner — so query enablement lines up 1:1 with the editor's
 * render gate, and the public portal post payload never has to grow an owner
 * field (the owner is fetched here, permission-gated, only when a team member
 * loads the page).
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type PostId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'
import { db, eq, posts } from '@/lib/server/db'
import { listTeamMembers } from '@/lib/server/domains/principals/principal.service'
import type { TeamMember } from '@/lib/server/domains/principals/principal.types'
import { setLogContext } from '@/lib/server/log-context'

/**
 * A team member as an assignable post owner — identity plus the display bits
 * the picker and owner chip render. Shared by the portal and admin surfaces.
 */
export interface OwnerRef {
  principalId: string
  name: string
  avatarUrl: string | null
}

const postIdSchema = z.object({ postId: z.string() })

function toOwnerRef(m: TeamMember): OwnerRef {
  return { principalId: m.id, name: m.name ?? m.email ?? '', avatarUrl: m.image ?? null }
}

/**
 * The workspace roster as assignable owners. Gated on post.set_owner so a
 * contributor who can assign owners can populate the picker without holding
 * the broader member.view.
 */
export const listOwnerCandidatesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.POST_SET_OWNER })
  const members = await listTeamMembers()
  return members.map(toOwnerRef)
})

/**
 * The post's current owner (or null), resolved to display bits. Lets the portal
 * render the owner chip without leaking an owner field into the public post
 * payload. A former team member no longer on the roster resolves to null,
 * matching how the admin owner filter only lists current members.
 */
export const getPostOwnerFn = createServerFn({ method: 'GET' })
  .validator(postIdSchema)
  .handler(async ({ data }): Promise<OwnerRef | null> => {
    await requireAuth({ permission: PERMISSIONS.POST_SET_OWNER })
    // Ambient context, so the failure line the server-fn middleware emits
    // carries post_id without this handler logging its own.
    setLogContext({ post_id: data.postId })
    const [row] = await db
      .select({ ownerPrincipalId: posts.ownerPrincipalId })
      .from(posts)
      .where(eq(posts.id, data.postId as PostId))
      .limit(1)
    const ownerId = row?.ownerPrincipalId ?? null
    if (!ownerId) return null
    const members = await listTeamMembers()
    const owner = members.find((m) => m.id === ownerId)
    return owner ? toOwnerRef(owner) : null
  })
