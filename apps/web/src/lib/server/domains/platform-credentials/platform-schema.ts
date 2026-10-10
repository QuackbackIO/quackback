/**
 * Derives `src/lib/shared/platform-schema.generated.json`: a machine-readable
 * description of the two families of configuration that reach a deployment as
 * environment variables rather than through the admin UI.
 *
 * 1. Integration platform credentials. Every integration declares the OAuth-app
 *    fields it needs in `platformCredentials`. When `PLATFORM_CREDENTIALS_SOURCE`
 *    is `env`, `EnvCredentialSource` reads those fields from
 *    `INTEGRATION_<TYPE>_<FIELD>` variables instead of the database, so whatever
 *    populates that environment needs the field list and the exact variable
 *    names, and needs them without importing this code. Required fields must
 *    all be present: `EnvCredentialSource` reports a provider as configured
 *    only when they are, so a partial population reads as unconfigured and
 *    the provider disappears from the catalog rather than half working.
 *    Optional fields (`required: false`) may be absent.
 * 2. AI configuration keys, taken from the explicit env mapping in
 *    `src/lib/server/config.ts`.
 *
 * This module owns the forward transform (field key to variable name); the
 * inverse is `fieldFromEnvKey` in `credential-source.ts` beside it. A generated
 * name the inverse does not decode back to the declared field key is invisible at
 * runtime: a wrongly named variable is still a perfectly valid variable, nothing
 * reads it, and the provider simply stays unconfigured with no error anywhere.
 * The round-trip test in `src/lib/shared/__tests__` exists to make that loud.
 *
 * Nothing in the running application imports this. It is read by
 * `scripts/generate-platform-schema.ts`, which writes the artifact, and by the
 * test that re-derives it and demands the committed copy still matches.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getIntegration, listIntegrationTypes } from '@/lib/server/integrations'
import type { PlatformCredentialField } from '@/lib/server/integrations/types'
import * as integrationCatalogs from '@/lib/shared/integration-catalog'

// =============================================================================
// Paths
// =============================================================================

/**
 * The first ancestor holding a `package.json`, which is the app root. Resolved by
 * joining strings onto `import.meta.dirname` rather than with
 * `new URL('...', import.meta.url)`, because the second form is the Vite
 * asset-reference pattern: it is rewritten at transform time and resolves against
 * the dev-server origin instead of the filesystem when the test suite imports
 * this module.
 */
function findAppDir(start: string): string {
  let dir = start
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`no package.json above ${start}`)
    dir = parent
  }
  return dir
}

const APP_DIR = findAppDir(import.meta.dirname)

const CONFIG_SOURCE_PATH = join(APP_DIR, 'src/lib/server/config.ts')

export const ARTIFACT_PATH = join(APP_DIR, 'src/lib/shared/platform-schema.generated.json')

// =============================================================================
// Emitted shape
// =============================================================================

/** How a value is entered and displayed. Drives input type and masking. */
export type AiKeyKind = 'secret' | 'url' | 'model' | 'tristate' | 'text'

/** Presentation grouping for the AI keys. */
export type AiKeyGroup = 'connection' | 'models' | 'advanced'

export interface AiKeySchema {
  /** Environment variable name, e.g. `OPENAI_API_KEY`. */
  key: string
  kind: AiKeyKind
  group: AiKeyGroup
  /** true when the value must never be displayed after it is set. */
  sensitive: boolean
}

export interface PlatformFieldSchema {
  /** Property key on the credentials object, e.g. `clientId`. */
  key: string
  /** Environment variable name the field is read from in env mode. */
  envKey: string
  label: string
  sensitive: boolean
  placeholder?: string
  helpText?: string
  helpUrl?: string
  /** false when the field may be omitted. Omitted means required. */
  required?: boolean
  /** true when the value is a URL the server will fetch (SSRF-checked at save). */
  url?: boolean
}

export interface PlatformProviderSchema {
  /** Registry id, e.g. `slack`, `azure_devops`. Also the OAuth callback segment. */
  id: string
  name: string
  category: string
  iconBg: string
  docsUrl?: string
  /** true when the provider declares at least one platform-credential field. */
  configurable: boolean
  /** `INTEGRATION_<TYPE>_`. Every `envKey` below starts with it. */
  envPrefix: string
  /** Declaration order is preserved: it is the order a setup form should use. */
  fields: PlatformFieldSchema[]
}

