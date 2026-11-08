import { ValidationError } from '@/lib/shared/errors'
import { checkDesign } from '@/lib/shared/design/check-design'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { withBlockIds } from '@/lib/shared/design/home'
import { checkedWords, holdsMoreThanWords } from '@/lib/shared/design/words-schema'
import { lintDesignCss } from './css-lint'

/**
 * A Welcome body as the design keeps it: checked against the rich words
 * schema and fitted when it fails, so no invalid words are stored. A body
 * written with the full editor (images, tables, other headings) holds more
 * than words and is kept as it is, for the panel's full editor.
 */
function checkedBody<T>(body: T): T {
  return holdsMoreThanWords(body) ? body : (checkedWords(body, 'rich') as T)
}

/** The design with its Welcome bodies checked. */
function withCheckedWords(design: PortalDesign): PortalDesign {
  const { welcome } = design.pages.feedback
  welcome.body = checkedBody(welcome.body)
  for (const block of design.pages.home.blocks)
    if (block.type === 'welcome') block.body = checkedBody(block.body)
  return design
}

/** A document checked twice: by the schema, then by the contrast solver (check-design.ts), then its CSS. */
export function validateDesign(input: unknown): PortalDesign {
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
  return withBlockIds(withCheckedWords(design))
}
