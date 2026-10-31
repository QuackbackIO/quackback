/** One leaf a draft changes, by its dotted path. Lists count as one leaf. */
export interface DesignChange {
  path: string
  before: unknown
  after: unknown
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Every leaf that differs between two designs, in document order. */
export function designChanges(before: unknown, after: unknown, path = ''): DesignChange[] {
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    return keys.flatMap((key) =>
      designChanges(before[key], after[key], path ? `${path}.${key}` : key)
    )
  }
  if (isObject(before) || isObject(after)) {
    return designChanges(isObject(before) ? before : {}, isObject(after) ? after : {}, path)
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, before, after }]
}
