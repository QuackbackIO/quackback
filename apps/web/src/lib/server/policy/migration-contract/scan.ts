/**
 * Static destructive-DDL scanner for hand-written SQL migrations.
 *
 * Walks `packages/db/drizzle/*.sql` and, via a comment/string-literal-aware
 * tokenizer (not a full SQL parser — see `stripNoise`), finds every DDL
 * statement that can break a code version that is still running against the
 * *old* shape while a pooled fleet rolls a migration out workspace by workspace.
 * Each finding must be paired with a
 * `-- @contract: safe-after X.Y.Z` annotation somewhere in the same file, or
 * the migration is flagged.
 *
 * `COLUMN` is optional in Postgres's own grammar for `DROP [COLUMN]`,
 * `ALTER [COLUMN] ... TYPE`, `ALTER [COLUMN] ... SET NOT NULL`, `ALTER
 * [COLUMN] ... DROP DEFAULT`, and `RENAME [COLUMN] ... TO`. Every clause
 * regex below matches both spellings — a hand-written migration that omits
 * the keyword is exactly as destructive as one that includes it, and a
 * scanner that only recognized the long form would silently stop working
 * the day an author typed the shorthand.
 *
 * What counts as destructive, and why:
 *   - `DROP COLUMN` / `DROP TABLE`         — old code reading or writing the
 *     dropped shape errors immediately.
 *   - `DROP VIEW` / `DROP MATERIALIZED VIEW` — same failure mode as DROP
 *     TABLE for old code that queries the view directly. No historical
 *     instance (this codebase has never shipped a SQL view), so this
 *     detector has never been exercised against real history — added
 *     defensively because the failure mode is identical to DROP TABLE and
 *     costs nothing to catch.
 *   - `DROP TYPE`                          — old code reading or writing a
 *     column typed against the dropped enum/composite type errors. Same
 *     "no historical instance, added defensively" caveat as DROP VIEW.
 *   - `RENAME COLUMN` / `ALTER TABLE ... RENAME TO` (table rename) — same:
 *     the name old code addresses no longer resolves. Index/sequence/
 *     constraint renames are deliberately NOT included — ordinary
 *     application code and the ORM never address a query by index or
 *     constraint name, so renaming one is invisible to running code (see
 *     0127_conversation_tags_rename.sql, which renames 41 auto-generated
 *     constraint names for cosmetic consistency alongside genuine table
 *     renames; only the table renames are load-bearing).
 *   - `DROP CONSTRAINT`                    — required by the brief; also
 *     matches every historical instance, which drop a FK constraint
 *     alongside a column it referenced.
 *   - `ALTER COLUMN ... SET NOT NULL`      — old code that legitimately
 *     wrote NULL (because that was valid under the old schema) starts
 *     failing writes.
 *   - `ALTER COLUMN ... [SET DATA] TYPE`   — flagged unconditionally, not
 *     just on "narrowing". Telling a widening change (varchar(50) ->
 *     varchar(255)) from a narrowing one (text -> varchar(50), a vector
 *     dimension change) requires real type-lattice knowledge — precision,
 *     scale, enum membership, pgvector dimensions — that a static scanner
 *     cannot safely infer. Both historical instances change a pgvector
 *     column's dimension, which is a hard break for old code with the old
 *     dimension baked in; over-flagging a genuinely safe widening costs a
 *     one-line annotation, which is cheap next to missing a real break.
 *   - `ALTER COLUMN ... DROP DEFAULT`      — old code that omits the column
 *     on INSERT (valid under the old schema, which filled the default)
 *     starts failing NOT NULL writes once the default is gone. Not in the
 *     brief's minimum list, but explicitly called out as an example
 *     ("dropping a default") and has a real historical instance
 *     (0125_conversation_channel_drop_default.sql) with exactly this
 *     failure mode documented in its own comment.
 *
 * Deliberately NOT detected (see README.md for the full rationale):
 *   - `DROP INDEX`                — a performance concern, not a
 *     correctness one; two code versions both still run correctly.
 *   - `ADD CONSTRAINT ... CHECK`  — the genuinely risky shape (a CHECK
 *     added to an already-populated column with no backfill) is
 *     indistinguishable, by static analysis, from the safe shape (CHECK on
 *     a brand-new column, or added after an in-migration backfill) that
 *     the overwhelming majority of historical instances are.
 *   - `RENAME CONSTRAINT` / `ALTER INDEX ... RENAME TO` — not addressed by
 *     running code (see above).
 *   - `ALTER COLUMN ... DROP NOT NULL`, `SET DEFAULT` — both loosen a
 *     constraint; old code that worked under the tighter schema keeps
 *     working under the looser one.
 *   - Dynamic SQL text built via `EXECUTE format('...')` — the DDL lives
 *     inside a string literal to a static scanner, the same limitation the
 *     import-graph scanner accepts for a non-literal `import()` argument.
 */

