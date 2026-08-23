import type { ThemeConfig, ThemeMode, ThemeVariables } from './types'
import { expandTheme, type MinimalThemeVariables } from './expand'

export const variableMap: Record<string, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  destructiveForeground: '--destructive-foreground',
  border: '--border',
  input: '--input',
  ring: '--ring',
  success: '--success',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
  fontSans: '--font-sans',
  radius: '--radius',
  shadow2xs: '--shadow-2xs',
  shadowXs: '--shadow-xs',
  shadowSm: '--shadow-sm',
  shadow: '--shadow',
  shadowMd: '--shadow-md',
  shadowLg: '--shadow-lg',
  shadowXl: '--shadow-xl',
  shadow2xl: '--shadow-2xl',
}

/** Reverse lookup: CSS variable name → ThemeVariables key */
export const reverseVariableMap: Record<string, string> = Object.fromEntries(
  Object.entries(variableMap).map(([key, cssVar]) => [cssVar, key])
)

/** Keys to skip in readable CSS output (shadows are verbose, generated automatically) */
const SHADOW_KEYS = new Set([
  'shadow2xs',
  'shadowXs',
  'shadowSm',
  'shadow',
  'shadowMd',
  'shadowLg',
  'shadowXl',
  'shadow2xl',
])

/**
 * Generate pretty-printed CSS from minimal theme variables.
 * Outputs `:root { }` and `.dark { }` blocks with all expanded variables.
 */
export function generateReadableCSS(
  lightMinimal: Partial<MinimalThemeVariables>,
  darkMinimal: Partial<MinimalThemeVariables>,
  themeMode?: ThemeMode
): string {
  const parts: string[] = []

  if (themeMode !== 'dark') {
    const lightVars = expandTheme(lightMinimal, { mode: 'light' })
    parts.push(formatCssBlock(':root', lightVars))
  }

  if (themeMode !== 'light') {
    const darkVars = expandTheme(darkMinimal, { mode: 'dark' })
    parts.push(formatCssBlock('.dark', darkVars))
  }

  return parts.join('\n\n') + '\n'
}

const THEME_MODES = ['user', 'light', 'dark'] as const satisfies readonly ThemeMode[]

/**
 * True when `cssText` is the output of `generateReadableCSS` for any theme
 * mode. Extra rules (Advanced CSS) fail this check.
 */
export function isGeneratedThemeCss(
  cssText: string,
  lightMinimal: Partial<MinimalThemeVariables>,
  darkMinimal: Partial<MinimalThemeVariables>
): boolean {
  const trimmed = cssText.trim()
  if (!trimmed) return false
  return THEME_MODES.some(
    (mode) => generateReadableCSS(lightMinimal, darkMinimal, mode).trim() === trimmed
  )
}

const MINIMAL_THEME_CSS_VARS = new Set(
  (
    [
      'primary',
      'background',
      'foreground',
      'card',
      'muted',
      'mutedForeground',
      'border',
      'destructive',
      'success',
      'ring',
      'secondary',
      'accent',
      'fontSans',
      'radius',
    ] as const
  ).map((key) => variableMap[key])
)

function stripLeadingCssComments(decl: string): string {
  let s = decl.trim()
  while (s.startsWith('/*')) {
    const end = s.indexOf('*/')
    if (end === -1) break
    s = s.slice(end + 2).trim()
  }
  return s
}

function normalizeCssValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function parsePropertyValue(decl: string): { property: string; value: string } | null {
  const stripped = stripLeadingCssComments(decl)
  const match = /^((?:--[\w-]+)|font-family)\s*:\s*(.*)$/i.exec(stripped)
  if (!match) return null
  const property = match[1].toLowerCase() === 'font-family' ? 'font-family' : match[1]
  return { property, value: match[2].replace(/;?\s*$/, '').trim() }
}

