/**
 * The supported-schema policy for remote MCP tools, and exact validation
 * against it.
 *
 * A connector's input schema is written by somebody else's server, so this
 * module answers two separate questions and never lets one answer the other:
 *
 * 1. **Can this workspace enforce the contract at all?** `analyzeToolInputSchema`
 *    walks the schema against a closed list of constructs. Anything outside it
 *    (`$ref`, `allOf`, `patternProperties`, conditionals, a schema-valued
 *    `additionalProperties`, or simply a keyword this list has never heard of)
 *    makes the tool UNAVAILABLE. The alternative, ignoring what we cannot
 *    check, would quietly turn a constrained contract into an unconstrained
 *    one, which is the failure the connection gate exists to prevent.
 * 2. **Do these arguments satisfy it?** `validateToolInput` checks the whole
 *    declared contract before dispatch: enums, integer-ness and bounds, nested
 *    objects, array items and lengths, required properties, and a ceiling on
 *    the serialized payload.
 *
 * Two deliberate narrowings, both in the safe direction:
 *
 * - `pattern` is evaluated only for patterns up to
 *   {@link MAX_PATTERN_LENGTH} characters against strings up to
 *   {@link MAX_PATTERN_INPUT_LENGTH}; a longer string with a pattern declared
 *   is reported as a violation rather than matched. The regular expression
 *   comes from a remote server and runs in the worker, so an unbounded match
 *   is a denial-of-service waiting to happen, and refusing is the direction
 *   that cannot leak.
 * - An absent schema is treated as an object with no declared properties,
 *   which is what the MCP server said: no contract to enforce. It is supported
 *   and accepts any object, exactly as before this module existed.
 *
 * `toolInputZodSchema` (tool-input-zod.ts) converts the same subset into the
 * zod schema the model sees. The two are written against one keyword list on
 * purpose: a model-facing contract looser than the enforced one produces tool
 * calls that are rejected after the model has already promised the customer
 * something.
 */

/** Ceiling on the serialized argument payload handed to a remote server. */
export const CONNECTOR_MAX_ARGUMENT_BYTES = 32 * 1024

const MAX_PATTERN_LENGTH = 200
const MAX_PATTERN_INPUT_LENGTH = 1024
const MAX_REPORTED_ERRORS = 10

export type Schema = Record<string, unknown>

/** Keywords that describe rather than constrain: ignored, never a reason to refuse. */
const ANNOTATION_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'example',
  'format',
  'deprecated',
  'readOnly',
  'writeOnly',
])

/** Keywords this module both understands and enforces. */
const SUPPORTED_KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'anyOf',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'minProperties',
  'maxProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
])

const SUPPORTED_TYPES = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
])

export interface SupportedToolSchema {
  supported: true
}

export interface UnsupportedToolSchema {
  supported: false
  /** Operator-facing: which construct made the tool unavailable. */
  reason: string
}

export type ToolSchemaAnalysis = SupportedToolSchema | UnsupportedToolSchema

export type ToolInputValidation = { ok: true } | { ok: false; errors: string[] }

