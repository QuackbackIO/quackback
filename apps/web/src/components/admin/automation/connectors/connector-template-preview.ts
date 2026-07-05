/**
 * Client-side preview of `{token}` substitution for the connector form's
 * request preview. Mirrors connector.render.ts's 'raw' encoding (no escaping)
 * since this only ever renders into a read-only preview, never a real
 * request; the server is the source of truth for the actual call.
 */
const TOKEN_PATTERN = /\{([\w.]+)\}/g

export function renderConnectorPreview(
  template: string,
  values: Record<string, string | number | boolean>
): string {
  return template.replace(TOKEN_PATTERN, (_match, token: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, token)) return ''
    const value = values[token]
    return value === undefined || value === null ? '' : String(value)
  })
}