function isGeneratedThemeDeclaration(decl: string, generated: Map<string, string>): boolean {
  const parsed = parsePropertyValue(decl)
  if (!parsed) return false
  const emitted = generated.get(parsed.property)
  if (emitted === undefined) return false
  // Minimal keys live in brandingConfig; stale copies must not override.
  if (parsed.property !== 'font-family' && MINIMAL_THEME_CSS_VARS.has(parsed.property)) return true
  return normalizeCssValue(parsed.value) === normalizeCssValue(emitted)
}

interface CssScan {
  quote: '"' | "'" | null
  comment: boolean
  paren: number
}

function isCssCode(scan: CssScan): boolean {
  return !scan.comment && scan.quote === null
}

/** Consume one token of CSS context (quotes, comments, `url()` / paren depth). Returns chars consumed. */
function advanceCssScan(scan: CssScan, source: string, i: number): number {
  const c = source[i]
  const next = source[i + 1]
  if (scan.comment) {
    if (c === '*' && next === '/') {
      scan.comment = false
      return 2
    }
    return 1
  }
  if (scan.quote) {
    if (c === '\\' && next !== undefined) return 2
    if (c === scan.quote) scan.quote = null
    return 1
  }
  if (c === '/' && next === '*') {
    scan.comment = true
    return 2
  }
  if (c === '"' || c === "'") {
    scan.quote = c
    return 1
  }
  if (c === '(') {
    scan.paren++
    return 1
  }
  if (c === ')' && scan.paren > 0) {
    scan.paren--
    return 1
  }
  return 1
}

/** Split a declaration block on `;` while ignoring those inside quotes, comments, or parentheses (including `url(...)`). */
function splitCssDeclarations(body: string): string[] {
  const decls: string[] = []
  const scan: CssScan = { quote: null, comment: false, paren: 0 }
  let start = 0
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === ';' && isCssCode(scan) && scan.paren === 0) {
      const decl = body.slice(start, i).trim()
      if (decl) decls.push(decl)
      start = i + 1
      i++
      continue
    }
    i += advanceCssScan(scan, body, i)
  }
  const tail = body.slice(start).trim()
  if (tail) decls.push(tail)
  return decls
}

function keepNonGeneratedDeclarations(body: string, generated: Map<string, string>): string {
  const kept: string[] = []
  for (const decl of splitCssDeclarations(body)) {
    if (isGeneratedThemeDeclaration(decl, generated)) continue
    kept.push(`  ${decl};`)
  }
  return kept.join('\n')
}

function declMapFromBlock(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const decl of splitCssDeclarations(body)) {
    const parsed = parsePropertyValue(decl)
    if (parsed) map.set(parsed.property, parsed.value)
  }
  return map
}

function matchThemeSelector(
  source: string,
  i: number
): { selector: ':root' | '.dark'; openBrace: number } | null {
  if (i > 0 && /[\w-]/.test(source[i - 1] ?? '')) return null
  let selector: ':root' | '.dark' | null = null
  if (source.startsWith(':root', i)) selector = ':root'
  else if (source.startsWith('.dark', i)) selector = '.dark'
  if (!selector) return null
  let j = i + selector.length
  while (j < source.length && /\s/.test(source[j] ?? '')) j++
  if (source[j] !== '{') return null
  return { selector, openBrace: j }
}

/** Index of the `}` that closes the `{` at `openIndex`, ignoring braces inside quotes, comments, or parentheses. */
function findMatchingBrace(source: string, openIndex: number): number {
  const scan: CssScan = { quote: null, comment: false, paren: 0 }
  let depth = 0
  let i = openIndex
  while (i < source.length) {
    const c = source[i]
    if (isCssCode(scan) && scan.paren === 0) {
      if (c === '{') {
        depth++
        i++
        continue
      }
      if (c === '}') {
        depth--
        if (depth === 0) return i
        i++
        continue
      }
    }
    i += advanceCssScan(scan, source, i)
  }
  return source.length
}

