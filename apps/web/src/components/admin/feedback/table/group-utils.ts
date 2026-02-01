import type { PostListItem, PostStatusEntity } from '@/lib/shared/db-types'
import type { StatusId } from '@quackback/ids'

export interface StatusGroup {
  status: PostStatusEntity
  posts: PostListItem[]
}

/**
 * Groups posts by their status, maintaining the status order from the statuses array.
 * Posts without a matching status are grouped under a virtual "No Status" group.
 */
export function groupPostsByStatus(
  posts: PostListItem[],
  statuses: PostStatusEntity[]
): Map<StatusId | 'none', StatusGroup> {
  const groups = new Map<StatusId | 'none', StatusGroup>()

  // Initialize status groups in order
  for (const status of statuses) {
    groups.set(status.id, { status, posts: [] })
  }

  // Group posts by status
  for (const post of posts) {
    const statusId = post.statusId as StatusId | null
    if (statusId && groups.has(statusId)) {
      groups.get(statusId)!.posts.push(post)
    } else {
      // Handle posts with no status or unknown status
      if (!groups.has('none')) {
        groups.set('none', {
          status: {
            id: 'none' as StatusId,
            name: 'No Status',
            slug: 'no-status',
            color: '#94a3b8',
            category: 'active',
            position: 999,
            showOnRoadmap: false,
            isDefault: false,
            createdAt: new Date(),
          },
          posts: [],
        })
      }
      groups.get('none')!.posts.push(post)
    }
  }

  // Remove empty groups
  for (const [key, group] of groups) {
    if (group.posts.length === 0) {
      groups.delete(key)
    }
  }

  return groups
}