export type DestructiveKind =
  | 'drop_column'
  | 'drop_table'
  | 'drop_view'
  | 'drop_type'
  | 'drop_constraint'
  | 'rename_column'
  | 'rename_table'
  | 'set_not_null'
  | 'alter_type'
  | 'drop_default'

export interface DestructiveFinding {
  kind: DestructiveKind
  /** 1-based line number in the original (unstripped) file text. */
  line: number
  table: string | null
  /** Human-readable detail for the report: column/constraint name, or "old -> new". */
  detail: string
}

export interface ContractAnnotation {
  /** 1-based line number. */
  line: number
  version: string
}

/** A `-- @contract:` line present but not matching the required format. */
export interface MalformedAnnotation {
  line: number
  raw: string
}

export interface ScannedMigration {
  /** Filename only, e.g. `0196_assistant_config_v2.sql`. */
  file: string
  findings: DestructiveFinding[]
  annotations: ContractAnnotation[]
  malformed: MalformedAnnotation[]
}

// Not anchored to line-start: a `-- @contract:` comment may legitimately
// trail real DDL on the same line (`ALTER TABLE t DROP COLUMN c; --
// @contract: safe-after 1.0.0`), not just stand alone above it. Applied to
// `maskForAnnotations` output, so `--` here can only ever be a real comment
// opener, never text inside a string literal.
const ANNOTATION_LINE = /--\s*@contract:/i
const VALID_ANNOTATION = /--\s*@contract:\s*safe-after\s+(\d+\.\d+\.\d+)\b/i
/** `0.0.0` is syntactically a version but not a real release; reject it as malformed rather than a free pass. */
const ALL_ZERO_VERSION = /^0+\.0+\.0+$/

/**
 * Strip `--` line comments, block comments (Postgres, unlike standard SQL,
 * allows nesting them — handled below), and `'...'` string literals (with
 * `''` escaping), replacing their content with spaces so every surviving
 * character keeps its original line/offset. This is intentionally not a
 * full SQL parser:
 *
 * - Dollar-quoted blocks (`$$ ... $$`, used for `DO` blocks and pg_temp
 *   helper functions) are left untouched on purpose: DDL inside one still
 *   executes, so it must still be scanned. Every dollar-quoted block in the
 *   current migration history was verified to contain no destructive DDL
 *   (guarded `ADD CONSTRAINT`, `CREATE TABLE ... PARTITION OF`, a helper
 *   function) — see README.md.
 * - String literals and both comment styles are stripped as whole units so
 *   an apostrophe inside an English-prose comment ("doesn't", "the
 *   customer's") can't be mistaken for the start of a SQL string and
 *   swallow whatever real DDL follows, and so DDL-shaped words inside a
 *   jsonb default's data or a historical note written as a comment never
 *   match a DDL keyword regex. A quote *inside* either comment style is
 *   never reached as "start of a string", because the whole comment span is
 *   consumed by its own branch before the string-literal check ever runs on
 *   it.
 */
