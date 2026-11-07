import { ValidationError } from '@/lib/shared/errors'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { withoutRetiredKeys } from '@/lib/shared/design/stored-design'
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

/** A document checked twice: by the schema, then by the contrast solver. */
export function validateDesign(input: unknown): PortalDesign {
  const parsed = portalDesign.safeParse(withoutRetiredKeys(input))
  if (!parsed.success) {
    throw new ValidationError(
      'INVALID_DESIGN',
      parsed.error.issues.map((i) => i.message).join('; ')
    )
  }
  const { errors } = resolveDesign(parsed.data)
  if (errors.length > 0) throw new ValidationError('UNREADABLE_DESIGN', errors.join('; '))
  if (parsed.data.css) {
    const lint = lintDesignCss(parsed.data.css)
    if (lint.errors.length > 0) {
      throw new ValidationError(
        'INVALID_CSS',
        lint.errors.map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message)).join(' ')
      )
    }
  }
  return withBlockIds(withCheckedWords(parsed.data))
}
