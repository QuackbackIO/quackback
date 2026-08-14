/**
 * Pure naming / description helpers for connector tools.
 * Kept off the MCP/DB import graph so unit tests stay light.
 */

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
  if (!inputSchemaJson) return fallback
  try {
    const parsed: unknown = JSON.parse(inputSchemaJson)
    if (!parsed || typeof parsed !== 'object') return fallback
    return `${fallback}\n\nArgument JSON Schema:\n${JSON.stringify(parsed)}`
  } catch {
    return fallback
  }
}
