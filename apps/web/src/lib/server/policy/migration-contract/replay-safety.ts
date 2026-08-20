/**
 * Which bundled migrations may be **replayed** against a database that already
 * carries their effects.
 *
 * This exists because of something the fleet actually did, not a hypothetical.
 * Five live workspace databases have a complete 226-row `drizzle.__drizzle_migrations`
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
 *   refuse every ordinary rollout as well as every fresh workspace, whose replay
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
 *
 * ## The one thing a human may assert that this cannot see
 *
 * A `DO $$ … $$` block is opaque here and is refused (`mutates`) for that
 * reason. That is the right default, and teaching this file to parse plpgsql
 * would be the wrong fix: the sibling scanner already carries one recall hole
 * around dollar-quoted text, and a deeper parser would deepen it rather than
 * close it.
 *
 * So the escape is not a smarter parser, it is an **explicit claim a reviewer
 * signs**, in the same shape as the destructive-DDL linter's
 * `-- @contract: safe-after X.Y.Z`:
 *
 * ```sql
 * -- @replay: guarded-by the old column still existing; the rename is skipped once it is gone
 * DO $$ BEGIN IF EXISTS (…) THEN ALTER TABLE … RENAME COLUMN … ; END IF; END $$;
 * ```
 *
 * Three properties are what make it a claim rather than a loophole:
 *
 * 1. **It only reaches a `DO` block.** Put it above an `INSERT`, an `UPDATE` or
 *    anything else in `MUTATING_SHAPES` and the file is refused *and* the
 *    misplacement is reported. The annotation can never launder a write this
 *    file can actually read.
 * 2. **It is scoped to one statement**, not to the file — it must sit in the
 *    comment block directly above the statement it vouches for. `@contract` is
 *    file-scoped because its subject (a release) genuinely is; this one's
 *    subject is a guard, and a guard is a property of a single statement.
 * 3. **It is checked, not trusted.** `__tests__/lineage-double-apply.db.test.ts`
 *    re-applies every migration this file calls `safe` to an already-migrated
 *    database and asserts the catalogue does not move. A wrong annotation turns
 *    that test red; nothing about writing the comment makes the claim true.
 *
 * Anything malformed, dangling, or attached to the wrong kind of statement is
 * reported as mutating. The failure direction is always "refuse the replay".
 *
 * ## The thing this file reads that it cannot see
 *
 * Everything above judges one migration against the schema **that file**
 * expects. A replay happens against the schema the **whole lineage** produced,
 * and those differ whenever a later migration moves the object an earlier one
 * names. `DROP TABLE IF EXISTS x` is `safe` in isolation and drops a live table
 * once a later migration has put `x` back; `CREATE INDEX IF NOT EXISTS … ON y`
 * is `safe` in isolation and has no relation to build on once a later migration
 * has dropped `y`.
 *
 * Closing that properly means teaching this file object lifetimes across the
 * whole corpus. Until someone does, the individual known-wrong verdicts are
 * corrected by name in {@link REPLAY_OVERRIDES} — see its own comment for why
 * that lives here rather than in each caller.
 */
import { maskForAnnotations, stripNoise } from './scan'

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
  /**
   * 1-based line in the original file, or **0** for a finding that is about the
   * file rather than about a statement in it — which today means exactly one
   * thing, a {@link ReplayOverride}. A reviewed override contradicts the
   * lineage's effect on the file as a whole, not a line of it, and inventing a
   * line number for it would point an operator at a statement that is innocent
   * when read on its own.
   */
  line: number
  /** First ~120 characters of the statement, for the operator's diagnosis. */
  excerpt: string
  reason: string
}

