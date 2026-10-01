/**
 * The rules behind the admin consistency guard. Paths are relative to
 * `apps/web/src`. Kept apart from the test so the allowlist generator script
 * runs the same matchers. Sources are parsed with @babel/parser, so the rules
 * read real syntax: string literals, template text and JSX text, never comments.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { parse, type ParserPlugin } from '@babel/parser'
import { join, relative } from 'node:path'

export const RULE_NAMES = [
  'page-shell',
  'page-width',
  'registry-pages',
  'create-labels',
  'no-dashes',
  'tab-icons',
  'toggle-rows',
  'palette',
] as const
export type RuleName = (typeof RULE_NAMES)[number]

/** Rules whose allowlist holds source files (registry-pages lists registry paths). */
export type FileRuleName = Exclude<RuleName, 'registry-pages'>

type Node = { type: string; [key: string]: unknown }

/** What the rules read from one source file, collected in a single parse. */
interface Analysis {
  /** String literals, template text and JSX text (whitespace collapsed in JSX text). */
  texts: string[]
  /** String literals and template text, where class names live. */
  classTexts: string[]
  /** The class texts that sit outside a dialog, sheet, popover or tooltip. */
  pageClassTexts: string[]
  importsPageHeader: boolean
  rendersH1: boolean
  rendersSwitch: boolean
  usesSettingRow: boolean
  tabTriggerElementChild: boolean
  pageProps: string[]
}

/** Overlay containers: a width on these (or inside them) is not a page width. */
const OVERLAY =
  /^(?:(?:AlertDialog|Dialog|Sheet|Popover|Tooltip|DropdownMenu|ContextMenu|Select|HoverCard)(?:Sub)?(?:Content|Popup)|Tooltip|Dialog|AlertDialog|Sheet|Popover)$/

function jsxName(node: Node): string | null {
  const name = node.name as Node | undefined
  if (!name) return null
  if (name.type === 'JSXIdentifier') return name.name as string
  if (name.type === 'JSXMemberExpression') return (name.property as Node).name as string
  return null
}

function parseSource(file: string, src: string): Node {
  const plugins: ParserPlugin[] = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript']
  try {
    return parse(src, { sourceType: 'module', plugins, errorRecovery: false }) as unknown as Node
  } catch (error) {
    throw new Error(`admin consistency guard could not parse ${file}: ${(error as Error).message}`)
  }
}

const SKIPPED_KEYS = new Set([
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

function analyse(file: string, src: string): Analysis {
  const out: Analysis = {
    texts: [],
    classTexts: [],
    pageClassTexts: [],
    importsPageHeader: false,
    rendersH1: false,
    rendersSwitch: false,
    usesSettingRow: false,
    tabTriggerElementChild: false,
    pageProps: [],
  }
  // Ancestors that are overlay elements, and TabsTrigger elements, at the current position.
  let overlayDepth = 0
  let tabTriggerDepth = 0

  const visit = (node: Node) => {
    let overlay = false
    let tabTrigger = false
    switch (node.type) {
      case 'StringLiteral': {
        const value = node.value as string
        out.texts.push(value)
        out.classTexts.push(value)
        if (overlayDepth === 0) out.pageClassTexts.push(value)
        break
      }
      case 'TemplateElement': {
        const value = ((node.value as { cooked?: string; raw: string }).cooked ??
          (node.value as { raw: string }).raw) as string
        out.texts.push(value)
        out.classTexts.push(value)
        if (overlayDepth === 0) out.pageClassTexts.push(value)
        break
      }
      case 'JSXText':
        out.texts.push((node.value as string).replace(/\s+/g, ' '))
        break
      case 'ImportSpecifier': {
        const imported = node.imported as Node
        if ((imported.name ?? imported.value) === 'PageHeader') out.importsPageHeader = true
        break
      }
      case 'Identifier':
      case 'JSXIdentifier':
        if (node.name === 'SettingRow') out.usesSettingRow = true
        break
      case 'JSXAttribute': {
        const name = node.name as Node
        const value = node.value as Node | null
        if (name.type === 'JSXIdentifier' && name.name === 'page' && value) {
          const literal =
            value.type === 'JSXExpressionContainer' ? (value.expression as Node) : value
          if (literal.type === 'StringLiteral') out.pageProps.push(literal.value as string)
        }
        break
      }
      case 'JSXElement': {
        const opening = node.openingElement as Node
        const name = jsxName(opening)
        if (name === 'h1') out.rendersH1 = true
        if (name === 'Switch') out.rendersSwitch = true
        if (tabTriggerDepth > 0) out.tabTriggerElementChild = true
        if (name === 'TabsTrigger') tabTrigger = true
        if (name && OVERLAY.test(name)) overlay = true
        break
      }
    }
    if (overlay) overlayDepth++
    if (tabTrigger) tabTriggerDepth++
    for (const [key, value] of Object.entries(node)) {
      if (SKIPPED_KEYS.has(key) || value === null || typeof value !== 'object') continue
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && typeof (item as Node).type === 'string') {
            visit(item as Node)
          }
        }
      } else if (typeof (value as Node).type === 'string') {
        visit(value as Node)
      }
    }
    if (overlay) overlayDepth--
    if (tabTrigger) tabTriggerDepth--
  }
  visit(parseSource(file, src))
  return out
}

