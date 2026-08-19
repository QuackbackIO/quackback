/**
 * Failure transcripts (§7.1 doctrine: "read the transcripts"). Every failing
 * scenario writes its full trace to evals/.results/ (gitignored) for a human to
 * read: prompt summary, activity/chunks, the tool ledger, and any judge
 * reasoning. A CI run uploads this directory as an artifact on failure.
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { slugify } from '@/lib/shared/utils'

export const resultsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.results')

let initialized = false
function ensureDir(): void {
  if (initialized) return
  mkdirSync(resultsDir, { recursive: true })
  initialized = true
}

export interface Transcript {
  id: string
  role: string
  title: string
  status: 'passed' | 'failed' | 'error'
  failures: string[]
  /** Prompt summary (truncated thread), the streamed activity, tool ledger, etc. */
  detail: Record<string, unknown>
}

/** Write one failing scenario's full trace to disk; returns the file path. */
export function writeTranscript(t: Transcript): string {
  ensureDir()
  const file = path.join(resultsDir, `${slugify(t.id)}-${slugify(t.role)}.json`)
  writeFileSync(file, JSON.stringify(t, null, 2))
  return file
}

let summaryStarted = false

/** Append one line to the run summary table. The first append of the process
 *  TRUNCATES the file and stamps a run header: a summary describes ONE run —
 *  lines surviving from a previous run read as current results and send the
 *  reader chasing failures that no longer exist (transcript JSONs, by
 *  contrast, are deliberately kept as per-scenario history). A partial run
 *  (vitest -t) therefore lists only what it actually ran. */
export function appendSummary(line: string): void {
  ensureDir()
  const file = path.join(resultsDir, 'summary.txt')
  if (!summaryStarted) {
    summaryStarted = true
    writeFileSync(file, `# eval run ${new Date().toISOString()}\n${line}\n`)
    return
  }
  appendFileSync(file, line + '\n')
}
