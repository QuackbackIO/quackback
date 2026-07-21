/**
 * CLI: idempotently provision the board-access-matrix e2e fixtures.
 *
 * Creates dedicated `e2e-*` boards (so we never disturb the seed/demo boards),
 * a manual segment, and adds the given portal user to that segment. Prints a
 * JSON blob of the resulting ids/slugs for the test to consume.
 *
 * Usage: bun setup-access-fixtures.ts <segment-member-email>
 *
 * Boards created (slug -> access tiers):
 *   e2e-public     view:anonymous   vote/comment/submit:authenticated  (modern "Public" preset)
 *   e2e-allanon    all:anonymous                                       (pure anonymous)
 *   e2e-segview    all:segments[A]                                     (single-segment board)
 *   e2e-mixedseg   view/vote/comment:segments[A]  submit:team          (per-action independence)
 *   e2e-private    all:team                                            (team-only / hidden)
 *   e2e-mod        all:anonymous + moderation anon/signed posts + comments:on (held-for-review board)
 */
import postgres from 'postgres'
import { randomUUID } from 'crypto'
import { generateId, toUuid, fromUuid } from '@quackback/ids'

const memberEmail = process.argv[2]
if (!memberEmail) {
  console.error('Usage: bun setup-access-fixtures.ts <segment-member-email>')
  process.exit(1)
}
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}
const sql = postgres(connectionString)

const SEG_SLUG = 'e2e-access-a'

function access(
  view: string,
  vote: string,
  comment: string,
  submit: string,
  segIds: string[],
  moderation?: Record<string, string>
) {
  return {
    view,
    vote,
    comment,
    submit,
    segments: {
      view: view === 'segments' ? segIds : [],
      vote: vote === 'segments' ? segIds : [],
      comment: comment === 'segments' ? segIds : [],
      submit: submit === 'segments' ? segIds : [],
    },
    moderation: {
      anonPosts: 'inherit',
      signedPosts: 'inherit',
      comments: 'inherit',
      ...(moderation ?? {}),
    },
  }
}

// Returns both the DB uuid (for join inserts) and the typeid string
// ("segment_…") that the app stores in boards.access.segments and resolves
// actor.segmentIds to — they MUST match for the segment gate to fire.
async function ensureSegment(): Promise<{ uuid: string; typeId: string }> {
  const existing =
    await sql`SELECT id FROM segments WHERE slug = ${SEG_SLUG} AND deleted_at IS NULL LIMIT 1`
  if (existing.length > 0) {
    const uuid = existing[0].id as string
    return { uuid, typeId: fromUuid('segment', uuid) }
  }
  const typeId = generateId('segment')
  const uuid = toUuid(typeId)
  await sql`INSERT INTO segments (id, name, slug, type, color, created_at, updated_at)
            VALUES (${uuid}, ${'E2E Access Segment A'}, ${SEG_SLUG}, 'manual', '#6366f1', NOW(), NOW())`
  return { uuid, typeId }
}

async function principalIdForEmail(email: string): Promise<string> {
  const rows = await sql`
    SELECT p.id FROM principal p
    JOIN "user" u ON p.user_id = u.id
    WHERE u.email = ${email}
    ORDER BY p.created_at ASC
    LIMIT 1`
  if (rows.length === 0)
    throw new Error(`No principal for email ${email} (sign the user in once first)`)
  return rows[0].id as string
}

/**
 * Make the segment's membership exactly {principalId}. The matrix tests
 * assert both sides (member sees, non-member doesn't), so stray members —
 * e.g. left behind by manual testing against the same dev DB — would turn
 * a correct deny into a false "leak" failure.
 */
async function setSegmentMembership(principalId: string, segmentId: string): Promise<void> {
  await sql`
    DELETE FROM user_segments
    WHERE segment_id = ${segmentId} AND principal_id != ${principalId}`
  await sql`
    INSERT INTO user_segments (principal_id, segment_id, added_by, added_at)
    VALUES (${principalId}, ${segmentId}, 'manual', NOW())
    ON CONFLICT (principal_id, segment_id) DO NOTHING`
}