export interface PlatformSchema {
  /** Version of the app package this was generated from. */
  workspaceVersion: string
  ai: { keys: AiKeySchema[] }
  providers: PlatformProviderSchema[]
}

// =============================================================================
// Forward transform (inverse of credential-source.ts fieldFromEnvKey/envPrefix)
// =============================================================================

const ENV_PREFIX = 'INTEGRATION_'

/** 'azure_devops' -> 'INTEGRATION_AZURE_DEVOPS_'. Hyphens normalize to '_'. */
export function envPrefixFor(integrationType: string): string {
  return `${ENV_PREFIX}${integrationType.toUpperCase().replace(/-/g, '_')}_`
}

/** 'clientSecret' -> 'CLIENT_SECRET'. Digits stay attached to the run they follow. */
export function envSuffixFor(fieldKey: string): string {
  return fieldKey.replace(/([A-Z])/g, '_$1').toUpperCase()
}

/** 'slack' + 'clientSecret' -> 'INTEGRATION_SLACK_CLIENT_SECRET'. */
export function envKeyFor(integrationType: string, fieldKey: string): string {
  return `${envPrefixFor(integrationType)}${envSuffixFor(fieldKey)}`
}

// =============================================================================
// AI keys, read out of the config env mapping
// =============================================================================

/**
 * Every AI variable name is either `OPENAI_*` or `AI_*`. The derivation asserts
 * this in both directions so a key filed under the wrong comment section, or an
 * AI-shaped key added outside the AI section, fails rather than quietly dropping
 * out of the artifact.
 */
const AI_KEY_PATTERN = /^(?:AI|OPENAI)_/

/** Body of `function name(...) { ... }`, matched on the closing brace at column 0. */
function extractFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`config.ts: no function ${name}`)
  const end = source.indexOf('\n}', start)
  if (end === -1) throw new Error(`config.ts: unterminated function ${name}`)
  return source.slice(start, end)
}

/** The lines of a `// <heading>` comment block, up to the next comment or blank-line break. */
function extractCommentSection(body: string, heading: string): string[] {
  const lines = body.split('\n')
  const start = lines.findIndex((l) => l.trim() === `// ${heading}`)
  if (start === -1) throw new Error(`config.ts: no "// ${heading}" section`)
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('//') || line.trim() === '') break
    out.push(line)
  }
  if (out.length === 0) throw new Error(`config.ts: "// ${heading}" section is empty`)
  return out
}

/** camelCase property -> env var name, for one line of `buildConfigFromEnv`. */
function parseMappingLine(line: string): { prop: string; envKey: string } | null {
  const match = /^\s*([A-Za-z0-9]+):\s*(?:env\('([A-Z0-9_]+)'\)|process\.env\.([A-Z0-9_]+))/.exec(
    line
  )
  if (!match) return null
  return { prop: match[1], envKey: match[2] ?? match[3] }
}

/** camelCase property -> declared zod type expression, for one line of the schema object. */
function parseSchemaLine(line: string): { prop: string; type: string } | null {
  const match = /^\s*([A-Za-z0-9]+):\s*(.+?),?\s*$/.exec(line)
  if (!match) return null
  return { prop: match[1], type: match[2].replace(/,$/, '') }
}

function classify(envKey: string, zodType: string): { kind: AiKeyKind; group: AiKeyGroup } {
  // envBoolean accepts only true/false/1/0, and a rejected value fails the whole
  // config schema rather than just this key, so the value is a fixed set of
  // states to choose from and never free text.
  if (zodType === 'envBoolean') return { kind: 'tristate', group: 'advanced' }
  if (envKey.endsWith('_MODEL')) return { kind: 'model', group: 'models' }
  if (envKey.endsWith('_API_KEY')) return { kind: 'secret', group: 'connection' }
  if (envKey.endsWith('_URL')) return { kind: 'url', group: 'connection' }
  return { kind: 'text', group: 'connection' }
}

