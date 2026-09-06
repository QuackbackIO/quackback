// Vendored into CP and the app. Cloud startup settings use environment variable names.
export type PlatformSettings = Record<string, string | number | boolean | null>
// These establish the bootstrap connection or process/runtime identity itself.
export const BOOTSTRAP_SETTINGS = new Set([
  'QUACKBACK_TENANCY',
  'QUACKBACK_ROLE',
  'QUACKBACK_CONTROL_PLANE_URL',
  'QUACKBACK_CP_SETTINGS_TOKEN',
  'QUACKBACK_FLEET_ROOT_KEY',
  'QUACKBACK_CONTROL_DATABASE_URL',
  'DATABASE_URL',
  'REDIS_URL',
  'INTEGRATION_CREDENTIALS_ENCRYPTION_KEY',
  'PLATFORM_SETTINGS_ENCRYPTION_KEY',
  'NODE_ENV',
  'NODE_OPTIONS',
  'BUN_OPTIONS',
  'BUN_ENV',
  'QUACKBACK_BUILD',
  'PATH',
  'HOME',
  'SHELL',
  'ENV',
  'BASH_ENV',
  'BUN_INSTALL',
  'BUN_INSTALL_CACHE_DIR',
])
export function validatePlatformSettings(input: unknown): PlatformSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Settings must be a JSON object')
  if (Object.keys(input).length > 512) throw new Error('Too many settings')
  const out: PlatformSettings = {}
  for (const [key, value] of Object.entries(input)) {
    if (
      !/^[A-Z][A-Z0-9_]{0,127}$/.test(key) ||
      BOOTSTRAP_SETTINGS.has(key) ||
      /^(LD_|DYLD_)/.test(key)
    )
      throw new Error('Invalid or bootstrap-only setting: ' + key.slice(0, 128))
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      (typeof value !== 'number' || !Number.isFinite(value))
    )
      throw new Error('Settings values must be strings, numbers, booleans or null')
    if (typeof value === 'string' && (value.length > 32768 || value.includes('\0')))
      throw new Error('Invalid setting value')
    out[key] = value
  }
  if (new TextEncoder().encode(JSON.stringify(out)).byteLength > 524288)
    throw new Error('Settings object is too large')
  return out
}
export function overlayPlatformSettings(
  base: Record<string, string | undefined>,
  input: unknown
): Record<string, string | undefined> {
  const settings = validatePlatformSettings(input)
  const result = { ...base }
  for (const [key, value] of Object.entries(settings)) {
    if (value === null) delete result[key]
    else result[key] = String(value)
  }
  return result
}
export function integrationEnvironmentKey(provider: string, field: string): string {
  return (
    'INTEGRATION_' +
    provider.toUpperCase().replaceAll('-', '_') +
    '_' +
    field.replace(/([A-Z])/g, '_$1').toUpperCase()
  )
}
