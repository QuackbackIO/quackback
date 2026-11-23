/**
 * One-off capture of the measured sites for the offline static-reader tests.
 * The only place the network is used: it records what the static reader
 * fetches (robots.txt, the homepage, its stylesheets, manifest and images)
 * into <dir>/<host>/ through the live, SSRF-guarded fetcher. The captures
 * stay outside the repository (see live-captures-dir.ts); tests replay them
 * and never touch the network.
 *
 * To keep the record small, script bodies (other than JSON-LD, which names
 * logos) are emptied from the page, and the share image, which Import never
 * uses, is dropped. Neither changes what the reader reads.
 *
 *   cd apps/web && bun src/lib/server/domains/brand-import/__tests__/capture-live-sites.ts
 */
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { liveSiteFetcher, readSite } from '../site/site-read'
import { recordingFetcher, type SnapshotManifest } from '../site/site-snapshot'
import { LIVE_SITES, liveCapturesDir } from './live-captures-dir'

const SCRIPT = /<script\b(?![^>]*application\/ld\+json)([^>]*)>[\s\S]*?<\/script\s*>/gi

const root = liveCapturesDir()
await mkdir(root, { recursive: true })
for (const host of LIVE_SITES) {
  const dir = join(root, host)
  await rm(dir, { recursive: true, force: true })
  const fetcher = recordingFetcher(liveSiteFetcher, dir)
  await fetcher(`https://${host}/robots.txt`, 'robots', { maxBytes: 64 * 1024, timeoutMs: 5_000 })
  const site = await readSite(`https://${host}/`, fetcher)

  const manifestPath = join(dir, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as SnapshotManifest
  for (const [url, entry] of Object.entries(manifest)) {
    if ('missing' in entry) continue
    const file = join(dir, entry.file)
    if (url === site.facts?.shareImage) {
      await unlink(file)
      manifest[url] = { missing: true }
    } else if (entry.contentType.includes('text/html')) {
      await writeFile(file, (await readFile(file, 'utf8')).replace(SCRIPT, '<script$1></script>'))
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(
    join(dir, 'captured.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), failed: site.failed }, null, 2)}\n`
  )
  process.stdout.write(`${host} ${site.failed ?? 'read'} ${dir}\n`)
}