async function upsertBoard(slug: string, name: string, acc: object): Promise<string> {
  const existing = await sql`SELECT id FROM boards WHERE slug = ${slug} LIMIT 1`
  // sql.json() sends a real jsonb object (not a JSON-string scalar) so the app
  // reads board.access as an object, matching app-written rows.
  if (existing.length > 0) {
    await sql`UPDATE boards SET access = ${sql.json(acc)}, deleted_at = NULL, updated_at = NOW() WHERE slug = ${slug}`
    return existing[0].id as string
  }
  const id = randomUUID()
  await sql`INSERT INTO boards (id, slug, name, access, settings, created_at, updated_at)
            VALUES (${id}, ${slug}, ${name}, ${sql.json(acc)}, ${sql.json({})}, NOW(), NOW())`
  return id
}

async function anyStatusId(): Promise<string | null> {
  const r = await sql`SELECT id FROM post_statuses ORDER BY position ASC NULLS LAST LIMIT 1`
  return r.length > 0 ? (r[0].id as string) : null
}

const POST_TITLE = 'E2E access probe post'

/**
 * Idempotently ensure one published post exists on the board; return the
 * post's TYPEID (post_…) for the /b/<slug>/posts/<id> route (the DB column
 * stores the decoded UUID).
 */
async function ensurePost(
  boardId: string,
  principalId: string,
  statusId: string | null
): Promise<string> {
  const existing = await sql`
    SELECT id FROM posts WHERE board_id = ${boardId} AND title = ${POST_TITLE} AND deleted_at IS NULL LIMIT 1`
  if (existing.length > 0) return fromUuid('post', existing[0].id as string)
  const typeId = generateId('post')
  const uuid = toUuid(typeId)
  await sql`
    INSERT INTO posts (id, board_id, title, content, status_id, principal_id, vote_count, comment_count, moderation_state, created_at, updated_at)
    VALUES (${uuid}, ${boardId}, ${POST_TITLE}, ${'Seeded by the access-matrix e2e fixtures.'}, ${statusId}, ${principalId}, 0, 0, 'published', NOW(), NOW())`
  return typeId
}

try {
  const segment = await ensureSegment()
  const principalId = await principalIdForEmail(memberEmail)
  await setSegmentMembership(principalId, segment.uuid)
  const segIds = [segment.typeId]

  const statusId = await anyStatusId()
  const defs: Array<[string, string, object]> = [
    [
      'e2e-public',
      'E2E Public',
      access('anonymous', 'authenticated', 'authenticated', 'authenticated', []),
    ],
    [
      'e2e-allanon',
      'E2E All Anonymous',
      access('anonymous', 'anonymous', 'anonymous', 'anonymous', []),
    ],
    [
      'e2e-segview',
      'E2E Segment View',
      access('segments', 'segments', 'segments', 'segments', segIds),
    ],
    [
      'e2e-mixedseg',
      'E2E Mixed Segment',
      access('segments', 'segments', 'segments', 'team', segIds),
    ],
    ['e2e-private', 'E2E Private', access('team', 'team', 'team', 'team', [])],
    [
      'e2e-mod',
      'E2E Moderated',
      access('anonymous', 'anonymous', 'anonymous', 'anonymous', [], {
        anonPosts: 'on',
        signedPosts: 'on',
        comments: 'on',
      }),
    ],
  ]
  const boards: Record<string, { slug: string; postId: string }> = {}
  const keys = ['public', 'allanon', 'segview', 'mixedseg', 'private', 'mod']
  for (let i = 0; i < defs.length; i++) {
    const [slug, name, acc] = defs[i]
    const boardId = await upsertBoard(slug, name, acc)
    const postId = await ensurePost(boardId, principalId, statusId)
    boards[keys[i]] = { slug, postId }
  }

  console.log(JSON.stringify({ segmentId: segment.typeId, memberPrincipalId: principalId, boards }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