/**
 * A verdict a reviewer has corrected by hand, because the shape reading above
 * is right about the file and wrong about the lineage.
 *
 * ### Why this is here and not in the callers
 *
 * It was in a test. `__tests__/lineage-double-apply.db.test.ts` measured both of
 * the entries below by applying the whole lineage twice, wrote them down, and
 * skipped them — so the only code that knew these two verdicts were false was
 * the code that had no way to act on them. `gapHealVerdict` in the fleet
 * migrator, which truncates a live workspace's ledger on the strength of a `safe`
 * verdict, did not know they existed. Correcting the verdict at its source is
 * what makes the heal, the replay gate and the CLI preflight all right at once,
 * instead of three lists that can drift apart.
 *
 * ### The three properties that keep this from becoming an exemption list
 *
 * 1. **It can only ever refuse.** `verdict` excludes `safe` in the type, and the
 *    override is applied by taking the *worse* of the two verdicts, so an entry
 *    can raise `safe` to `mutates` and can never lower anything. An override
 *    that waves a replay through is not merely discouraged, it is unwritable.
 * 2. **Each entry says why in a form a reviewer can check** — which later
 *    migration falsifies the shape reading, and what the replay does instead.
 *    Not a tag and a shrug.
 * 3. **Each entry is re-earned on every run of the double-apply test.** Deleting
 *    one puts its migration back in that test's replay-safe set, where it is
 *    re-applied against a fully migrated database and fails — named, with the
 *    error. So an entry cannot be dropped to make something green; it can only
 *    be dropped once the replay genuinely stops failing, which is the same
 *    evidence that put it here. `stillFailsWith` is what that test matches, so
 *    the entry carries its own falsification condition.
 */
export interface ReplayOverride {
  /** Bundled migration tag. A trailing `.sql` is accepted and ignored. */
  readonly tag: string
  /**
   * The verdict to impose in place of the shape reading.
   *
   * `safe` is absent from this type on purpose. See property 1 above: the point
   * of the exclusion is that "override it to safe" cannot be expressed, rather
   * than being expressible and merely unused.
   */
  readonly verdict: Exclude<ReplayVerdict, 'safe'>
  /** Why the shape reading is wrong here, naming the migration that falsifies it. */
  readonly why: string
  /**
   * What replaying this against a fully migrated database does today, measured.
   *
   * Matched by `lineage-double-apply.db.test.ts` against the real error, so this
   * is the entry's own expiry condition: when the replay stops failing this way,
   * the test says so by name rather than the entry quietly outliving its reason.
   */
  readonly stillFailsWith: RegExp
}

/**
 * The corrected verdicts. Both entries are the same defect — a file judged
 * against the schema it expects rather than the schema the lineage produced —
 * and both were measured, not reasoned about.
 *
 * Adding an entry is meant to be cheap: measure it, write down which later
 * migration is responsible, done. Removing one is not, and cannot be: see
 * property 3 on {@link ReplayOverride}.
 */
export const REPLAY_OVERRIDES: readonly ReplayOverride[] = [
  {
    tag: '0091_drop_conversation_tags',
    verdict: 'mutates',
    why:
      '`DROP TABLE IF EXISTS conversation_tags` is only a no-op while that table is absent, and ' +
      '0127_conversation_tags_rename puts it back (renaming chat_tags into the freed name). A ' +
      'replay therefore targets a live table rather than skipping: it succeeds and destroys, ' +
      'which is the mutates class. It fails today only because a foreign key from ' +
      'conversation_tag_assignments happens to depend on it, and that is luck rather than a ' +
      'property of the classifier.',
    stillFailsWith: /conversation_tags/,
  },
  {
    tag: '0207_index_tuning',
    verdict: 'mutates',
    why:
      '`CREATE INDEX IF NOT EXISTS … ON pipeline_log` is only a no-op while that table exists, ' +
      'and 0217_drop_feedback_pipeline drops it, so on replay there is no relation for IF NOT ' +
      'EXISTS to find and the statement errors. Refused as mutates rather than errors because ' +
      'the gap heal treats the two differently and only mutates is refused in both populations: ' +
      'an errors verdict here would still let a heal delete the ledger rows and then fail on ' +
      'every replay forever, with nothing able to write them back.',
    stillFailsWith: /pipeline_log/,
  },
]

/** How bad each verdict is, so an override can be applied as "the worse of the two". */
const SEVERITY: Record<ReplayVerdict, number> = { safe: 0, errors: 1, mutates: 2 }

/** Tags are written with and without the `.sql` suffix around here; both mean one migration. */
function normaliseTag(tag: string): string {
  return tag.replace(/\.sql$/i, '')
}

const OVERRIDE_BY_TAG = new Map(REPLAY_OVERRIDES.map((o) => [normaliseTag(o.tag), o]))

/** The reviewed correction for a migration, if it has one. */
export function replayOverrideFor(tag: string): ReplayOverride | null {
  return OVERRIDE_BY_TAG.get(normaliseTag(tag)) ?? null
}