const cache = new Map<string, Analysis>()
function analysis(file: string, src: string): Analysis {
  const key = `${file}\0${src}`
  let found = cache.get(key)
  if (!found) {
    found = analyse(file, src)
    cache.set(key, found)
  }
  return found
}

const SKIP = /(^|\/)__tests__\/|\.test\.tsx?$|\.d\.ts$/

const isAdminFile = (file: string) =>
  /^(routes|components)\/admin\//.test(file) && /\.tsx?$/.test(file) && !SKIP.test(file)

const isSettingsOrAutomationFile = (file: string) =>
  isAdminFile(file) &&
  (/^routes\/admin\/(settings|automation)[._/]/.test(file) ||
    /^routes\/admin\/settings\.tsx$/.test(file) ||
    /^components\/admin\/(settings|automation)\//.test(file))

const SHELL_PRIMITIVES = new Set([
  'components/admin/settings/settings-page.tsx',
  'routes/admin/settings.tsx',
])

/** Whether `file` is one the rule looks at. */
export function inScope(rule: FileRuleName, file: string): boolean {
  switch (rule) {
    case 'create-labels':
    case 'no-dashes':
      return isAdminFile(file)
    case 'page-shell':
      return isSettingsOrAutomationFile(file) && !SHELL_PRIMITIVES.has(file)
    case 'page-width':
      return (
        isSettingsOrAutomationFile(file) && file !== 'components/admin/settings/settings-page.tsx'
      )
    default:
      return isSettingsOrAutomationFile(file)
  }
}

const PALETTE =
  /\b(?:text|bg|border|ring|fill|stroke)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

const PAGE_WIDTH = /\bmax-w-(?:2xl|3xl|4xl|5xl|6xl|7xl)\b/

const MATCHERS: Record<FileRuleName, (a: Analysis) => boolean> = {
  'page-shell': (a) => a.importsPageHeader || a.rendersH1,
  'page-width': (a) => a.pageClassTexts.some((text) => PAGE_WIDTH.test(text)),
  'create-labels': (a) =>
    a.texts.some(
      (text) => /\bAdd new\b/.test(text) || /\b(?:New|Add|Create) [A-Z][a-z]+/.test(text)
    ),
  'no-dashes': (a) => a.texts.some((text) => /[\u2013\u2014]/.test(text)),
  'tab-icons': (a) => a.tabTriggerElementChild,
  'toggle-rows': (a) => a.rendersSwitch && !a.usesSettingRow,
  palette: (a) => a.classTexts.some((text) => PALETTE.test(text)),
}

/** Whether a source file breaks the rule (false for files outside its scope). */
export function offends(rule: FileRuleName, file: string, src: string): boolean {
  return inScope(rule, file) && MATCHERS[rule](analysis(file, src))
}

/** The registry paths some file passes as `page="<path>"`. */
export function usedRegistryPaths(files: Array<{ file: string; src: string }>): Set<string> {
  const used = new Set<string>()
  for (const { file, src } of files) {
    for (const path of analysis(file, src).pageProps) used.add(path)
  }
  return used
}

export const SRC_ROOT = join(import.meta.dirname, '..', '..', '..')

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
}

/** Every admin source file, path relative to `src`, with its contents. */
export function readAdminFiles(): Array<{ file: string; src: string }> {
  const paths: string[] = []
  walk(join(SRC_ROOT, 'routes', 'admin'), paths)
  walk(join(SRC_ROOT, 'components', 'admin'), paths)
  return paths
    .map((path) => relative(SRC_ROOT, path).split('\\').join('/'))
    .filter(isAdminFile)
    .sort()
    .map((file) => ({ file, src: readFileSync(join(SRC_ROOT, file), 'utf8') }))
}

/** Today's offenders per rule, for the test and the allowlist generator. */
export function scanAdminFiles(registryPaths: readonly string[]): Record<RuleName, string[]> {
  const files = readAdminFiles()
  const result = {} as Record<RuleName, string[]>
  for (const rule of RULE_NAMES) {
    if (rule === 'registry-pages') continue
    result[rule] = files.filter(({ file, src }) => offends(rule, file, src)).map(({ file }) => file)
  }
  const used = usedRegistryPaths(files)
  result['registry-pages'] = registryPaths.filter((path) => !used.has(path)).sort()
  return result
}
