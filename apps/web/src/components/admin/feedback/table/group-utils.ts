import type { PostListItem, PostStatusEntity } from '@/lib/db-types'
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
  // Create a map for quick status lookup
  const statusMap = new Map<StatusId, PostStatusEntity>()
  for (const status of statuses) {
    statusMap.set(status.id, status)
  }

  // Initialize groups in status order (maintains visual order)
  const groups = new Map<StatusId | 'none', StatusGroup>()

  // Add status groups in order (only those with posts will remain visible)
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
            color: '#94a3b8', // slate-400
            description: null,
            category: 'active',
            order: 999,
            isDefault: false,
            tenantId: '' as any,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          posts: [],
        })
      }
      groups.get('none')!.posts.push(post)
    }
  }

  // Remove empty groups (status groups with no posts)
  for (const [key, group] of groups) {
    if (group.posts.length === 0) {
      groups.delete(key)
    }
  }

  return groups
}

/**
 * Flattens grouped posts back into a single array, maintaining group order.
 * Useful for keyboard navigation and index calculations.
 */
export function flattenGroups(groups: Map<StatusId | 'none', StatusGroup>): PostListItem[] {
  const result: PostListItem[] = []
  for (const group of groups.values()) {
    result.push(...group.posts)
  }
  return result
}

/**
 * Storage key for collapsed state persistence
 */
const COLLAPSED_GROUPS_KEY = 'feedback-collapsed-groups'

/**
 * Get collapsed groups from localStorage
 */
export function getCollapsedGroups(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const stored = localStorage.getItem(COLLAPSED_GROUPS_KEY)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

/**
 * Save collapsed groups to localStorage
 */
export function saveCollapsedGroups(collapsed: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsed]))
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Toggle a group's collapsed state
 */
export function toggleCollapsedGroup(collapsed: Set<string>, groupId: string): Set<string> {
  const next = new Set(collapsed)
  if (next.has(groupId)) {
    next.delete(groupId)
  } else {
    next.add(groupId)
  }
  saveCollapsedGroups(next)
  return next
}
