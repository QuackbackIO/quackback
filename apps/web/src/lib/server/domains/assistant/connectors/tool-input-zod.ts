/**
 * The model-facing zod schema for a supported connector input contract.
 *
 * Split from tool-input-schema.ts only for file size: this converts exactly
 * the subset that module enforces, so the model is never shown a looser
 * contract than the one checked before dispatch. Callers gate on
 * `analyzeToolInputSchema` first, so an unsupported schema never reaches here
 * through the connection gate.
 */
import { z } from 'zod'
import { isPlainObject, type Schema } from './tool-input-schema'

/** A union of one is just that one schema; zod's union needs at least two. */
function unionOf(options: z.ZodTypeAny[]): z.ZodTypeAny {
  if (options.length === 0) return z.unknown()
  if (options.length === 1) return options[0]!
  return z.union(options as unknown as readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
}

/** One declared type, as the model-facing zod schema. */
function scalarZod(schema: Schema, type: string): z.ZodTypeAny {
  switch (type) {
    case 'string': {
      let value = z.string()
      if (typeof schema.minLength === 'number') value = value.min(schema.minLength)
      if (typeof schema.maxLength === 'number') value = value.max(schema.maxLength)
      // `pattern` is deliberately absent here: the regular expression comes
      // from a remote server and validateToolInput runs it under explicit
      // bounds. Compiling it into the model-facing schema would run it again
      // on every parse, outside those bounds.
      return value
    }
    case 'integer':
    case 'number': {
      let value = type === 'integer' ? z.number().int() : z.number()
      if (typeof schema.minimum === 'number') value = value.min(schema.minimum)
      if (typeof schema.maximum === 'number') value = value.max(schema.maximum)
      return value
    }
    case 'boolean':
      return z.boolean()
    case 'null':
      return z.null()
    case 'array': {
      const items = isPlainObject(schema.items) ? toolInputZodSchema(schema.items) : z.unknown()
      let value = z.array(items)
      if (typeof schema.minItems === 'number') value = value.min(schema.minItems)
      if (typeof schema.maxItems === 'number') value = value.max(schema.maxItems)
      return value
    }
    case 'object':
      return objectZod(schema)
    default:
      return z.unknown()
  }
}

function objectZod(schema: Schema): z.ZodTypeAny {
  const properties = isPlainObject(schema.properties) ? schema.properties : null
  if (!properties) return z.record(z.string(), z.unknown())
  const required = new Set(
    (Array.isArray(schema.required) ? schema.required : []).filter(
      (key): key is string => typeof key === 'string'
    )
  )
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, property] of Object.entries(properties)) {
    if (!isPlainObject(property)) {
      shape[key] = required.has(key) ? z.unknown() : z.unknown().optional()
      continue
    }
    let field = toolInputZodSchema(property)
    if (typeof property.description === 'string') field = field.describe(property.description)
    if (!required.has(key)) field = field.optional()
    shape[key] = field
  }
  return z.object(shape)
}

/**
 * The model-facing schema for a supported input contract. Callers gate on
 * `analyzeToolInputSchema` first; an unsupported schema never reaches a model
 * because its tool is unavailable.
 */
export function toolInputZodSchema(schema: Schema | undefined | null): z.ZodTypeAny {
  if (!schema || !isPlainObject(schema)) return z.record(z.string(), z.unknown())

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum
    if (values.every((value) => typeof value === 'string')) {
      return z.enum(values as [string, ...string[]])
    }
    return unionOf(values.map((value) => z.literal(value as string | number | boolean | null)))
  }
  if ('const' in schema) {
    return z.literal(schema.const as string | number | boolean | null)
  }

  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = schema[key]
    if (!Array.isArray(branches) || branches.length === 0) continue
    const options = branches.map((branch) =>
      isPlainObject(branch) ? toolInputZodSchema(branch) : z.unknown()
    )
    return unionOf(options)
  }

  const declaredTypes = schema.type
  const types = (
    Array.isArray(declaredTypes) ? declaredTypes : declaredTypes ? [declaredTypes] : []
  ).filter((type): type is string => typeof type === 'string')

  if (types.length === 0) {
    return isPlainObject(schema.properties) ? objectZod(schema) : z.unknown()
  }
  if (types.length === 1) return scalarZod(schema, types[0]!)
  return unionOf(types.map((type) => scalarZod(schema, type)))
}