function walkThemeBlocks(
  cssText: string,
  onThemeBlock: (selector: ':root' | '.dark', body: string) => string | void,
  copyOther = false
): string {
  let out = ''
  let i = 0
  const scan: CssScan = { quote: null, comment: false, paren: 0 }

  while (i < cssText.length) {
    if (isCssCode(scan) && scan.paren === 0) {
      const theme = matchThemeSelector(cssText, i)
      if (theme) {
        const close = findMatchingBrace(cssText, theme.openBrace)
        const body = cssText.slice(theme.openBrace + 1, close)
        const replacement = onThemeBlock(theme.selector, body)
        if (copyOther && replacement) out += replacement
        i = close < cssText.length ? close + 1 : cssText.length
        scan.quote = null
        scan.comment = false
        scan.paren = 0
        continue
      }
    }

    const n = advanceCssScan(scan, cssText, i)
    if (copyOther) out += cssText.slice(i, i + n)
    i += n
  }

  return out
}

function generatedDeclMaps(generatedCss: string): Record<':root' | '.dark', Map<string, string>> {
  const maps: Record<':root' | '.dark', Map<string, string>> = {
    ':root': new Map(),
    '.dark': new Map(),
  }
  walkThemeBlocks(generatedCss, (selector, body) => {
    maps[selector] = declMapFromBlock(body)
  })
  return maps
}

function inferGeneratedCss(cssText: string): string {
  const light: Record<string, string> = {}
  const dark: Record<string, string> = {}
  walkThemeBlocks(cssText, (selector, body) => {
    const target = selector === ':root' ? light : dark
    for (const [property, value] of declMapFromBlock(body)) {
      if (property.startsWith('--')) target[property] = value
    }
  })
  return generateReadableCSS(parseCssToMinimal(light), parseCssToMinimal(dark), 'user')
}

/**
 * CSS left after removing generated theme declarations.
 * Drops `:root` / `.dark` declarations that `generateReadableCSS` emits
 * (minimal keys always; derived keys and `font-family` only when the value
 * matches). Unknown inner declarations stay. Generated-only CSS yields ''.
 */
export function advancedCssRemainder(cssText: string, generatedCss?: string): string {
  const maps = generatedDeclMaps(generatedCss ?? inferGeneratedCss(cssText))
  const result = walkThemeBlocks(
    cssText,
    (selector, body) => {
      const kept = keepNonGeneratedDeclarations(body, maps[selector])
      if (!kept) return ''
      return `${selector} {\n${kept}\n}`
    },
    true
  )
  return result.replace(/(?:\n[ \t]*){3,}/g, '\n\n').trim()
}

function formatCssBlock(selector: string, vars: ThemeVariables): string {
  const lines: string[] = [`${selector} {`]

  for (const [key, cssVar] of Object.entries(variableMap)) {
    if (SHADOW_KEYS.has(key)) continue
    const value = vars[key as keyof ThemeVariables]
    if (value) {
      lines.push(`  ${cssVar}: ${value};`)
    }
  }

  // Add font-family rule after variables if font is set
  if (vars.fontSans) {
    lines.push(`  font-family: ${vars.fontSans};`)
  }

  lines.push('}')
  return lines.join('\n')
}

/**
 * Convert parsed CSS variables back to MinimalThemeVariables.
 * Takes a map like { '--primary': 'oklch(...)' } and returns { primary: 'oklch(...)' }.
 */
export function parseCssToMinimal(cssVars: Record<string, string>): Partial<MinimalThemeVariables> {
  const result: Record<string, string> = {}

  for (const [cssVar, value] of Object.entries(cssVars)) {
    const key = reverseVariableMap[cssVar]
    if (key) {
      result[key] = value
    }
  }

  return result as Partial<MinimalThemeVariables>
}

/**
 * Replace a CSS variable's value in a CSS string.
 * Handles the variable in all blocks (:root, .dark).
 * For --font-sans, also updates the font-family rule if present.
 */
