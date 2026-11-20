/**
 * Call the app's server functions from a test, the way the browser does, as a
 * signed-in person. For journeys whose observable outcome is the server
 * function's answer (a refusal code, an unchanged row), not a screen.
 *
 *   const api = await personApi(playwright, 'scoped')
 *   const res = await callServerFn(api, 'getConversationFn', { id })
 *   expect(res.ok).toBe(false)
 *   expect(res.code).toBe('CONVERSATION_NOT_FOUND')
 *
 * The production build names each server function by a hash, so the id is
 * looked up in the build's own resolver manifest by function name (and, when
 * two files share a name, by the source file's base name).
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'
import { supportEnv } from './env'
import { personStatePath, type SupportPersonName } from './people'

const appDir = resolve(import.meta.dirname, '../..')

interface ManifestEntry {
  id: string
  functionName: string
  chunk: string
}

let manifest: ManifestEntry[] | null = null

function loadManifest(): ManifestEntry[] {
  if (manifest) return manifest
  const serverDir = resolve(appDir, '.output/server')
  const file = readdirSync(serverDir).find((f) =>
    f.startsWith('__23tanstack-start-server-fn-resolver-')
  )
  if (!file) throw new Error(`No server function manifest in ${serverDir}; build the app first`)
  const text = readFileSync(resolve(serverDir, file), 'utf8')
  const re =
    /"([0-9a-f_]+)": \{\s*functionName: "([^"]+)",\s*importer: \(\) => import\("\.\/_ssr\/([^"]+)"\)/g
  manifest = [...text.matchAll(re)].map((m) => ({ id: m[1], functionName: m[2], chunk: m[3] }))
  if (manifest.length === 0) throw new Error(`Could not parse the server function manifest ${file}`)
  return manifest
}

/** The build's id for a server function, e.g. serverFnId('getConversationFn'). */
export function serverFnId(name: string, sourceFile?: string): string {
  const matches = loadManifest().filter((e) => e.functionName === `${name}_createServerFn_handler`)
  const picked = sourceFile ? matches.filter((e) => e.chunk.startsWith(`${sourceFile}-`)) : matches
  if (picked.length !== 1) {
    throw new Error(
      `Server function ${name}${sourceFile ? ` in ${sourceFile}` : ''}: ${picked.length} matches (${matches
        .map((m) => m.chunk)
        .join(', ')})`
    )
  }
  return picked[0].id
}

// seroval (the wire format) is a dependency of TanStack Start, not of the app;
// reach it through @tanstack/react-start so the versions always match.
type Seroval = {
  toJSONAsync: (v: unknown, o?: unknown) => Promise<unknown>
  fromCrossJSON: (v: unknown, o: unknown) => unknown
}
let seroval: Promise<{ lib: Seroval; plugins: unknown[] }> | null = null

/** The real directory of `name` as Node would find it from `fromDir`. */
function packageDir(fromDir: string, name: string): string {
  let dir = fromDir
  for (;;) {
    const candidate = resolve(dir, 'node_modules', name)
    if (existsSync(resolve(candidate, 'package.json'))) return realpathSync(candidate)
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`Cannot find ${name} from ${fromDir}`)
    dir = parent
  }
}

/** The ESM entry file of a package directory. */
function esmEntry(dir: string): string {
  const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
    exports?: unknown
    module?: string
    main?: string
  }
  const pick = (node: unknown): string | undefined => {
    if (typeof node === 'string') return node
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>
      return pick(o['.']) ?? pick(o.import) ?? pick(o.default) ?? pick(o.node)
    }
    return undefined
  }
  const entry = pick(pkg.exports) ?? pkg.module ?? pkg.main
  if (!entry) throw new Error(`No ESM entry in ${dir}`)
  return resolve(dir, entry)
}

