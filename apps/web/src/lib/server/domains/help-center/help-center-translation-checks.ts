/**
 * The checks an AI translation passes before it is offered: the same code
 * blocks and inline code, every link, image and embed target kept, the same
 * headings, nothing empty, and every never-translate word still there.
 *
 * They compare rich bodies, not Markdown, so content lost in the Markdown
 * round trip counts as lost.
 */
import type { JSONContent } from '@tiptap/core'
import type {
  TiptapContent,
  TranslationCheckProblem,
  TranslationCheckResult,
} from '@/lib/server/db'

const IMAGE_TYPES = new Set(['image', 'resizableImage', 'chatImage'])
const EMBED_TYPES = new Set(['youtube', 'video', 'quackbackEmbed'])

interface BodyParts {
  codeBlocks: string[]
  inlineCode: string[]
  links: string[]
  images: string[]
  embeds: string[]
  headings: number[]
  text: string
}

function textOf(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textOf).join('')
}

function embedKey(node: JSONContent): string {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const target = attrs.src ?? attrs.url ?? attrs.href ?? attrs.id
  return `${node.type}:${typeof target === 'string' ? target : JSON.stringify(attrs)}`
}

function partsOf(body: TiptapContent | JSONContent | null | undefined): BodyParts {
  const parts: BodyParts = {
    codeBlocks: [],
    inlineCode: [],
    links: [],
    images: [],
    embeds: [],
    headings: [],
    text: '',
  }
  const texts: string[] = []
  const visit = (node: JSONContent) => {
    const type = node.type ?? ''
    if (type === 'codeBlock') {
      parts.codeBlocks.push(textOf(node))
      return
    }
    if (type === 'heading') parts.headings.push(Number(node.attrs?.level ?? 1))
    if (IMAGE_TYPES.has(type) && typeof node.attrs?.src === 'string')
      parts.images.push(node.attrs.src)
    if (EMBED_TYPES.has(type)) parts.embeds.push(embedKey(node))
    if (type === 'text') {
      texts.push(node.text ?? '')
      for (const mark of node.marks ?? []) {
        if (mark.type === 'code') parts.inlineCode.push(node.text ?? '')
        if (mark.type === 'link' && typeof mark.attrs?.href === 'string') {
          parts.links.push(mark.attrs.href)
        }
      }
    }
    for (const child of node.content ?? []) visit(child)
  }
  if (body) visit(body as JSONContent)
  parts.text = texts.join(' ')
  return parts
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}...` : s)

function sortedCopy(list: string[]): string[] {
  return [...list].sort()
}

export interface TranslationCheckInput {
  source: { title: string; body: TiptapContent | null }
  result: { title: string; body: TiptapContent | null }
  /** Words never to translate; each one in the source must be in the result. */
  protectedTerms?: readonly string[]
}

export function checkTranslation(input: TranslationCheckInput): TranslationCheckResult {
  const source = partsOf(input.source.body)
  const result = partsOf(input.result.body)
  const problems: TranslationCheckProblem[] = []

  if (!input.result.title.trim() || (source.text.trim() && !result.text.trim())) {
    problems.push({ code: 'empty' })
  }

  if (!sameList(source.codeBlocks, result.codeBlocks)) {
    const changed =
      source.codeBlocks.find((c, i) => result.codeBlocks[i] !== c) ?? source.codeBlocks[0] ?? ''
    problems.push({ code: 'code_block_changed', detail: clip(changed) })
  } else if (!sameList(sortedCopy(source.inlineCode), sortedCopy(result.inlineCode))) {
    const kept = new Set(result.inlineCode)
    const changed = source.inlineCode.find((c) => !kept.has(c)) ?? result.inlineCode[0] ?? ''
    problems.push({ code: 'code_block_changed', detail: clip(changed) })
  }

  const resultLinks = new Set(result.links)
  for (const href of new Set(source.links)) {
    if (!resultLinks.has(href)) problems.push({ code: 'link_missing', detail: clip(href) })
  }
  const resultImages = new Set(result.images)
  for (const src of new Set(source.images)) {
    if (!resultImages.has(src)) problems.push({ code: 'image_missing', detail: clip(src) })
  }
  const resultEmbeds = new Set(result.embeds)
  for (const key of new Set(source.embeds)) {
    if (!resultEmbeds.has(key)) {
      problems.push({ code: 'embed_missing', detail: clip(key.slice(key.indexOf(':') + 1)) })
    }
  }

  if (!sameList(source.headings.map(String), result.headings.map(String))) {
    const outline = (h: number[]) => h.map((l) => `H${l}`).join(' ') || 'none'
    problems.push({
      code: 'headings_changed',
      detail: `${outline(source.headings)} -> ${outline(result.headings)}`,
    })
  }

  const sourceText = `${input.source.title} ${source.text}`
  const resultText = `${input.result.title} ${result.text}`
  for (const term of input.protectedTerms ?? []) {
    if (term && sourceText.includes(term) && !resultText.includes(term)) {
      problems.push({ code: 'term_changed', detail: term })
    }
  }

  return { ok: problems.length === 0, problems }
}