export function deriveAiKeys(configSource: string): AiKeySchema[] {
  const mappingBody = extractFunctionBody(configSource, 'buildConfigFromEnv')
  const mapping = extractCommentSection(mappingBody, 'AI')
    .map(parseMappingLine)
    .filter((e): e is { prop: string; envKey: string } => e !== null)
  if (mapping.length === 0) throw new Error('config.ts: the AI env mapping parsed to nothing')

  // Nothing AI-shaped may live outside the AI section, and nothing inside it may
  // be shaped otherwise. Either direction would silently shrink the artifact.
  for (const { envKey } of mapping) {
    if (!AI_KEY_PATTERN.test(envKey)) {
      throw new Error(`config.ts: ${envKey} is in the AI section but is not an AI_/OPENAI_ key`)
    }
  }
  const inAiSection = new Set(mapping.map((e) => e.envKey))
  for (const line of mappingBody.split('\n')) {
    const entry = parseMappingLine(line)
    if (entry && AI_KEY_PATTERN.test(entry.envKey) && !inAiSection.has(entry.envKey)) {
      throw new Error(`config.ts: ${entry.envKey} is an AI key outside the "// AI" section`)
    }
  }

  // The zod declaration supplies the type. The two blocks must list the same
  // properties in the same order, or one of them was edited alone.
  const schemaTypes = new Map(
    extractCommentSection(configSource, 'AI (optional)')
      .map(parseSchemaLine)
      .filter((e): e is { prop: string; type: string } => e !== null)
      .map((e) => [e.prop, e.type] as const)
  )
  const schemaProps = [...schemaTypes.keys()].join(',')
  const mappingProps = mapping.map((e) => e.prop).join(',')
  if (schemaProps !== mappingProps) {
    throw new Error(
      `config.ts: the AI schema block and the AI env mapping disagree (${schemaProps} vs ${mappingProps})`
    )
  }

  return mapping.map(({ prop, envKey }) => {
    const { kind, group } = classify(envKey, schemaTypes.get(prop) ?? '')
    return { key: envKey, kind, group, sensitive: kind === 'secret' }
  })
}

// =============================================================================
// Providers
// =============================================================================

/**
 * The client-safe barrel re-exports one catalog per integration. It is the module
 * a browser bundle reads, so a registry entry missing from it is a provider the
 * admin UI cannot describe. Checked here because this is the only place that
 * holds both lists at once.
 */
function assertCatalogBarrelCovers(ids: string[]): void {
  const exported = new Set(Object.values(integrationCatalogs).map((c) => c.id))
  const missing = ids.filter((id) => !exported.has(id))
  if (missing.length > 0) {
    throw new Error(`integration-catalog.ts does not re-export: ${missing.join(', ')}`)
  }
  const extra = [...exported].filter((id) => !ids.includes(id))
  if (extra.length > 0) {
    throw new Error(`integration-catalog.ts re-exports unregistered ids: ${extra.join(', ')}`)
  }
}

function toFieldSchema(id: string, field: PlatformCredentialField): PlatformFieldSchema {
  return {
    key: field.key,
    envKey: envKeyFor(id, field.key),
    label: field.label,
    sensitive: field.sensitive,
    ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    ...(field.helpText === undefined ? {} : { helpText: field.helpText }),
    ...(field.helpUrl === undefined ? {} : { helpUrl: field.helpUrl }),
    ...(field.required === false ? { required: false } : {}),
    ...(field.url ? { url: true } : {}),
  }
}

export function deriveProviders(): PlatformProviderSchema[] {
  const ids = listIntegrationTypes()
  assertCatalogBarrelCovers(ids)

  return [...ids].sort().map((id) => {
    const integration = getIntegration(id)
    if (!integration) throw new Error(`registry lists ${id} but getIntegration returns nothing`)
    const { catalog, platformCredentials } = integration
    return {
      id,
      name: catalog.name,
      category: catalog.category,
      iconBg: catalog.iconBg,
      ...(catalog.docsUrl === undefined ? {} : { docsUrl: catalog.docsUrl }),
      // The same rule getIntegrationCatalog applies: declaring no fields means
      // there is nothing to configure, whatever the catalog literal says.
      configurable: platformCredentials.length > 0,
      envPrefix: envPrefixFor(id),
      fields: platformCredentials.map((f) => toFieldSchema(id, f)),
    }
  })
}

// =============================================================================
// Assembly
// =============================================================================

export function derivePlatformSchema(): PlatformSchema {
  const pkg = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as { version: string }

  return {
    workspaceVersion: pkg.version,
    ai: { keys: deriveAiKeys(readFileSync(CONFIG_SOURCE_PATH, 'utf8')) },
    providers: deriveProviders(),
  }
}

/** Exactly the bytes the artifact holds, so key order and formatting are pinned too. */
export function serializePlatformSchema(schema: PlatformSchema): string {
  return `${JSON.stringify(schema, null, 2)}\n`
}
