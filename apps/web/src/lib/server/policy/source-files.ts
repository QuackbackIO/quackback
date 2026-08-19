import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Recursively list every non-test `.ts`/`.tsx` file under a source root,
 * skipping `__tests__`, `node_modules`, and `dist`. This is the single
 * definition of "which files the policy tooling scans" — shared by the
 * conversion ratchet, the authorization-matrix scanner, and the dep-graph
 * scanner so their scope can never drift apart.
 */
export function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name
    if (name === '__tests__' || name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    if (entry.isDirectory()) {
      walkSourceFiles(p, acc)
    } else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.')) {
      acc.push(p)
    }
  }
  return acc
}
