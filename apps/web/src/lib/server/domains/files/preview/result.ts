/**
 * What every preview deriver returns, and the string hygiene they share.
 *
 * Derivers are pure: bytes in, preview out. They throw for a file they cannot
 * read (the job records 'failed'), and throw `PreviewDependencyError` only when
 * a parser itself is missing (the job lets the queue retry).
 */
import type { FilePreviewMeta } from '@/lib/server/db'

/** Most characters stored as a file's text excerpt. */
export const EXCERPT_MAX_CHARS = 20_000

/** An object derived from the file, stored next to it as `<key>.<suffix>`. */
export interface DerivedObject {
  suffix: string
  contentType: string
  bytes: Uint8Array
  /** The meta field that records the stored key. */
  field: 'thumbKey' | 'renditionKey'
}

export interface PreviewResult {
  /** 'none' when the format has nothing to derive. */
  status: 'ready' | 'none'
  meta: FilePreviewMeta
  excerpt?: string
  derived?: DerivedObject[]
}

export const NOTHING_TO_DERIVE: PreviewResult = Object.freeze({
  status: 'none',
  meta: Object.freeze({}),
}) as PreviewResult

/** A parser module could not be loaded: a fault in the deployment, not the file. */
export class PreviewDependencyError extends Error {
  constructor(dependency: string, options?: { cause?: unknown }) {
    super(`Preview dependency unavailable: ${dependency}`, options)
    this.name = 'PreviewDependencyError'
  }
}

/** The job's time budget ran out between two phases. */
export class PreviewTimeoutError extends Error {
  constructor() {
    super('Preview took too long')
    this.name = 'PreviewTimeoutError'
  }
}

/** Load a parser on first use; a missing module is a dependency fault. */
export async function loadDependency<T>(name: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (err) {
    throw new PreviewDependencyError(name, { cause: err })
  }
}

/**
 * A point in time the job must finish by. Parsers run synchronously, so the
 * check sits between phases (pages, entries): a phase that has started runs
 * to its end, and each phase is kept small by the deriver's own caps.
 */
export class Deadline {
  private readonly at: number

  constructor(ms: number) {
    this.at = Date.now() + ms
  }

  check(): void {
    if (Date.now() > this.at) throw new PreviewTimeoutError()
  }
}

/** No limit, for callers (tests) that do not need one. */
export const NO_DEADLINE: Pick<Deadline, 'check'> = { check() {} }

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd)
const ELLIPSIS = String.fromCharCode(0x2026)

/**
 * Text a Postgres text or jsonb column can hold: no NUL or other control
 * characters (tabs and newlines stay), no unpaired surrogate halves.
 */
export function cleanText(s: string): string {
  return s.replace(CONTROL, '').replace(LONE_SURROGATE, REPLACEMENT_CHARACTER)
}

/** At most `max` characters, never splitting a surrogate pair. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s
  let end = max
  const last = s.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end--
  return s.slice(0, end)
}

/** A display cell: clean, on one line, at most `max` characters with an ellipsis when cut. */
export function cell(value: unknown, max: number): string {
  const s = cleanText(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
  return s.length <= max ? s : clip(s, max - 1) + ELLIPSIS
}

/**
 * The excerpt stored for the assistant and search: clean text with runs of
 * spaces collapsed, at most two consecutive line breaks, capped. Undefined
 * when nothing is left.
 */
export function normalizeExcerpt(s: string): string | undefined {
  // Normalizing a whole 25 MB file is wasted work; a margin over the cap is
  // enough for whitespace that collapses away.
  const text = cleanText(clip(s, EXCERPT_MAX_CHARS * 4))
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? clip(text, EXCERPT_MAX_CHARS) : undefined
}
