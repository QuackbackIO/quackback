/**
 * Helpers for the team-side feedback AI, import and export journeys
 * (FBA-AI-*, FBA-X-*, FBA-M-13): the CSV import route, its run poll, the
 * board export, and the AI rows a post grows after creation.
 */
import { expect, type APIRequestContext } from '@playwright/test'
import { supportDb, pollFor } from '../support/db'
import { uuid } from './feedback-admin'

/** One CSV cell, quoted the way a spreadsheet writes it. */
function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** A CSV with these columns (the first row's keys unless given) and rows. */
export function csvOf(rows: Record<string, string>[], columns?: string[]): string {
  const cols = columns ?? Object.keys(rows[0] ?? {})
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c] ?? '')).join(','))].join(
    '\n'
  )
}

/** POST /api/import as whoever `api` is signed in as. */
export async function postImport(
  api: APIRequestContext,
  csv: string,
  opts: {
    mode?: 'dry_run' | 'commit'
    boardId?: string
    fileName?: string
    mimeType?: string
  } = {}
) {
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    file: {
      name: opts.fileName ?? 'import.csv',
      mimeType: opts.mimeType ?? 'text/csv',
      buffer: Buffer.from(csv),
    },
    mode: opts.mode ?? 'commit',
  }
  if (opts.boardId) multipart.boardId = opts.boardId
  return api.post('/api/import', { multipart })
}

export interface ImportRunWire {
  id: string
  status: string
  totals: { rows: number; created: number; updated: number; skipped: number; errors: number } | null
  errorReport: { row: number; message: string }[] | null
}

/** The run once it has left pending/running (GET /api/import/runs/:id). */
export async function settledImportRun(
  api: APIRequestContext,
  runId: string
): Promise<ImportRunWire> {
  let run: ImportRunWire | undefined
  await expect
    .poll(
      async () => {
        const res = await api.get(`/api/import/runs/${runId}`)
        if (res.status() !== 200) return `HTTP ${res.status()}`
        run = ((await res.json()) as { run: ImportRunWire }).run
        return run.status
      },
      { timeout: 30_000, intervals: [300, 500, 1000] }
    )
    .toMatch(/^(completed|failed)$/)
  return run!
}

/** Commit an import and wait for its run to settle; fails on a non-202 answer. */
export async function importAndWait(
  api: APIRequestContext,
  csv: string,
  opts: { boardId?: string } = {}
): Promise<ImportRunWire> {
  const res = await postImport(api, csv, { ...opts, mode: 'commit' })
  expect(res.status(), await res.text()).toBe(202)
  const { runId } = (await res.json()) as { runId: string }
  return settledImportRun(api, runId)
}

/** Live (or every, with `withDeleted`) posts with this exact title. */
export async function postsTitled(title: string): Promise<Record<string, unknown>[]> {
  return supportDb()`SELECT * FROM posts WHERE title = ${title} ORDER BY created_at`
}

/** Tag names assigned to a post (live and deleted tags alike). */
export async function tagNamesOf(postUuid: string): Promise<string[]> {
  const rows = await supportDb()`
    SELECT t.name FROM post_tag_assignments a JOIN post_tags t ON t.id = a.tag_id
    WHERE a.post_id = ${postUuid} ORDER BY t.name`
  return rows.map((r) => String(r.name))
}

/** Wait until a post has an embedding; returns the row's AI columns. */
export async function waitForEmbedding(postId: string, timeoutMs = 20_000) {
  return pollFor(
    `embedding for ${postId}`,
    async () => {
      const [row] = await supportDb()`
        SELECT embedding IS NOT NULL AS has_embedding, embedding_model, embedding_updated_at,
               merge_checked_at
        FROM posts WHERE id = ${uuid(postId)}`
      return row?.has_embedding ? row : undefined
    },
    { timeoutMs }
  )
}
