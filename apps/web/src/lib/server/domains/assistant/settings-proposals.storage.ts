import type { SettingsChange } from '@/lib/shared/assistant/settings-proposals'
import type { SettingsRecord } from '@/lib/server/domains/settings/settings.helpers'

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
export const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]))
  if (object(a) && object(b))
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    )
  return false
}
export function at(value: unknown, path: string[]): unknown {
  for (const key of path) value = object(value) ? value[key] : undefined
  return value
}
export function put(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
  present = true
) {
  for (const key of path.slice(0, -1)) {
    if (!object(target[key])) target[key] = {}
    target = target[key] as Record<string, unknown>
  }
  if (present) target[path.at(-1)!] = value
  else delete target[path.at(-1)!]
}
export function leaves(
  value: Record<string, unknown>,
  path: string[] = []
): Array<{ path: string[]; value: unknown }> {
  return Object.entries(value).flatMap(([key, value]) =>
    object(value) ? leaves(value, [...path, key]) : [{ path: [...path, key], value }]
  )
}
export const JSON_COLUMNS = [
  'brandingConfig',
  'featureFlags',
  'widgetConfig',
  'portalConfig',
  'metadata',
] as const
export const SCALAR_COLUMNS = ['name', 'logoKey', 'faviconKey'] as const
export type SettingsStorageColumn = (typeof JSON_COLUMNS)[number] | (typeof SCALAR_COLUMNS)[number]
export interface SettingsStorageEffect {
  column: SettingsStorageColumn
  path: string[]
  before: unknown
  after: unknown
  beforePresent: boolean
  afterPresent: boolean
}
export interface SettingsApplyReceipt {
  kind: 'settings'
  version: 1
  changes: SettingsChange[]
  storageEffects: SettingsStorageEffect[]
  appliedAt: string
}
export function columnValue(row: SettingsRecord, column: SettingsStorageColumn): unknown {
  return (JSON_COLUMNS as readonly string[]).includes(column)
    ? row[column] === null
      ? null
      : JSON.parse(row[column] as string)
    : row[column]
}
export function settingsStorageEffects(
  before: SettingsRecord,
  after: SettingsRecord
): SettingsStorageEffect[] {
  const all: SettingsStorageEffect[] = []
  function diff(
    column: SettingsStorageColumn,
    a: unknown,
    b: unknown,
    path: string[] = [],
    beforePresent = true,
    afterPresent = true
  ) {
    if (equal(a, b) && beforePresent === afterPresent) return
    if (object(a) && object(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        diff(column, a[key], b[key], [...path, key], Object.hasOwn(a, key), Object.hasOwn(b, key))
    } else
      all.push({ column, path, before: a ?? null, after: b ?? null, beforePresent, afterPresent })
  }
  for (const column of [...JSON_COLUMNS, ...SCALAR_COLUMNS])
    diff(column, columnValue(before, column), columnValue(after, column))
  return all
}
