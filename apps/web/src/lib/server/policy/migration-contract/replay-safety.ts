/**
 * Which bundled migrations may be **replayed** against a database that already
 * carries their effects.
 *
 * This exists because of something the fleet actually did, not a hypothetical.
 * Five live tenant databases have a complete 226-row `drizzle.__drizzle_migrations`
 * that stops at `0248`, while physically carrying assorted later migrations —
 * because every one of them was applied with raw `psql -f`, which never writes
 * the ledger. Running a migrator against them replays whatever the ledger does
 * not record.
 *
 * There are two wrong answers to that and one right one.
 *
 * - **Wrong: invent the ledger rows.** A row asserting a migration ran when
 *   nobody watched it run is worse than a missing row, because a missing row
 *   is a question and a wrong row is a false answer. The standing judgement in
 *   this work is exactly that.
 * - **Wrong: refuse anything that is not idempotent.** 197 of the 228 bundled
 *   migrations are plain `CREATE TABLE` / `ADD COLUMN`, so that rule would
 *   refuse every ordinary rollout as well as every fresh tenant, whose replay
 *   set is the entire lineage starting at `0000_initial`.
 * - **Right: separate the two ways a replay can go wrong, because only one of
 *   them is dangerous.** A replay that *errors* is caught by the fact that
 *   `migrate()` wraps the whole lineage in one transaction — the run rolls back
 *   whole and Postgres's own message ("column ... already exists") is the
 *   ledger-drift diagnosis, produced by the database rather than predicted. A
 *   replay that *succeeds and writes* is the one atomicity cannot save you
 *   from, and it is the only class this gates on.
 *
 * Then the ledger row that gets written is written by drizzle *after it actually
 * executed the statements*, which is evidence rather than assertion. Nothing
 * here ever inserts a ledger row itself.
 *
 * ## What makes a statement replay-safe
 *
 * Only that **running it a second time against a database where it already ran
 * changes nothing**. That is a narrower claim than "idempotent" in general and
 * it is checkable syntactically for the shapes this repository uses:
 *
 * | Safe | Because |
 * | --- | --- |
 * | `CREATE … IF NOT EXISTS` | skipped when present |
 * | `DROP … IF EXISTS` | skipped when absent |
 * | `ALTER TABLE … ADD COLUMN IF NOT EXISTS` | skipped when present |
 * | `CREATE OR REPLACE FUNCTION/VIEW/TRIGGER` | overwritten with the same text |
 * | `COMMENT ON …` | overwritten with the same text |
 * | `INSERT … ON CONFLICT DO NOTHING/UPDATE` | absorbed |
 * | `SET`/`SELECT` with no write | no effect |
 *
 * `stripNoise` is reused from the destructive-DDL scanner rather than
 * re-tokenised, so the two agree about what is a comment and what is a string —
 * and so the dollar-quoted-literal limitation documented there is one
 * limitation rather than two.
 */
import { stripNoise } from './scan'

/**
 * What a second run of this migration does to a database where it already ran.
 *
 * The three-way split is the whole point, and a two-way one would be useless:
 *
 * - `safe` — changes nothing. Replaying is free.
 * - `errors` — the statement fails ("column already exists", "relation already
 *   exists"). **This is not dangerous**, because `migrate()` wraps the entire
 *   lineage in one transaction, so the run rolls back whole and the database's
 *   own error message *is* the ledger-drift diagnosis. Nearly every historical
 *   migration is this, which is why a gate that refused them would refuse every
 *   ordinary rollout.
 * - `mutates` — the statement **succeeds and changes data**: an `INSERT` with no
 *   `ON CONFLICT`, an `UPDATE`, a `DELETE`, a `DO` block that could contain
 *   anything. This is the only genuinely dangerous class, because atomicity
 *   cannot save you from a replay that works.
 *
 * So the reconciler gates on `mutates` alone, and mis-classifying something
 * *into* `errors` costs nothing while mis-classifying something *out of*
 * `mutates` is the real error. The `mutates` detector is deliberately greedy for
 * that reason.
 */
