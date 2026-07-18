/**
 * Display labels for the 15 permission-catalogue categories. Pinned complete
 * against PERMISSION_CATEGORIES by permission-labels.test.ts, so a new
 * category can't silently render as its raw snake_case key.
 */
import type { PermissionCategory } from '@/lib/shared/permissions'

export const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  workspace: 'Workspace',
  members: 'Members',
  people: 'People',
  company: 'Companies',
  audience: 'Audience',
  feedback: 'Feedback',
  changelog: 'Changelog',
  help_center: 'Help center',
  survey: 'Surveys',
  conversation: 'Inbox',
  analytics: 'Analytics',
  integration: 'Integrations',
  support: 'Support',
  ai: 'AI',
  status_page: 'Status page',
}