export interface ReplaySafetyReport {
  tag: string
  /**
   * The answer callers act on: the worst verdict across the file's statements,
   * raised by a {@link ReplayOverride} where one applies.
   */
  verdict: ReplayVerdict
  /**
   * What the statement shapes alone said, before any override.
   *
   * Carried so the override can be checked for still being load-bearing: an
   * entry whose `shapeVerdict` has caught up with it is redundant and should be
   * deleted. Never gate on this — it is the reading that is known to be wrong.
   */
  shapeVerdict: ReplayVerdict
  /** The reviewed correction applied to this file, if any. */
  override: ReplayOverride | null
  /** Statements that would change data on a second run. Empty unless `mutates`. */
  mutating: ReplayStatementFinding[]
  /** Statements that would error on a second run. Bounded by migrate()'s transaction. */
  erroring: ReplayStatementFinding[]
  /**
   * Statements an author vouched for with `-- @replay: guarded-by …`, and would
   * otherwise be refused. Non-empty means this file's verdict rests partly on a
   * human claim, which is worth seeing in a migrator log rather than inferring
   * from a verdict that silently got kinder.
   */
  vouched: ReplayStatementFinding[]
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
  {
    // The constraint sibling of `DROP ... IF EXISTS` above, which cannot match
    // it because this one starts with ALTER.
    //
    // Single-action only: the table name is followed immediately by the action
    // and the statement ends there, so a compound
    // `ALTER TABLE t DROP CONSTRAINT IF EXISTS a, ADD CONSTRAINT b ...` cannot
    // be waved through on the strength of its safe half. Being too strict here
    // costs a refusal, which is the safe direction; being too loose costs a
    // replay against a live workspace.
    re: /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s,;]+\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+[^\s,;]+\s*;?$/i,
    why: 'DROP CONSTRAINT IF EXISTS',
  },
  {
    // A total overwrite in the same sense as COMMENT ON: the second run writes
    // the value the first one left, so the catalogue does not move. Single
    // action, and no comma after the value, for the reason given above — a
    // default that genuinely contains one is refused rather than guessed at.
    //
    // The value itself is optional in the pattern because this runs on
    // noise-stripped text, where a string literal has already been blanked:
    // `SET DEFAULT 'job'` arrives here as `SET DEFAULT`.
    re: /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s,;]+\s+ALTER\s+COLUMN\s+[^\s,;]+\s+SET\s+DEFAULT\b[^;,]*;?$/i,
    why: 'ALTER COLUMN ... SET DEFAULT is a total overwrite',
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
 * reason about it is the only honest reading, and the only way out is the
 * `-- @replay: guarded-by …` claim described in the file header, not a cleverer
 * regex. `WITH … INSERT` is listed because `0006_thick_arclight` is exactly that
 * shape and would duplicate rows.
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

export interface SplitStatement {
  text: string
  /** 1-based line the statement's text starts on. */
  line: number
  /**
   * 1-based line its terminating `;` sits on.
   *
   * Only used to bound where an annotation may live: the comment block
   * "directly above" statement _n_ is everything after statement _n-1_ ends. A
   * `-- @replay:` comment written *inside* a preceding statement therefore
   * attaches to nothing, rather than silently jumping the gap to the next one.
   */
  endLine: number
}

/**
 * Split noise-stripped SQL into statements, keeping each one's line span.
 *
 * Dollar-quoted bodies are kept whole: a `$$ … $$` function body contains
 * semicolons that are not statement terminators, and splitting inside one would
 * turn a single `CREATE OR REPLACE FUNCTION` into a dozen unrecognisable
 * fragments — all of which would be refused, which is safe but useless.
 */