export type ReplayVerdict = 'safe' | 'errors' | 'mutates'

export interface ReplayStatementFinding {
  /** 1-based line in the original file. */
  line: number
  /** First ~120 characters of the statement, for the operator's diagnosis. */
  excerpt: string
  reason: string
}

export interface ReplaySafetyReport {
  tag: string
  /** The worst verdict across the file's statements. */
  verdict: ReplayVerdict
  /** Statements that would change data on a second run. Empty unless `mutates`. */
  mutating: ReplayStatementFinding[]
  /** Statements that would error on a second run. Bounded by migrate()'s transaction. */
  erroring: ReplayStatementFinding[]
  /** How many statements were examined; 0 means the file had no DDL at all. */
  statementCount: number
}

/**
 * Statements that do nothing on a second run.
 *
 * Anchored at the start of the statement, applied to noise-stripped text with
 * whitespace collapsed, so a keyword inside a string or comment cannot match.
 */
const SAFE_SHAPES: { re: RegExp; why: string }[] = [
  {
    re: /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\b/i,
    why: 'CREATE INDEX IF NOT EXISTS',
  },
  {
    re: /^CREATE\s+(?:TABLE|SCHEMA|SEQUENCE|EXTENSION|DOMAIN)\s+IF\s+NOT\s+EXISTS\b/i,
    why: 'CREATE ... IF NOT EXISTS',
  },
  {
    re: /^CREATE\s+OR\s+REPLACE\s+(?:FUNCTION|PROCEDURE|VIEW|TRIGGER|RULE)\b/i,
    why: 'CREATE OR REPLACE',
  },
  { re: /^DROP\s+\w+(?:\s+\w+)?\s+IF\s+EXISTS\b/i, why: 'DROP ... IF EXISTS' },
  {
    re: /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^;]*?\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i,
    why: 'ADD COLUMN IF NOT EXISTS',
  },
  { re: /^COMMENT\s+ON\b/i, why: 'COMMENT ON is a total overwrite' },
  { re: /^SET\s+\w/i, why: 'SET has no persistent effect' },
  { re: /^SELECT\b(?![\s\S]*\bINTO\b)/i, why: 'read-only SELECT' },
]

/**
 * Statements that would SUCCEED on a second run and change something.
 *
 * Deliberately greedy. A `DO $$ … $$` block is listed because its body is
 * opaque to this tokenizer and could contain any of the others — refusing to
 * reason about it is the only honest reading. `WITH … INSERT` is listed because
 * `0006_thick_arclight` is exactly that shape and would duplicate rows.
 */
const MUTATING_SHAPES: { re: RegExp; why: string }[] = [
  { re: /^INSERT\s+INTO\b/i, why: 'INSERT with no ON CONFLICT re-inserts on replay' },
  { re: /^WITH\b[\s\S]*\b(?:INSERT|UPDATE|DELETE)\b/i, why: 'CTE performs a write' },
  { re: /^UPDATE\s+/i, why: 'UPDATE re-runs on replay' },
  { re: /^DELETE\s+FROM\b/i, why: 'DELETE re-runs on replay' },
  { re: /^TRUNCATE\b/i, why: 'TRUNCATE re-runs on replay' },
  { re: /^MERGE\b/i, why: 'MERGE re-runs on replay' },
  { re: /^COPY\b/i, why: 'COPY re-runs on replay' },
  { re: /^DO\b/i, why: 'a DO block is opaque here and may contain any write' },
  { re: /^SELECT\b[\s\S]*\bINTO\b/i, why: 'SELECT ... INTO writes a table' },
  { re: /^ALTER\s+SEQUENCE\b[\s\S]*\bRESTART\b/i, why: 'sequence restart re-runs on replay' },
]