export function replaceCssVar(css: string, varName: string, newValue: string): string {
  // Escape the varName for regex (handles -- prefix)
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(${escaped}\\s*:\\s*)([^;]+)(;)`, 'g')
  let result = css.replace(pattern, `$1${newValue}$3`)

  // For --font-sans, also update font-family declarations
  if (varName === '--font-sans') {
    result = result.replace(/(font-family\s*:\s*)([^;]+)(;)/g, `$1${newValue}$3`)
  }

  return result
}

function variablesToCSS(vars: ThemeVariables): string {
  const declarations: string[] = []
  for (const [key, value] of Object.entries(vars)) {
    const cssVar = variableMap[key]
    if (cssVar && value) {
      declarations.push(`${cssVar}: ${value};`)
    }
  }
  return declarations.join(' ')
}

// Maps a font family saved under an old name to the one now self-hosted in
// globals.css. Geist self-hosts via @fontsource/geist-sans, whose @font-face
// family is "Geist Sans", so a fontSans saved before that rename still resolves.
const LEGACY_FONT_ALIASES: Record<string, string> = {
  '"Geist"': '"Geist Sans"',
}

/** Rewrite legacy font-family names in a fontSans stack to their bundled equivalent. */
export function normalizeFontSans(fontSans: string): string {
  let normalized = fontSans
  for (const [legacy, current] of Object.entries(LEGACY_FONT_ALIASES)) {
    normalized = normalized.replaceAll(legacy, current)
  }
  return normalized
}

export function generateThemeCSS(config: ThemeConfig): string {
  if (!config) return ''

  // Each half is expanded only when the config has one, so a workspace that
  // branded a single mode keeps the other on the stylesheet defaults. Either
  // half may be partial; expandTheme fills its gaps from the base palette.
  const themeMode = config.themeMode ?? 'user'
  const lightVars = config.light ? expandTheme(config.light, { mode: 'light' }) : {}
  const darkVars = config.dark ? expandTheme(config.dark, { mode: 'dark' }) : {}
  if (lightVars.fontSans) lightVars.fontSans = normalizeFontSans(lightVars.fontSans)
  if (darkVars.fontSans) darkVars.fontSans = normalizeFontSans(darkVars.fontSans)

  const parts: string[] = []

  // Only output light mode CSS if themeMode is not 'dark'
  // Use :root selector so custom CSS (e.g., from tweakcn) can override via cascade
  if (themeMode !== 'dark') {
    const lightCSS = variablesToCSS(lightVars)
    if (lightCSS) parts.push(`:root { ${lightCSS} }`)
  }

  // Only output dark mode CSS if themeMode is not 'light'
  if (themeMode !== 'light') {
    const darkCSS = variablesToCSS(darkVars)
    // When forcing dark mode, use :root instead of .dark so it applies without the class
    // Use .dark selector so custom CSS can override via cascade
    if (darkCSS) {
      if (themeMode === 'dark') {
        parts.push(`:root { ${darkCSS} }`)
      } else {
        parts.push(`.dark { ${darkCSS} }`)
      }
    }
  }

  const bodyDeclarations: string[] = []
  if (lightVars.fontSans) bodyDeclarations.push(`--font-sans: ${lightVars.fontSans}`)
  if (lightVars.radius) bodyDeclarations.push(`--radius: ${lightVars.radius}`)
  if (bodyDeclarations.length > 0) {
    parts.push(`body { ${bodyDeclarations.join('; ')}; }`)
  }

  if (lightVars.fontSans) {
    parts.push(`html body { font-family: ${lightVars.fontSans} !important; }`)
  }

  return parts.join(' ')
}

export function parseThemeConfig(json: string | null | undefined): ThemeConfig | null {
  if (!json) return null
  try {
    const config = JSON.parse(json)
    if (typeof config !== 'object') return null
    return config as ThemeConfig
  } catch {
    return null
  }
}

export function serializeThemeConfig(config: ThemeConfig): string {
  return JSON.stringify(config)
}