export function stripNoise(sql: string): string {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 1
      out += '  '
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++
          out += '  '
          i += 2
          continue
        }
        if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--
          out += '  '
          i += 2
          continue
        }
        out += sql[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    if (c === "'") {
      out += ' '
      i++
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += '  '
          i += 2
          continue
        }
        if (sql[i] === "'") {
          out += ' '
          i++
          break
        }
        out += sql[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Mask string literals and block comments (blank them) for locating
 * `@contract` (and, in `replay-safety.ts`, `@replay`) annotations, but pass
 * `--` line comments through verbatim.
 * Unlike `stripNoise`, the annotation itself lives inside the comment we'd
 * otherwise blank, and it may legitimately trail real DDL on the same line
 * (`ALTER TABLE ... DROP COLUMN x; -- @contract: safe-after 1.0.0`) rather
 * than starting the line. Passing the comment through verbatim (instead of
 * anchoring the search to line-start) still can't misfire on an apostrophe
 * inside the comment's own prose, because that apostrophe is never reached
 * as "start a string" — the whole comment span is skipped as one unit by
 * the `--` branch below before any string-literal check runs on it.
 */
export function maskForAnnotations(sql: string): string {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') {
        out += sql[i]
        i++
      }
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 1
      out += '  '
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++
          out += '  '
          i += 2
          continue
        }
        if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--
          out += '  '
          i += 2
          continue
        }
        out += sql[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    if (c === "'") {
      out += ' '
      i++
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += '  '
          i += 2
          continue
        }
        if (sql[i] === "'") {
          out += ' '
          i++
          break
        }
        out += sql[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

/** 1-based line number for a character offset into `text`. */
function lineAt(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

// The `d` (hasIndices) flag reports each capture group's absolute offset in
// `.indices`, so the clause group's start can be read directly instead of
// re-deriving it with a fragile `indexOf` re-search.
const ALTER_TABLE_STMT = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([\w.]+)"?\s+([\s\S]*?)(?=;|$)/dgi
const DROP_TABLE_STMT = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([\w.]+)"?/gi
/** Old code that queries a dropped view or materialized view directly errors, same as DROP TABLE. */
const DROP_VIEW_STMT = /DROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?"?([\w.]+)"?/gi
/** Old code that reads/writes a column typed against the dropped enum errors. */
const DROP_TYPE_STMT = /DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?"?([\w.]+)"?/gi

// `COLUMN` is optional in Postgres's DROP/ALTER/RENAME column syntax — a
// migration can legally write `ALTER TABLE t DROP x`, `ALTER TABLE t ALTER x
// TYPE ...`, `ALTER TABLE t RENAME x TO y`, with the keyword omitted. Every
// clause below matches both spellings.
//
// The shorthand DROP form creates a real ambiguity: with `COLUMN` optional,
// bare `DROP x` and `DROP CONSTRAINT x` / `ALTER x DROP DEFAULT` / `ALTER x
// DROP NOT NULL` / `ALTER x DROP IDENTITY` / `ALTER x DROP EXPRESSION` all
// start with the literal token `DROP`. The negative lookahead below is what
// keeps DROP_COLUMN_CLAUSE from swallowing those five as a column named
// "constraint" / "default" / etc. — see __tests__/scan.test.ts for a test
// pinning each collision.
const DROP_COLUMN_RESERVED = 'CONSTRAINT|DEFAULT|NOT|IDENTITY|EXPRESSION'
const DROP_COLUMN_CLAUSE = new RegExp(
  `DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?(?!(?:${DROP_COLUMN_RESERVED})\\b)"?(\\w+)"?`,
  'gi'
)
const DROP_CONSTRAINT_CLAUSE = /DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi
// `RENAME (?:COLUMN )?x TO y` requires a literal `TO` right after the
// captured name, which a bare table rename (`RENAME TO y`, no name before
// `TO`) and a constraint rename (`RENAME CONSTRAINT x TO y`, where `x` is a
// constraint name immediately followed by another identifier, not `TO`)
// both fail to satisfy — see __tests__/scan.test.ts for both as pinned
// negatives, including the case that motivates the explicit check.
const RENAME_COLUMN_CLAUSE = /RENAME\s+(?:COLUMN\s+)?"?(\w+)"?\s+TO\s+"?(\w+)"?/gi
/** Bare table rename — deliberately excludes RENAME COLUMN / RENAME CONSTRAINT. */
const RENAME_TABLE_CLAUSE = /RENAME\s+TO\s+"?(\w+)"?/gi
const SET_NOT_NULL_CLAUSE = /ALTER\s+(?:COLUMN\s+)?"?(\w+)"?\s+SET\s+NOT\s+NULL/gi
const ALTER_TYPE_CLAUSE = /ALTER\s+(?:COLUMN\s+)?"?(\w+)"?\s+(?:SET\s+DATA\s+)?TYPE\s+/gi
const DROP_DEFAULT_CLAUSE = /ALTER\s+(?:COLUMN\s+)?"?(\w+)"?\s+DROP\s+DEFAULT/gi

/**
 * Run a clause-level regex against one ALTER TABLE statement's clause text
 * and emit a finding per match. Handles the (currently theoretical, but
 * legal) comma-separated multi-clause form — e.g.
 * `ALTER TABLE t DROP COLUMN a, DROP COLUMN b` — by matching globally rather
 * than taking only the first hit.
 */
function findClauses(
  clauseText: string,
  clauseStart: number,
  fullText: string,
  re: RegExp,
  kind: DestructiveKind,
  table: string,
  detailOf: (m: RegExpExecArray) => string
): DestructiveFinding[] {
  const out: DestructiveFinding[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(clauseText))) {
    out.push({
      kind,
      line: lineAt(fullText, clauseStart + m.index),
      table,
      detail: detailOf(m),
    })
  }
  return out
}

/** Run a top-level (not ALTER-TABLE-clause) DDL regex over the whole stripped file. */
function findTopLevel(stripped: string, re: RegExp, kind: DestructiveKind): DestructiveFinding[] {
  const out: DestructiveFinding[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped))) {
    out.push({ kind, line: lineAt(stripped, m.index), table: m[1], detail: m[1] })
  }
  return out
}

