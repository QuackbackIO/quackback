/**
 * Storage, end to end, on a pooled fleet — and the cross-workspace negative.
 *
 *   bun run apps/web/scripts/storage-e2e.ts <hostnameA> <hostnameB> [--http <origin>]
 *
 * Runs inside real workspace scopes, opened the way a request opens them:
 * `acquireScopeForHost` → registry → pool → fingerprint → canary → secrets. So
 * every step below exercises the resolved per-workspace credential rather than a
 * fixture.
 *
 * Per workspace: upload → read the bytes back → mint a presigned GET and fetch it
 * over the network. Then the two negatives that matter, in both directions:
 * workspace A must not be able to read B's object, and B's `/api/storage` route
 * must refuse a read capability minted by A.
 *
 * The negatives are only meaningful alongside the positives, so both are always
 * reported. "Could not read the other workspace's object" from a fleet where
 * nothing can read anything is not an isolation result.
 */
import { randomUUID } from 'node:crypto'
import { acquireScopeForHost } from '@/lib/server/workspaces/resolver'
import { runWithWorkspaceScope } from '@/lib/server/workspaces/workspace-context'
import {
  generatePresignedGetUrl,
  getPublicUrlOrNull,
  getS3Object,
  isS3Usable,
  uploadObject,
} from '@/lib/server/storage/s3'

const args = process.argv.slice(2)
const httpIdx = args.indexOf('--http')
const httpOrigin = httpIdx >= 0 ? (args[httpIdx + 1] ?? null) : null
const hostnames = args.filter((a, i) => !a.startsWith('--') && !(httpIdx >= 0 && i === httpIdx + 1))

if (hostnames.length !== 2) {
  console.error('usage: storage-e2e.ts <hostnameA> <hostnameB> [--http http://localhost:3210]')
  process.exit(2)
}

/** `uploads/` is not a public prefix, so the read capability is required. */
const KEY = `uploads/e2e/${randomUUID()}.txt`

let failed = false
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed = true
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function inWorkspace<T>(hostname: string, fn: () => Promise<T>): Promise<T> {
  const acquired = await acquireScopeForHost(hostname, 'script')
  if (acquired.kind !== 'ok') {
    throw new Error(`${hostname} did not resolve: ${acquired.kind}`)
  }
  return runWithWorkspaceScope(acquired.scope, fn)
}

const bodies = new Map<string, string>()
const readUrls = new Map<string, string>()

for (const hostname of hostnames) {
  const body = `e2e for ${hostname} ${randomUUID()}`
  bodies.set(hostname, body)
  console.log(`\n${hostname}`)

  await inWorkspace(hostname, async () => {
    check('storage reports usable', isS3Usable())

    // ── upload ────────────────────────────────────────────────────────────
    const publicUrl = await uploadObject(KEY, Buffer.from(body, 'utf8'), 'text/plain')
    check('upload', typeof publicUrl === 'string' && publicUrl.includes(KEY))
    readUrls.set(hostname, publicUrl)

    // ── read back ─────────────────────────────────────────────────────────
    const got = await getS3Object(KEY)
    const read = await new Response(got.body).text()
    check(
      'read back byte-identical',
      read === body,
      read === body ? '' : `got ${JSON.stringify(read)}`
    )

    // ── presigned GET, fetched over the network ───────────────────────────
    const presigned = await generatePresignedGetUrl(KEY, 300)
    const res = await fetch(presigned)
    const viaPresigned = await res.text()
    check(
      'presigned GET returns the same bytes',
      res.ok && viaPresigned === body,
      `HTTP ${res.status}`
    )

    // The URL the app hands to a browser, capability and all.
    const urlForBrowser = getPublicUrlOrNull(KEY)
    check('private asset URL carries a read capability', !!urlForBrowser?.includes('?read='))
  })
}

// ── the negative: the SAME key in two buckets ───────────────────────────────
//
// Deliberately one key string across both workspaces. A per-workspace key would be
// refused by arithmetic rather than by isolation and would prove nothing; the
// bucket is the boundary, so the key has to be held constant to test it.
console.log('\ncross-workspace reads (same key, two buckets)')
for (const hostname of hostnames) {
  const other = hostnames.find((h) => h !== hostname)!
  await inWorkspace(hostname, async () => {
    const got = await getS3Object(KEY)
    const read = await new Response(got.body).text()
    check(
      `${hostname} reads its OWN object, not ${other}'s`,
      read === bodies.get(hostname),
      read === bodies.get(other) ? 'IT READ THE OTHER WORKSPACE’S BYTES' : ''
    )
  })
}

// ── the sharper negative: a key that exists in ONE bucket only ─────────────
//
// The same-key check above catches a shared S3 client, because the second
// workspace would read the first workspace's bytes. This one states the property
// directly: an object that exists only in A's bucket must be absent from B's.
const EXCLUSIVE = `uploads/e2e/exclusive-${randomUUID()}.txt`
console.log('\nexclusive-key reads')
await inWorkspace(hostnames[0]!, async () => {
  await uploadObject(EXCLUSIVE, Buffer.from('only in the first workspace', 'utf8'), 'text/plain')
  const read = await new Response((await getS3Object(EXCLUSIVE)).body).text()
  check(`${hostnames[0]} can read the object it just wrote`, read === 'only in the first workspace')
})
await inWorkspace(hostnames[1]!, async () => {
  let outcome = 'READ IT'
  try {
    await new Response((await getS3Object(EXCLUSIVE)).body).text()
  } catch (err) {
    outcome = (err as Error).name || 'error'
  }
  check(`${hostnames[1]} cannot read it`, outcome !== 'READ IT', outcome)
})

// ── the negative over HTTP: a capability minted for one host on the other ───
if (httpOrigin) {
  console.log(`\n/api/storage over HTTP at ${httpOrigin}`)
  for (const hostname of hostnames) {
    const other = hostnames.find((h) => h !== hostname)!
    const url = new URL(readUrls.get(hostname)!)
    const path = url.pathname + url.search

    const own = await fetch(`${httpOrigin}${path}`, {
      headers: { host: hostname },
      redirect: 'manual',
    })
    check(`${hostname} accepts its own capability`, own.status !== 403, `HTTP ${own.status}`)

    const cross = await fetch(`${httpOrigin}${path}`, {
      headers: { host: other },
      redirect: 'manual',
    })
    check(
      `${other} REFUSES a capability minted for ${hostname}`,
      cross.status === 403,
      `HTTP ${cross.status}`
    )
  }
}

console.log(failed ? '\nFAILED' : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