export function splitStatements(stripped: string): SplitStatement[] {
  const out: SplitStatement[] = []
  let buf = ''
  let line = 1
  let startLine = 1
  /**
   * Whether `buf` holds any non-whitespace yet. `stripNoise` blanks comments to
   * spaces rather than deleting them, so the run of "whitespace" before a
   * statement is usually its header comment — often dozens of lines of it. This
   * flag is what moves `startLine` past that to the line the SQL really starts
   * on, which the previous version only did for the second statement onward and
   * so reported every file's first statement as line 1.
   */
  let started = false
  let i = 0
  let dollarTag: string | null = null

  /** Record the first non-blank character's line, once per statement. */
  const opened = () => {
    if (!started) {
      startLine = line
      started = true
    }
  }

  while (i < stripped.length) {
    const ch = stripped[i]!

    if (dollarTag === null) {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(stripped.slice(i))
      if (m) {
        opened()
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
      if (buf.trim() !== '') out.push({ text: buf.trim(), line: startLine, endLine: line })
      buf = ''
      started = false
      i++
      continue
    }
    if (!/\s/.test(ch)) opened()
    buf += ch
    i++
  }
  if (buf.trim() !== '') out.push({ text: buf.trim(), line: startLine, endLine: line })
  return out
}

/** Any `-- @replay:` comment, well-formed or not. Nothing else may claim the prefix. */
const REPLAY_ANNOTATION_LINE = /--\s*@replay:/i
/**
 * The only accepted form. `guarded-by` is a required literal rather than free
 * text so a half-remembered spelling fails loudly instead of reading as a
 * different, unrecognised claim; the prose after it is required too, because
 * the thing a reviewer has to check is *which* guard, and an annotation that
 * does not say is not reviewable. Mirrors `@contract`'s rejection of
 * `safe-after 0.0.0`: syntactically a version, but not one anybody could check.
 */
const VALID_REPLAY_ANNOTATION = /--\s*@replay:\s*guarded-by\s+(\S.*?)\s*$/i

/** The only statement shape an annotation may vouch for — see the file header. */
const VOUCHABLE_SHAPE = /^DO\b/i

interface ParsedReplayAnnotation {
  line: number
  /** Prose after `guarded-by`, or null when the line does not parse. */
  rationale: string | null
  /** The comment as written, from `--` onward, for the operator's diagnosis. */
  raw: string
}

/**
 * Locate `-- @replay:` comments, well-formed or not.
 *
 * Reads `maskForAnnotations` output rather than raw text so a `@replay:` inside
 * a string literal or a block comment can never be mistaken for a claim, and
 * reuses the sibling scanner's masker rather than a second one so the two agree
 * about what a comment is.
 */
export function parseReplayAnnotations(sqlText: string): ParsedReplayAnnotation[] {
  const out: ParsedReplayAnnotation[] = []
  const lines = maskForAnnotations(sqlText).split('\n')
  for (let idx = 0; idx < lines.length; idx++) {
    const text = lines[idx]!
    if (!REPLAY_ANNOTATION_LINE.test(text)) continue
    const valid = VALID_REPLAY_ANNOTATION.exec(text)
    out.push({
      line: idx + 1,
      rationale: valid ? valid[1]! : null,
      raw: text.slice(text.indexOf('--')).trim(),
    })
  }
  return out
}

/**
 * Which statement an annotation sits above, or -1 for none.
 *
 * The window for statement _n_ runs from the line after statement _n-1_ ends
 * through statement _n_'s own first line. That closes the two gaps that would
 * otherwise make placement meaningless: an annotation buried inside an earlier
 * statement's body attaches to nothing, and one trailing the last statement in
 * the file attaches to nothing either.
 */
function statementBelow(statements: readonly SplitStatement[], line: number): number {
  for (let i = 0; i < statements.length; i++) {
    const from = i === 0 ? 1 : statements[i - 1]!.endLine + 1
    if (line >= from && line <= statements[i]!.line) return i
  }
  return -1
}

/**
 * Classify one migration file.
 *
 * The verdict comes from `sql` alone, except where `tag` names an entry in
 * {@link REPLAY_OVERRIDES} — the one place the file's identity is load-bearing,
 * because the thing an override knows is what the *rest of the lineage* did to
 * this file's objects, which is not in this file's text. The suffix is
 * normalised so `0091_drop_conversation_tags` and `0091_drop_conversation_tags.sql`
 * cannot get different answers.
 */
export function assessReplaySafety(tag: string, sqlText: string): ReplaySafetyReport {
  const stripped = stripNoise(sqlText)
  const statements = splitStatements(stripped)
  const droppedTriggers = new Set<string>()
  const droppedConstraints = new Set<string>()
  const mutating: ReplayStatementFinding[] = []
  const erroring: ReplayStatementFinding[] = []
  const vouched: ReplayStatementFinding[] = []

  // Resolve the annotations first, so the statement loop only has to ask
  // "is this one vouched for?" — and so an annotation that vouches for nothing
  // is a finding in its own right rather than a comment nobody reads.
  const vouchedByIndex = new Map<number, string>()
  for (const ann of parseReplayAnnotations(sqlText)) {
    const excerpt = ann.raw.slice(0, 120)
    if (ann.rationale === null) {
      mutating.push({
        line: ann.line,
        excerpt,
        reason:
          'malformed @replay annotation; the only accepted form is ' +
          '`-- @replay: guarded-by <what the guard tests>`',
      })
      continue
    }
    const target = statementBelow(statements, ann.line)
    if (target === -1) {
      mutating.push({
        line: ann.line,
        excerpt,
        reason:
          '@replay annotation vouches for no statement; it must sit in the comment block ' +
          'directly above the statement it covers',
      })
      continue
    }
    const flat = statements[target]!.text.replace(/\s+/g, ' ').trim()
    if (!VOUCHABLE_SHAPE.test(flat)) {
      mutating.push({
        line: ann.line,
        excerpt,
        reason:
          '@replay annotation is attached to a statement this scanner can read for itself ' +
          `(\`${flat.slice(0, 60)}\`); it may only vouch for a DO block, whose body is opaque here`,
      })
      continue
    }
    vouchedByIndex.set(target, ann.rationale)
  }

  for (const [index, stmt] of statements.entries()) {
    const flat = stmt.text.replace(/\s+/g, ' ').trim()

    const rationale = vouchedByIndex.get(index)
    if (rationale !== undefined) {
      vouched.push({ line: stmt.line, excerpt: flat.slice(0, 120), reason: rationale })
      continue
    }

    const dropTrigger = /^DROP\s+TRIGGER\s+IF\s+EXISTS\s+("?[\w.]+"?)/i.exec(flat)
    if (dropTrigger) droppedTriggers.add(normaliseIdent(dropTrigger[1]!))

    // Same idiom as the trigger pair below, for constraints: Postgres has no
    // ADD CONSTRAINT IF NOT EXISTS, so the house pattern is a preceding
    // `DROP CONSTRAINT IF EXISTS` of the same name in the same file, which
    // makes the two together a total overwrite. Recorded before the shape
    // checks because the drop is itself safe and would `continue` past this.
    const dropConstraint =
      /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s,;]+\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+("?[\w.]+"?)/i.exec(
        flat
      )
    if (dropConstraint) droppedConstraints.add(normaliseIdent(dropConstraint[1]!))

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

    // The constraint half of the same rule. Only pairs: an ADD whose name was
    // not dropped above it still errors on a second run, and says so.
    const addConstraint =
      /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s,;]+\s+ADD\s+CONSTRAINT\s+("?[\w.]+"?)/i.exec(flat)
    if (addConstraint && droppedConstraints.has(normaliseIdent(addConstraint[1]!))) continue

    erroring.push({
      line: stmt.line,
      excerpt: flat.slice(0, 120),
      reason: 'no recognised replay-safe shape; expected to error on a second run',
    })
  }

  const shapeVerdict: ReplayVerdict =
    mutating.length > 0 ? 'mutates' : erroring.length > 0 ? 'errors' : 'safe'

  // The worse of the two, never the override alone. Taking the maximum is what
  // makes "an override can only be more conservative" a property of the code
  // rather than a rule about how the list is written: an `errors` entry cannot
  // talk a `mutates` file down, and the type has already ruled out `safe`.
  const override = replayOverrideFor(tag)
  const verdict =
    override && SEVERITY[override.verdict] > SEVERITY[shapeVerdict]
      ? override.verdict
      : shapeVerdict

  // The reason travels with the verdict, in the list every caller already reads,
  // so a refusal names *why* without any of them learning about overrides. The
  // migrator's refusal text prints `mutating[0].reason` verbatim.
  if (override && verdict !== shapeVerdict) {
    const finding: ReplayStatementFinding = {
      line: 0,
      excerpt: `reviewed replay override for ${normaliseTag(tag)}`,
      reason: override.why,
    }
    if (verdict === 'mutates') mutating.push(finding)
    else erroring.push(finding)
  }

  return {
    tag,
    verdict,
    shapeVerdict,
    override,
    mutating,
    erroring,
    vouched,
    statementCount: statements.length,
  }
}

function normaliseIdent(raw: string): string {
  return raw.replace(/"/g, '').toLowerCase()
}