export function isPlainObject(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describePath(path: string): string {
  return path === '' ? 'the arguments' : `"${path}"`
}

/** First unsupported construct found, depth first, or null when all of it is enforceable. */
function findUnsupported(schema: unknown, path: string): string | null {
  if (!isPlainObject(schema)) {
    return `${describePath(path)} has a schema that is not an object`
  }
  for (const key of Object.keys(schema)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue
    if (!SUPPORTED_KEYWORDS.has(key)) {
      return `${describePath(path)} uses the unsupported keyword "${key}"`
    }
  }
  const declaredTypes = schema.type
  const types = Array.isArray(declaredTypes) ? declaredTypes : declaredTypes ? [declaredTypes] : []
  for (const type of types) {
    if (typeof type !== 'string' || !SUPPORTED_TYPES.has(type)) {
      return `${describePath(path)} declares the unsupported type "${String(type)}"`
    }
  }
  if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean') {
    return `${describePath(path)} uses a schema-valued "additionalProperties"`
  }
  if ('pattern' in schema) {
    const pattern = schema.pattern
    if (typeof pattern !== 'string' || pattern.length > MAX_PATTERN_LENGTH) {
      return `${describePath(path)} declares a pattern this workspace will not run`
    }
    try {
      new RegExp(pattern)
    } catch {
      return `${describePath(path)} declares a pattern that is not a valid regular expression`
    }
  }
  if ('enum' in schema && !Array.isArray(schema.enum)) {
    return `${describePath(path)} declares a non-array "enum"`
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = schema[key]
    if (branches === undefined) continue
    if (!Array.isArray(branches) || branches.length === 0) {
      return `${describePath(path)} declares an empty "${key}"`
    }
    for (const [index, branch] of branches.entries()) {
      const nested = findUnsupported(branch, `${path}${path ? '.' : ''}${key}[${index}]`)
      if (nested) return nested
    }
  }
  const properties = schema.properties
  if (properties !== undefined) {
    if (!isPlainObject(properties))
      return `${describePath(path)} declares a non-object "properties"`
    for (const [name, property] of Object.entries(properties)) {
      const nested = findUnsupported(property, path === '' ? name : `${path}.${name}`)
      if (nested) return nested
    }
  }
  const items = schema.items
  if (items !== undefined) {
    if (Array.isArray(items)) return `${describePath(path)} declares tuple "items"`
    const nested = findUnsupported(items, `${path}[]`)
    if (nested) return nested
  }
  return null
}

/**
 * Decide whether this workspace can enforce the tool's declared input
 * contract. The answer gates availability, so it is cached alongside the
 * discovered catalog rather than recomputed per call.
 */
