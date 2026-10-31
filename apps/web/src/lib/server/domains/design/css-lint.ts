/**
 * The workspace's own CSS, checked as it is saved. It runs in the tenant layer
 * over the design, so what it may do is narrow:
 *
 * - Refused: `@import`, `url()` anywhere but the workspace's own storage,
 *   `expression()`, `behavior` and `<`, any of which reaches past styling.
 * - Warned: internal class names (with the part to use instead, which "Fix it
 *   for me" swaps in), `!important`, setting a token no part reads, a part
 *   name kept only as an alias, and text and background colours on a part
 *   that do not reach 4.5:1.
 *
 * It parses with css-tree, pure JavaScript, so the server bundle carries no
 * native module, and through its self-contained build, which needs no data
 * files beside the bundle.
 */
import * as csstree from 'css-tree/dist/csstree.esm'
import type { CssNode, Declaration } from 'css-tree'
import { contrastRatio } from '@/lib/shared/design/contrast'
import { normaliseColor } from '@/lib/shared/design/color'
import { PART_ALIASES, PORTAL_PARTS, isPartName } from '@/lib/shared/design/parts'

export interface CssIssue {
  message: string
  /** The line it is on, counting from 1. */
  line?: number
  /** Text to swap, for "Fix it for me". */
  fix?: { find: string; replace: string }
}

export interface CssLintReport {
  errors: CssIssue[]
  warnings: CssIssue[]
}

/** Where the workspace's uploads are served from; nothing else may be loaded. */
const OWN_STORAGE = /^\/api\/storage\/[^\s"'()]+$/

/**
 * The portal's internal classes a workspace's CSS used before parts, each with
 * the part selector that replaces it.
 */
const INTERNAL_CLASSES: Record<string, string> = {
  'portal-header': '[data-qb-part="header"]',
  'portal-header__logo': '[data-qb-part="logo"]',
  'portal-nav__item': '[data-qb-part="nav-item"]',
  'portal-nav__item--active': '[data-qb-part="nav-item"][data-state="active"]',
  'portal-band': '[data-qb-part="band"]',
  'post-card__vote--voted': '[data-qb-part="vote-button"][data-state="voted"]',
}

/** Classes the portal draws with but never promises to keep. */
const INTERNAL_PREFIX = /^(portal-|post-card|feedback-|home-|qb-)/

const PUBLIC_TOKENS = new Set<string>(PORTAL_PARTS.flatMap((part) => [...part.tokens]))

const lineOf = (node: CssNode) => node.loc?.start.line

/** The part a rule's selector styles, if it names exactly one. */
function partOf(selector: string): string | null {
  const parts = [...selector.matchAll(/\[data-qb-part=["']?([a-z-]+)["']?\]/g)].map((m) => m[1]!)
  return parts.length === 1 ? parts[0]! : null
}

export function lintDesignCss(css: string): CssLintReport {
  const errors: CssIssue[] = []
  const warnings: CssIssue[] = []
  if (css.includes('<')) {
    errors.push({ message: 'CSS cannot contain "<".' })
    return { errors, warnings }
  }

  let ast: CssNode
  try {
    ast = csstree.parse(css, {
      positions: true,
      onParseError: (error) => {
        errors.push({ message: `This CSS does not parse: ${error.message}.`, line: error.line })
      },
    })
  } catch (error) {
    return {
      errors: [{ message: `This CSS does not parse: ${(error as Error).message}.` }],
      warnings,
    }
  }

  csstree.walk(ast, {
    enter(node: CssNode) {
      if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') {
        errors.push({
          message: '@import is not allowed: put the CSS here instead.',
          line: lineOf(node),
        })
      }
      if (node.type === 'Url' && !OWN_STORAGE.test(node.value.trim())) {
        errors.push({
          message: `url(${node.value}) is not allowed: only images and fonts uploaded to this workspace load.`,
          line: lineOf(node),
        })
      }
      if (node.type === 'Function' && node.name.toLowerCase() === 'expression') {
        errors.push({ message: 'expression() is not allowed.', line: lineOf(node) })
      }
      if (node.type === 'Declaration') {
        const property = node.property.toLowerCase()
        if (property === 'behavior' || property === '-ms-behavior') {
          errors.push({ message: `${node.property} is not allowed.`, line: lineOf(node) })
        }
        if (node.important) {
          warnings.push({
            message: `!important on ${node.property}: the tenant layer already wins over the design.`,
            line: lineOf(node),
          })
        }
        if (property.startsWith('--qb-') && !PUBLIC_TOKENS.has(property)) {
          warnings.push({
            message: `${node.property} is not one of the parts' tokens, so it may change without notice.`,
            line: lineOf(node),
          })
        }
      }
      if (node.type === 'ClassSelector' && INTERNAL_PREFIX.test(node.name)) {
        const part = INTERNAL_CLASSES[node.name]
        warnings.push({
          message: part
            ? `.${node.name} is internal and may change. Use ${part}.`
            : `.${node.name} is internal and may change. Style a part instead.`,
          line: lineOf(node),
          ...(part && { fix: { find: `.${node.name}`, replace: part } }),
        })
      }
      if (node.type === 'AttributeSelector' && node.name.name === 'data-qb-part' && node.value) {
        const name = node.value.type === 'String' ? node.value.value : node.value.name
        const renamed = PART_ALIASES[name]
        if (renamed) {
          warnings.push({
            message: `The ${name} part is now ${renamed}.`,
            line: lineOf(node),
            fix: { find: `data-qb-part="${name}"`, replace: `data-qb-part="${renamed}"` },
          })
        } else if (!isPartName(name)) {
          warnings.push({ message: `There is no ${name} part.`, line: lineOf(node) })
        }
      }
      if (node.type === 'Rule') {
        const part = partOf(csstree.generate(node.prelude))
        if (!part) return
        let color: string | null = null
        let background: string | null = null
        csstree.walk(node.block, {
          visit: 'Declaration',
          enter(declaration: Declaration) {
            const value = normaliseColor(csstree.generate(declaration.value).trim())
            const property = declaration.property.toLowerCase()
            if (property === 'color') color = value
            if (property === 'background' || property === 'background-color') background = value
          },
        })
        if (color && background && contrastRatio(color, background) < 4.5) {
          warnings.push({
            message: `Text on the ${part} part reads at ${contrastRatio(color, background).toFixed(1)}:1; it needs 4.5:1.`,
            line: lineOf(node),
          })
        }
      }
    },
  })
  return { errors, warnings }
}
