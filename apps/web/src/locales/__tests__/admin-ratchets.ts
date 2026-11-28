/**
 * The admin ratchets: each scan, its baseline beside the tests, and what to do
 * about a finding. The tests and `bun run i18n:baseline` both read this list.
 */
import { join } from 'node:path'
import { type Scan } from './admin-ratchet'
import { scanDirection } from './admin-direction-scan'
import { scanEnglish } from './admin-english-scan'

export interface Ratchet {
  name: string
  scan: Scan
  baselinePath: string
  /** What a finding is, for the failure message ("English strings in code"). */
  problem: string
  /** How to fix one. */
  fix: string
}

export const RATCHETS: Ratchet[] = [
  {
    name: 'english',
    scan: scanEnglish,
    baselinePath: join(import.meta.dirname, 'admin-english-baseline.json'),
    problem: 'English strings in code',
    fix: 'Move these strings to the catalog (en.json and the 12 other languages).',
  },
  {
    name: 'direction',
    scan: scanDirection,
    baselinePath: join(import.meta.dirname, 'admin-direction-baseline.json'),
    problem: 'left/right classes or unmirrored direction icons',
    fix: 'Use the start/end class shown, and add rtl:-scale-x-100 to icons that point back or next. Keep left/right only where the side is physical.',
  },
]
