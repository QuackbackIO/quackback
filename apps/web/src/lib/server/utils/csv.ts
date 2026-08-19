/**
 * CSV field escaping shared by the export routes.
 */

/**
 * Escape a value for CSV format, preventing CSV injection attacks.
 */
export function escapeCSV(value: string): string {
  if (!value) return '""'

  // Prevent CSV injection by prefixing formula characters with single quote
  let escaped = value
  if (/^[=+\-@\t\r]/.test(escaped)) {
    escaped = "'" + escaped
  }

  // If the value contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
  if (
    escaped.includes('"') ||
    escaped.includes(',') ||
    escaped.includes('\n') ||
    escaped.includes('\r')
  ) {
    return `"${escaped.replace(/"/g, '""')}"`
  }

  return `"${escaped}"`
}
