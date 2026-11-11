import { ValidationError } from '@/lib/shared/errors'
import { checkDesign } from '@/lib/shared/design/check-design'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { withBlockIds } from '@/lib/shared/design/home'
import { checkedWords, holdsMoreThanWords } from '@/lib/shared/design/words-schema'
import { lintDesignCss } from './css-lint'
import { withWelcomeImageRefs } from './welcome-images'

/**
 * A Welcome body as the design keeps it: checked against the rich words
 * schema and fitted when it fails, so no invalid words are stored. A body
 * written with the full editor (images, tables, other headings) holds more
 * than words and is kept as it is, for the panel's full editor.
 */
function checkedBody<T>(body: T): T {
  return holdsMoreThanWords(body) ? body : (checkedWords(body, 'rich') as T)
}

/**
 * The most a design may weigh, as JSON. The largest designs measured, the 14
 * fixtures and 11,727 benchmark designs, weigh 3.2 KB at most, and the schema's
 * own caps (CSS up to 50 KB, 12 Home blocks) stay well inside it. Every saved
 * revision keeps the whole document, and every portal page carries its view.
 */
export const MAX_DESIGN_BYTES = 256 * 1024

/**
 * The most a Welcome message may hold: its characters and its nodes. The
 * longest measured holds 123 characters in 3 nodes; this is a page of text.
 */
export const MAX_WELCOME_CHARACTERS = 5_000
export const MAX_WELCOME_NODES = 500

/** The characters and nodes a rich-text body holds. */
function bodySize(node: unknown): { characters: number; nodes: number } {
  const size = { characters: 0, nodes: 0 }
  const stack: unknown[] = [node]
  while (stack.length > 0) {
    const next = stack.pop()
    if (!next || typeof next !== 'object') continue
    size.nodes++
    const { text, content } = next as { text?: unknown; content?: unknown }
    if (typeof text === 'string') size.characters += text.length
    if (Array.isArray(content)) stack.push(...content)
  }
  return size
}

function assertWelcomeFits(body: unknown): void {
  const { characters, nodes } = bodySize(body)
  if (characters > MAX_WELCOME_CHARACTERS || nodes > MAX_WELCOME_NODES) {
    throw new ValidationError('WELCOME_TOO_LONG', 'This Welcome message is too long.')
  }
}

function assertDesignFits(input: unknown): void {
  const json = JSON.stringify(input) ?? ''
  if (new TextEncoder().encode(json).length > MAX_DESIGN_BYTES) {
    throw new ValidationError('DESIGN_TOO_LARGE', 'This design is too large to save.')
  }
}

/** The design with its Welcome bodies checked. */
function withCheckedWords(design: PortalDesign): PortalDesign {
  const { welcome } = design.pages.feedback
  assertWelcomeFits(welcome.body)
  welcome.body = checkedBody(welcome.body)
  for (const block of design.pages.home.blocks) {
    if (block.type !== 'welcome') continue
    assertWelcomeFits(block.body)
    block.body = checkedBody(block.body)
  }
  return design
}

/**
 * A document checked for its size, by the schema, then by the contrast solver
 * (check-design.ts), then its CSS and the length of its Welcome messages.
 */
export function validateDesign(input: unknown): PortalDesign {
  assertDesignFits(input)
  const checked = checkDesign(input)
  if (!checked.ok) throw new ValidationError(checked.code, checked.message)
  const design = checked.design
  if (design.css) {
    const lint = lintDesignCss(design.css)
    if (lint.errors.length > 0) {
      throw new ValidationError(
        'INVALID_CSS',
        lint.errors.map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message)).join(' ')
      )
    }
  }
  return withBlockIds(withWelcomeImageRefs(withCheckedWords(design)))
}