function loadSeroval() {
  seroval ??= (async () => {
    const startDir = packageDir(appDir, '@tanstack/react-start')
    const clientCoreDir = packageDir(startDir, '@tanstack/start-client-core')
    const serovalDir = packageDir(clientCoreDir, 'seroval')
    const routerCoreDir = packageDir(clientCoreDir, '@tanstack/router-core')
    const lib = (await import(pathToFileURL(esmEntry(serovalDir)).href)) as Seroval
    // The router's default plugins; the app's typed-error adapter is left out,
    // so a typed error is read from the raw text (it carries code and message).
    const ssrClient = (await import(
      pathToFileURL(resolve(routerCoreDir, 'dist/esm/ssr/client.js')).href
    )) as { createDefaultSerovalPlugins: () => unknown[] }
    return { lib, plugins: ssrClient.createDefaultSerovalPlugins() }
  })()
  return seroval
}

export interface ServerFnResult<T = unknown> {
  status: number
  /** True when the function returned (no throw). */
  ok: boolean
  /** The returned value, when ok. */
  data: T
  /** A typed error's code (e.g. CONVERSATION_NOT_FOUND), '' when ok or untyped. */
  code: string
  /** The raw answer when the call threw ('' when ok): carries the message. */
  error: string
  raw: string
}

/** Call a server function by name as whoever `api` is signed in as. */
export async function callServerFn<T = unknown>(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { sourceFile?: string; method?: 'POST' | 'GET' } = {}
): Promise<ServerFnResult<T>> {
  const { lib, plugins } = await loadSeroval()
  const id = serverFnId(name, opts.sourceFile)
  const payload = JSON.stringify(await lib.toJSONAsync({ data }, { plugins }))
  const baseUrl = supportEnv().baseUrl
  const headers = {
    'x-tsr-serverFn': 'true',
    accept: 'application/json',
    origin: baseUrl,
    referer: `${baseUrl}/admin`,
  }
  const res =
    opts.method === 'GET'
      ? await api.get(`/_serverFn/${id}?payload=${encodeURIComponent(payload)}`, { headers })
      : await api.post(`/_serverFn/${id}`, {
          headers: { ...headers, 'content-type': 'application/json' },
          data: payload,
        })
  const raw = await res.text()
  let json: unknown = undefined
  try {
    json = JSON.parse(raw)
  } catch {
    json = undefined
  }
  // The envelope is { result, error, context }. A typed error (the app's own
  // adapter, not loaded here) cannot be decoded, so look at the wire node.
  const errorNode = envelopeField(json, 'error')
  const thrown = res.status() >= 400 || (errorNode !== undefined && !isUndefinedNode(errorNode))
  let result: unknown = undefined
  if (!thrown) {
    try {
      const decoded = lib.fromCrossJSON(json, { refs: new Map(), plugins }) as { result?: unknown }
      result = decoded?.result
    } catch (err) {
      throw new Error(`Could not decode ${name}'s answer: ${String(err)}\n${raw.slice(0, 500)}`)
    }
  }
  return {
    status: res.status(),
    ok: !thrown,
    data: result as T,
    code: thrown ? (findStringField(errorNode ?? json, 'code') ?? '') : '',
    error: thrown ? raw : '',
    raw,
  }
}

type WireNode = {
  t?: number
  s?: unknown
  p?: { k: string[]; v: WireNode[] }
  [k: string]: unknown
}

function envelopeField(root: unknown, key: string): WireNode | undefined {
  const node = root as WireNode | undefined
  if (!node?.p?.k) return undefined
  const i = node.p.k.indexOf(key)
  return i === -1 ? undefined : node.p.v[i]
}

function isUndefinedNode(node: WireNode): boolean {
  // seroval writes `undefined` as a constant node { t: 2, s: 1 }.
  return node.t === 2 && node.s === 1
}

/** The first string value under a property `key` anywhere in a wire node. */
function findStringField(node: unknown, key: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const n = node as WireNode
  if (n.p?.k) {
    const i = n.p.k.indexOf(key)
    const v = i === -1 ? undefined : n.p.v[i]
    if (v && v.t === 1 && typeof v.s === 'string') return v.s
  }
  for (const value of Object.values(n)) {
    const found = Array.isArray(value)
      ? value.map((x) => findStringField(x, key)).find(Boolean)
      : findStringField(value, key)
    if (found) return found
  }
  return undefined
}

/** A request context signed in as a support person. Dispose it when done. */
export async function personApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  person: SupportPersonName
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: supportEnv().baseUrl,
    storageState: personStatePath(person),
  })
}
