#!/usr/bin/env bun
/**
 * List published `ghcr.io/quackbackio/quackback` versions (GitHub Packages API).
 *
 * Tags are the operator-facing names (`saas`, `0.13.2`, `sha-abc1234`).
 * The digest is what `.railway/railway.ts` pins as APP_IMAGE.
 *
 *   bun .railway/list-ghcr.ts
 *   bun .railway/list-ghcr.ts --limit 20
 *   bun .railway/list-ghcr.ts --tag saas
 */

const PACKAGE = 'quackback'
const ORG = 'QuackbackIO'
const IMAGE = `ghcr.io/${ORG.toLowerCase()}/${PACKAGE}`

function parseArgs(argv: string[]) {
  let limit = 30
  let tag: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!
    if (t === '--limit') limit = Number(argv[++i])
    else if (t === '--tag') tag = argv[++i]
    else if (t === '-h' || t === '--help') {
      console.log(`Usage: bun .railway/list-ghcr.ts [--limit N] [--tag NAME]`)
      process.exit(0)
    }
  }
  return { limit, tag }
}

type Version = {
  id: number
  name: string
  updated_at: string
  metadata?: { container?: { tags?: string[] } }
}

async function loadVersions(): Promise<Version[]> {
  const proc = Bun.spawn(
    ['gh', 'api', '--paginate', `/orgs/${ORG}/packages/container/${PACKAGE}/versions?per_page=100`],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exit !== 0) {
    console.error(stderr.trim() || `gh api exited ${exit}`)
    process.exit(1)
  }
  // `gh --paginate` concatenates JSON arrays as `][`.
  const parsed = JSON.parse(stdout.replace(/\]\s*\[/g, ',')) as Version[]
  return Array.isArray(parsed) ? parsed : []
}

function realTags(v: Version): string[] {
  return (v.metadata?.container?.tags ?? []).filter((t) => !t.endsWith('.sig'))
}

const { limit, tag } = parseArgs(process.argv.slice(2))
const versions = await loadVersions()
const rows = versions
  .map((v) => ({ digest: v.name, updated: v.updated_at, tags: realTags(v) }))
  .filter((r) => r.tags.length > 0)
  .filter((r) => (tag ? r.tags.includes(tag) : true))
  .slice(0, limit)

if (rows.length === 0) {
  console.error(tag ? `no version tagged ${tag}` : 'no tagged versions')
  process.exit(1)
}

const tagW = Math.max(8, ...rows.map((r) => r.tags.join(', ').length))
console.log(`${'UPDATED'.padEnd(20)}  ${'TAGS'.padEnd(tagW)}  IMAGE`)
for (const r of rows) {
  const tags = r.tags.join(', ')
  console.log(
    `${r.updated.slice(0, 19).replace('T', ' ')}Z  ${tags.padEnd(tagW)}  ${IMAGE}@${r.digest}`
  )
}
