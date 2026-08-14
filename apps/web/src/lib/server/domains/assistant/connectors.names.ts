/**
 * Pure naming / description / JSON-Schema helpers for connector tools.
 * Kept off the MCP/DB import graph so unit tests stay light.
 */
import { z } from 'zod'

/** Sanitize an MCP tool name for use inside a Quackback tool id. */
export function sanitizeToolSegment(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

/** Stable model-facing tool name for one MCP tool on one connector. */
export function connectorToolName(row: { slug: string }, remoteName: string): string {
  return `mcp_${row.slug}_${sanitizeToolSegment(remoteName)}`
}

/** Deduplicate a model-facing name against names already claimed this turn. */
export function uniqueConnectorToolName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let index = 2
  while (used.has(`${base}_${index}`)) index += 1
  const next = `${base}_${index}`
  used.add(next)
  return next
}

/** Append the remote JSON Schema so the model sees argument names and types. */
export function formatConnectorToolDescription(fallback: string, inputSchemaJson?: string): string {
  const parsed = parseJsonSchemaObject(inputSchemaJson)
  if (!parsed) return fallback
  return `${fallback}\n\nArgument JSON Schema:\n${JSON.stringify(parsed)}`
}

type JsonSchemaNode = {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  items?: JsonSchemaNode
  enum?: unknown[]
}

function parseJsonSchemaObject(inputSchemaJson?: string): JsonSchemaNode | null {
  if (!inputSchemaJson) return null
  try {
    const parsed: unknown = JSON.parse(inputSchemaJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as JsonSchemaNode
  } catch {
    return null
  }
}

function schemaTypes(node: JsonSchemaNode): string[] {
  if (Array.isArray(node.type)) return node.type.filter((value) => typeof value === 'string')
  return typeof node.type === 'string' ? [node.type] : []
}

function jsonSchemaPropertyToZod(node: JsonSchemaNode): z.ZodTypeAny {
  if (
    Array.isArray(node.enum) &&
    node.enum.length > 0 &&
    node.enum.every((v) => typeof v === 'string')
  ) {
    const [first, ...rest] = node.enum as string[]
    const field = z.enum([first, ...rest])
    return node.description ? field.describe(node.description) : field
  }

  const types = schemaTypes(node)
  const primary = types.find((type) => type !== 'null') ?? types[0]
  let field: z.ZodTypeAny
  switch (primary) {
    case 'string':
      field = z.string()
      break
    case 'integer':
    case 'number':
      field = z.number()
      break
    case 'boolean':
      field = z.boolean()
      break
    case 'array':
      field = z.array(node.items ? jsonSchemaPropertyToZod(node.items) : z.unknown())
      break
    case 'object':
      field = connectorObjectFromSchema(node)
      break
    default:
      field = z.unknown()
  }
  return node.description ? field.describe(node.description) : field
}

function connectorObjectFromSchema(node: JsonSchemaNode): z.ZodType<Record<string, unknown>> {
  const properties = node.properties
  if (!properties || Object.keys(properties).length === 0) {
    return z.record(z.string(), z.unknown())
  }
  const required = new Set(node.required ?? [])
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, prop] of Object.entries(properties)) {
    const field = jsonSchemaPropertyToZod(prop ?? {})
    shape[key] = required.has(key) ? field : field.optional()
  }
  return z.looseObject(shape)
}

/**
 * Turn a stored MCP inputSchema into a named zod object the model can fill.
 * Unknown / empty schemas stay a loose record so calls still go through.
 */
export function connectorToolInputSchema(
  inputSchemaJson?: string
): z.ZodType<Record<string, unknown>> {
  const parsed = parseJsonSchemaObject(inputSchemaJson)
  if (!parsed) return z.record(z.string(), z.unknown()).default({})
  return connectorObjectFromSchema(parsed)
}

/** Unwrap `{ arguments }` (legacy wrapper) or pass named fields through. */
export function connectorCallArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {}
  const record = args as Record<string, unknown>
  const nested = record.arguments
  if (
    nested &&
    typeof nested === 'object' &&
    !Array.isArray(nested) &&
    Object.keys(record).every((key) => key === 'arguments')
  ) {
    return nested as Record<string, unknown>
  }
  return record
}
