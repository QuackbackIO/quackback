import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Recursively list every non-test `.ts`/`.tsx` file under a source root,
 * skipping `__tests__`, `node_modules`, and `dist`. This is the single
 * definition of "which files the policy tooling scans" — shared by the
 * conversion ratchet, the authorization-matrix scanner, and the dep-graph
 * scanner so their scope can never drift apart.
 *
 * Generated files (`.gen.ts` — the route tree) are skipped too: they are
 * gitignored build artifacts, so they exist in a dev checkout and not in CI,
 * and a scan that saw them would produce a different answer in each place.
 * Policy verdicts must be a function of the committed tree alone.
 */
export function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name
    if (name === '__tests__' || name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    if (entry.isDirectory()) {
      walkSourceFiles(p, acc)
    } else if (
      (name.endsWith('.ts') || name.endsWith('.tsx')) &&
      !name.includes('.test.') &&
      !name.includes('.gen.')
    ) {
      acc.push(p)
    }
  }
  return acc
}
