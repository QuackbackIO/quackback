/** The failure text of an admin ratchet, in the form docs/translating.md shows. */
import { compareWithBaseline, readBaseline, type Finding } from './admin-ratchet'
import type { Ratchet } from './admin-ratchets'

export function ratchetReport(
  ratchet: Ratchet,
  found: Map<string, Finding[]>
): { regressions: string; stale: string[] } {
  const { regressions, stale } = compareWithBaseline(found, readBaseline(ratchet.baselinePath))
  const text = regressions
    .map(({ file, count, baseline, findings }) =>
      [
        `${file} has ${count} ${ratchet.problem} (baseline ${baseline}):`,
        ...findings.map(({ line, text }) => `  line ${line} ${text}`),
      ].join('\n')
    )
    .join('\n\n')
  return {
    regressions: text
      ? `${text}\n\n${ratchet.fix}\nAfter you remove some, run: bun run i18n:baseline`
      : '',
    stale,
  }
}
