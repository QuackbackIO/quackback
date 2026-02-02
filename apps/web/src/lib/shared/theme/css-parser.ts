/**
 * CSS Variable Parser
 *
 * Extracts CSS custom property declarations from CSS text.
 * Used for live preview of custom CSS in the branding settings.
 */

export interface ParsedCssVariables {
  light: Record<string, string>
  dark: Record<string, string>
}

/**
 * Extract CSS custom property declarations from CSS text
 * Handles :root { } and .dark { } blocks
 *
 * @param css - Raw CSS string (e.g., from tweakcn.com)
 * @returns Object with light and dark variable maps
 *
 * @example
 * ```ts
 * const css = `
 *   :root { --primary: oklch(0.6 0.2 250); }
 *   .dark { --primary: oklch(0.8 0.2 250); }
 * `
 * const vars = extractCssVariables(css)
 * // vars.light = { '--primary': 'oklch(0.6 0.2 250)' }
 * // vars.dark = { '--primary': 'oklch(0.8 0.2 250)' }
 * ```
 */
export function extractCssVariables(css: string): ParsedCssVariables {
  const light: Record<string, string> = {}
  const dark: Record<string, string> = {}

  if (!css) {
    return { light, dark }
  }

  // Match :root { ... } blocks (light mode variables)
  const rootMatches = css.matchAll(/:root\s*\{([^}]+)\}/g)
  for (const match of rootMatches) {
    parseVariables(match[1], light)
  }

  // Match .dark { ... } blocks (dark mode variables)
  const darkMatches = css.matchAll(/\.dark\s*\{([^}]+)\}/g)
  for (const match of darkMatches) {
    parseVariables(match[1], dark)
  }

  return { light, dark }
}

/**
 * Parse CSS variable declarations from a block of CSS
 * Handles multi-line values and various formatting
 */
function parseVariables(block: string, target: Record<string, string>) {
  // Match --variable-name: value; with support for multi-line values
  // Uses a more robust regex that handles values containing parentheses, spaces, etc.
  const varMatches = block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)
  for (const match of varMatches) {
    const name = `--${match[1].trim()}`
    const value = match[2].trim()
    target[name] = value
  }
}