/**
 * Scan one migration file's text for destructive DDL and `@contract`
 * annotations. Pure and deterministic — unit-tested against synthetic
 * snippets so extraction rules are pinned without leaning on the (frozen but
 * still large) live migration history.
 */
export function scanMigrationFile(file: string, text: string): ScannedMigration {
  const annotations: ContractAnnotation[] = []
  const malformed: MalformedAnnotation[] = []
  const masked = maskForAnnotations(text)
  const maskedLines = masked.split('\n')
  for (let idx = 0; idx < maskedLines.length; idx++) {
    const maskedLine = maskedLines[idx]
    if (!ANNOTATION_LINE.test(maskedLine)) continue
    // Report from the `--` onward, not the whole line: real DDL may precede
    // a trailing annotation, and that DDL isn't part of the annotation text.
    const raw = maskedLine.slice(maskedLine.indexOf('--')).trim()
    const valid = VALID_ANNOTATION.exec(maskedLine)
    if (valid && !ALL_ZERO_VERSION.test(valid[1])) {
      annotations.push({ line: idx + 1, version: valid[1] })
    } else {
      malformed.push({ line: idx + 1, raw })
    }
  }

  const stripped = stripNoise(text)
  const findings: DestructiveFinding[] = [
    ...findTopLevel(stripped, DROP_TABLE_STMT, 'drop_table'),
    ...findTopLevel(stripped, DROP_VIEW_STMT, 'drop_view'),
    ...findTopLevel(stripped, DROP_TYPE_STMT, 'drop_type'),
  ]

  ALTER_TABLE_STMT.lastIndex = 0
  let am: RegExpExecArray | null
  while ((am = ALTER_TABLE_STMT.exec(stripped))) {
    const table = am[1]
    const clauses = am[2]
    const indices = (am as RegExpExecArray & { indices: Array<[number, number]> }).indices
    const clauseStart = indices[2][0]

    findings.push(
      ...findClauses(
        clauses,
        clauseStart,
        stripped,
        DROP_COLUMN_CLAUSE,
        'drop_column',
        table,
        (m) => m[1]
      )
    )
    findings.push(
      ...findClauses(
        clauses,
        clauseStart,
        stripped,
        DROP_CONSTRAINT_CLAUSE,
        'drop_constraint',
        table,
        (m) => m[1]
      )
    )
    findings.push(
      ...findClauses(
        clauses,
        clauseStart,
        stripped,
        RENAME_COLUMN_CLAUSE,
        'rename_column',
        table,
        (m) => `${m[1]} -> ${m[2]}`
      )
    )
    findings.push(
      ...findClauses(
        clauses,
        clauseStart,
        stripped,
        RENAME_TABLE_CLAUSE,
        'rename_table',
        table,
        (m) => `${table} -> ${m[1]}`
      )
    )
    findings.push(
      ...findClauses(
        clauses,
        clauseStart,
        stripped,
        SET_NOT_NULL_CLAUSE,
        'set_not_null',
        table,
        (m) => m[1]
      )
    )
    findings.push(
      ...findClauses(
        clauses,
        clauseStart,
        stripped,
        ALTER_TYPE_CLAUSE,
        'alter_type',
        table,
        (m) => m[1]
      )
    )
    findings.push(
      ...findClauses(
        clauses,
        clauseStart,
        stripped,
        DROP_DEFAULT_CLAUSE,
        'drop_default',
        table,
        (m) => m[1]
      )
    )
  }

  findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind))
  return { file, findings, annotations, malformed }
}