export function analyzeToolInputSchema(schema: Schema | undefined | null): ToolSchemaAnalysis {
  if (schema === undefined || schema === null) return { supported: true }
  if (!isPlainObject(schema)) {
    return { supported: false, reason: 'the tool declares an input schema that is not an object' }
  }
  const declaredTypes = schema.type
  const types = Array.isArray(declaredTypes) ? declaredTypes : declaredTypes ? [declaredTypes] : []
  if (types.length > 0 && !types.includes('object')) {
    return { supported: false, reason: 'the tool input is not declared as an object' }
  }
  const unsupported = findUnsupported(schema, '')
  return unsupported ? { supported: false, reason: unsupported } : { supported: true }
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return false
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function checkValue(schema: Schema, value: unknown, path: string, errors: string[]): void {
  if (errors.length >= MAX_REPORTED_ERRORS) return

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((allowed) => sameValue(allowed, value))) {
      errors.push(`${describePath(path)} is not one of the allowed values`)
      return
    }
  }
  if ('const' in schema && !sameValue(schema.const, value)) {
    errors.push(`${describePath(path)} must equal the declared constant`)
    return
  }

  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = schema[key]
    if (!Array.isArray(branches)) continue
    const matches = branches.filter((branch) => {
      const branchErrors: string[] = []
      if (isPlainObject(branch)) checkValue(branch, value, path, branchErrors)
      return branchErrors.length === 0
    }).length
    const satisfied = key === 'anyOf' ? matches > 0 : matches === 1
    if (!satisfied) {
      errors.push(`${describePath(path)} does not match the declared alternatives`)
      return
    }
  }

  const declaredTypes = schema.type
  const types = (
    Array.isArray(declaredTypes) ? declaredTypes : declaredTypes ? [declaredTypes] : []
  ) as string[]
  if (types.length > 0 && !types.some((type) => typeMatches(type, value))) {
    errors.push(`${describePath(path)} must be ${types.join(' or ')}`)
    return
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${describePath(path)} must be at least ${schema.minimum}`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${describePath(path)} must be at most ${schema.maximum}`)
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      errors.push(`${describePath(path)} must be greater than ${schema.exclusiveMinimum}`)
    }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      errors.push(`${describePath(path)} must be less than ${schema.exclusiveMaximum}`)
    }
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
      const ratio = value / schema.multipleOf
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
        errors.push(`${describePath(path)} must be a multiple of ${schema.multipleOf}`)
      }
    }
  }

  if (typeof value === 'string') {
    const length = codePointLength(value)
    if (typeof schema.minLength === 'number' && length < schema.minLength) {
      errors.push(`${describePath(path)} must be at least ${schema.minLength} characters`)
    }
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) {
      errors.push(`${describePath(path)} must be at most ${schema.maxLength} characters`)
    }
    if (typeof schema.pattern === 'string') {
      if (length > MAX_PATTERN_INPUT_LENGTH) {
        errors.push(`${describePath(path)} is too long to check against the declared pattern`)
      } else {
        try {
          if (!new RegExp(schema.pattern).test(value)) {
            errors.push(`${describePath(path)} does not match the declared pattern`)
          }
        } catch {
          errors.push(`${describePath(path)} could not be checked against the declared pattern`)
        }
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${describePath(path)} must have at least ${schema.minItems} items`)
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${describePath(path)} must have at most ${schema.maxItems} items`)
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((item) => JSON.stringify(item)))
      if (seen.size !== value.length) errors.push(`${describePath(path)} must not repeat an item`)
    }
    if (isPlainObject(schema.items)) {
      for (const [index, item] of value.entries()) {
        checkValue(schema.items, item, `${path}[${index}]`, errors)
        if (errors.length >= MAX_REPORTED_ERRORS) return
      }
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const name of required) {
      if (typeof name !== 'string') continue
      if (value[name] === undefined) {
        errors.push(`${describePath(path === '' ? name : `${path}.${name}`)} is required`)
      }
    }
    if (
      typeof schema.minProperties === 'number' &&
      Object.keys(value).length < schema.minProperties
    )
      errors.push(`${describePath(path)} must have at least ${schema.minProperties} properties`)
    if (
      typeof schema.maxProperties === 'number' &&
      Object.keys(value).length > schema.maxProperties
    )
      errors.push(`${describePath(path)} must have at most ${schema.maxProperties} properties`)
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(
            `${describePath(path === '' ? key : `${path}.${key}`)} is not an allowed property`
          )
        }
      }
    }
    for (const [name, property] of Object.entries(properties)) {
      const child = value[name]
      if (child === undefined) continue
      if (!isPlainObject(property)) continue
      checkValue(property, child, path === '' ? name : `${path}.${name}`, errors)
      if (errors.length >= MAX_REPORTED_ERRORS) return
    }
  }
}

/**
 * Validate one tool call's arguments against the contract the remote server
 * published. An unsupported schema is a failure here too, so a caller that
 * forgets the availability gate still cannot dispatch unchecked arguments.
 */
export function validateToolInput(
  schema: Schema | undefined | null,
  args: unknown
): ToolInputValidation {
  const analysis = analyzeToolInputSchema(schema)
  if (!analysis.supported) {
    return { ok: false, errors: [`unsupported input schema: ${analysis.reason}`] }
  }

  const payload = args === undefined ? {} : args
  let serialized: string
  try {
    serialized = JSON.stringify(payload) ?? 'null'
  } catch {
    return { ok: false, errors: ['the arguments could not be serialized'] }
  }
  if (Buffer.byteLength(serialized, 'utf8') > CONNECTOR_MAX_ARGUMENT_BYTES) {
    return {
      ok: false,
      errors: [`the argument payload is too large (limit ${CONNECTOR_MAX_ARGUMENT_BYTES} bytes)`],
    }
  }

  if (!isPlainObject(payload)) return { ok: false, errors: ['the arguments must be an object'] }
  if (!schema) return { ok: true }

  const errors: string[] = []
  checkValue(schema, payload, '', errors)
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}
