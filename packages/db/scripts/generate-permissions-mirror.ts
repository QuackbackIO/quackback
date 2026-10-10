/**
 * Regenerate the client-safe permissions mirror from the RBAC catalogue:
 * `bun run db:permissions` from the repo root (or `bun scripts/...` here).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderPermissionsMirror } from '../src/permissions-mirror'

const out = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'apps',
  'web',
  'src',
  'lib',
  'shared',
  'permissions.ts'
)
writeFileSync(out, renderPermissionsMirror())
console.log(`wrote ${out}`)
