/** Changelog-family event declarations (WO-2). */
import { decl } from './helpers'

export const changelogPublished = decl(
  'changelog.published',
  'changelog',
  { webhook: true, notification: 'status_change' },
  'changelog:read'
)
