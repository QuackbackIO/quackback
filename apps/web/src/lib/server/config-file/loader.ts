import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { parseQuackbackConfig, type QuackbackConfig } from './schema'

export type LoadResult =
  | { kind: 'ok'; config: QuackbackConfig }
  | { kind: 'absent' }
  | { kind: 'error'; error: string }

/**
 * Read + parse + validate the config file at `path`.
 *
 * Three outcomes:
 * - `absent`: the file doesn't exist (ENOENT). Caller treats this as
 *   "no managed paths".
 * - `error`: the file exists but parsing or schema validation failed.
 *   Caller logs loudly + keeps the previously-loaded valid config (or
 *   the default empty managed list on first boot). An invalid file must
 *   never silently unlock fields.
 * - `ok`: the file parsed and validated.
 */
export async function loadConfigFile(path: string): Promise<LoadResult> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if (isEnoent(err)) return { kind: 'absent' }
    return { kind: 'error', error: `read failed: ${errMsg(err)}` }
  }
  let doc: unknown
  try {
    doc = parseYaml(raw)
  } catch (err) {
    return { kind: 'error', error: `yaml parse failed: ${errMsg(err)}` }
  }
  const parsed = parseQuackbackConfig(doc)
  if (!parsed.success) {
    return {
      kind: 'error',
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }
  }
  return { kind: 'ok', config: parsed.data }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  )
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