/**
 * Split noise-stripped SQL into statements, keeping each one's line number.
 *
 * Dollar-quoted bodies are kept whole: a `$$ … $$` function body contains
 * semicolons that are not statement terminators, and splitting inside one would
 * turn a single `CREATE OR REPLACE FUNCTION` into a dozen unrecognisable
 * fragments — all of which would be refused, which is safe but useless.
 */
export function splitStatements(stripped: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = []
  let buf = ''
  let line = 1
  let startLine = 1
  let i = 0
  let dollarTag: string | null = null

  while (i < stripped.length) {
    const ch = stripped[i]!

    if (dollarTag === null) {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(stripped.slice(i))
      if (m) {
        dollarTag = m[0]
        buf += m[0]
        i += m[0].length
        continue
      }
    } else if (stripped.startsWith(dollarTag, i)) {
      buf += dollarTag
      i += dollarTag.length
      dollarTag = null
      continue
    }

    if (ch === '\n') line++
    if (ch === ';' && dollarTag === null) {
      if (buf.trim() !== '') out.push({ text: buf.trim(), line: startLine })
      buf = ''
      i++
      // Skip forward to the next non-space so the next statement's line number
      // is where its text starts, not where the previous semicolon was.
      while (i < stripped.length && /\s/.test(stripped[i]!)) {
        if (stripped[i] === '\n') line++
        i++
      }
      startLine = line
      continue
    }
    buf += ch
    i++
  }
  if (buf.trim() !== '') out.push({ text: buf.trim(), line: startLine })
  return out
}

/**
 * Classify one migration file.
 *
 * `tag` is only carried through to the report; the verdict comes entirely from
 * `sql`, so a caller cannot get a different answer by renaming a file.
 */
export function assessReplaySafety(tag: string, sqlText: string): ReplaySafetyReport {
  const stripped = stripNoise(sqlText)
  const statements = splitStatements(stripped)
  const droppedTriggers = new Set<string>()
  const mutating: ReplayStatementFinding[] = []
  const erroring: ReplayStatementFinding[] = []

  for (const stmt of statements) {
    const flat = stmt.text.replace(/\s+/g, ' ').trim()

    const dropTrigger = /^DROP\s+TRIGGER\s+IF\s+EXISTS\s+("?[\w.]+"?)/i.exec(flat)
    if (dropTrigger) droppedTriggers.add(normaliseIdent(dropTrigger[1]!))

    // Mutating is checked FIRST. An `INSERT ... ON CONFLICT` is the one write
    // that is genuinely absorbed, so it is the one exemption, and it is stated
    // here rather than left to a safe-shape match that might also swallow a
    // plain INSERT if a pattern were ever loosened.
    const mutator = MUTATING_SHAPES.find((m) => m.re.test(flat))
    if (mutator) {
      if (/^INSERT\s+INTO\b/i.test(flat) && /\bON\s+CONFLICT\b/i.test(flat)) continue
      mutating.push({ line: stmt.line, excerpt: flat.slice(0, 120), reason: mutator.why })
      continue
    }

    if (SAFE_SHAPES.some((s) => s.re.test(flat))) continue

    // `CREATE TRIGGER` has no IF NOT EXISTS in Postgres; the house pattern is a
    // preceding `DROP TRIGGER IF EXISTS` in the same file, which makes the pair
    // a total overwrite.
    const createTrigger = /^CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+("?[\w.]+"?)/i.exec(flat)
    if (createTrigger && droppedTriggers.has(normaliseIdent(createTrigger[1]!))) continue

    erroring.push({
      line: stmt.line,
      excerpt: flat.slice(0, 120),
      reason: 'no recognised replay-safe shape; expected to error on a second run',
    })
  }

  const verdict: ReplayVerdict =
    mutating.length > 0 ? 'mutates' : erroring.length > 0 ? 'errors' : 'safe'
  return { tag, verdict, mutating, erroring, statementCount: statements.length }
}

function normaliseIdent(raw: string): string {
  return raw.replace(/"/g, '').toLowerCase()
}
