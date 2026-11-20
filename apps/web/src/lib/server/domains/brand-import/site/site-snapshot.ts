/**
 * Site reads kept on disk, so a bench can replay a site exactly as it was.
 *
 * `recordingFetcher` passes each request to a real fetcher and writes what
 * came back to `dir/files/<n>.<ext>`, indexed by request URL in
 * `dir/manifest.json`. `snapshotFetcher` answers from that record and never
 * touches the network. Server only (node:fs).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FetchedBody, SiteFetcher } from './types'

export type SnapshotEntry =
  { status: number; url: string; contentType: string; file: string } | { missing: true }
export type SnapshotManifest = Record<string, SnapshotEntry>

const EXTENSIONS: Array<[RegExp, string]> = [
  [/html/, 'html'],
  [/css/, 'css'],
  [/json/, 'json'],
  [/svg/, 'svg'],
  [/png/, 'png'],
  [/jpe?g/, 'jpg'],
  [/webp/, 'webp'],
  [/gif/, 'gif'],
  [/avif/, 'avif'],
  [/icon/, 'ico'],
]

function extensionOf(contentType: string): string {
  const type = contentType.toLowerCase()
  return EXTENSIONS.find(([pattern]) => pattern.test(type))?.[1] ?? 'bin'
}

async function loadManifest(dir: string): Promise<SnapshotManifest> {
  try {
    return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as SnapshotManifest
  } catch {
    return {}
  }
}

/** A fetcher that records every request `inner` answers into `dir`. */
export function recordingFetcher(inner: SiteFetcher, dir: string): SiteFetcher {
  let ready: Promise<{ manifest: SnapshotManifest; next: number }> | null = null
  // Writes run one at a time, so parallel fetches never interleave the manifest.
  let queue: Promise<unknown> = Promise.resolve()
  const state = () =>
    (ready ??= (async () => {
      await mkdir(join(dir, 'files'), { recursive: true })
      const manifest = await loadManifest(dir)
      return { manifest, next: Object.keys(manifest).length + 1 }
    })())

  return async (url, kind, limits) => {
    const res = await inner(url, kind, limits)
    const write = queue.then(async () => {
      const s = await state()
      if (!res) {
        s.manifest[url] = { missing: true }
      } else {
        const file = join('files', `${s.next++}.${extensionOf(res.contentType)}`)
        await writeFile(join(dir, file), res.body)
        s.manifest[url] = { status: res.status, url: res.url, contentType: res.contentType, file }
      }
      await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(s.manifest, null, 2)}\n`)
    })
    queue = write.catch(() => {})
    await write
    return res
  }
}

/**
 * A fetcher that replays `dir`. A URL with no record gives null, or with
 * `strict` throws an Error naming it, so a bench with a stale snapshot fails
 * loudly rather than reading less.
 */
export function snapshotFetcher(dir: string, opts: { strict?: boolean } = {}): SiteFetcher {
  let manifest: Promise<SnapshotManifest> | null = null
  return async (url, _kind, limits): Promise<FetchedBody | null> => {
    const entry = (await (manifest ??= loadManifest(dir)))[url]
    if (!entry) {
      if (opts.strict) throw new Error(`No snapshot of ${url} in ${dir}`)
      return null
    }
    if ('missing' in entry) return null
    const body = new Uint8Array(await readFile(join(dir, entry.file)))
    return {
      status: entry.status,
      url: entry.url,
      contentType: entry.contentType,
      body: body.byteLength > limits.maxBytes ? body.subarray(0, limits.maxBytes) : body,
    }
  }
}
