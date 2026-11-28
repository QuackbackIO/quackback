import { describe, expect, it } from 'vitest'
import type { TiptapContent } from '@/lib/server/db'
import { checkTranslation } from '../help-center-translation-checks'
import { prepareTranslationText, restoreTranslationText } from '../help-center-translation-text'

const text = (t: string, marks?: unknown[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
})
const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const h = (level: number, t: string) => ({ type: 'heading', attrs: { level }, content: [text(t)] })
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as TiptapContent

const link = (t: string, href: string) => text(t, [{ type: 'link', attrs: { href } }])
const code = (t: string) => text(t, [{ type: 'code' }])
const codeBlock = (t: string) => ({
  type: 'codeBlock',
  attrs: { language: 'bash' },
  content: [text(t)],
})
const image = (src: string, alt = 'Screen') => ({ type: 'image', attrs: { src, alt } })
const embed = (src: string) => ({ type: 'youtube', attrs: { src } })
const table = (cell: string) => ({
  type: 'table',
  content: [
    {
      type: 'tableRow',
      content: [{ type: 'tableHeader', content: [p(text(cell))] }],
    },
    {
      type: 'tableRow',
      content: [{ type: 'tableCell', content: [p(code('qb sync'))] }],
    },
  ],
})

const source = doc(
  h(2, 'Install'),
  p(
    text('Open '),
    link('settings', 'https://example.com/settings'),
    text(' and run '),
    code('qb init')
  ),
  codeBlock('curl https://example.com/api'),
  image('https://cdn.example.com/a.png'),
  embed('https://www.youtube.com/embed/abc'),
  table('Command'),
  h(3, 'Done')
)

const translated = doc(
  h(2, 'Installieren'),
  p(
    text('Öffne '),
    link('Einstellungen', 'https://example.com/settings'),
    text(' und führe '),
    code('qb init')
  ),
  codeBlock('curl https://example.com/api'),
  image('https://cdn.example.com/a.png', 'Bildschirm'),
  embed('https://www.youtube.com/embed/abc'),
  table('Befehl'),
  h(3, 'Fertig')
)

const check = (result: TiptapContent, title = 'Installieren', protectedTerms?: string[]) =>
  checkTranslation({
    source: { title: 'Install Quackback', body: source },
    result: { title, body: result },
    protectedTerms,
  })

describe('checkTranslation', () => {
  it('passes a translation that keeps code, targets, embeds, tables and headings', () => {
    expect(check(translated)).toEqual({ ok: true, problems: [] })
  })

  it('finds a changed code block, and changed inline code', () => {
    const changedBlock = structuredClone(translated) as { content: unknown[] }
    changedBlock.content[2] = codeBlock('curl https://example.com/api-de')
    expect(check(changedBlock as TiptapContent).problems).toEqual([
      { code: 'code_block_changed', detail: 'curl https://example.com/api' },
    ])
    const changedInline = structuredClone(translated) as { content: unknown[] }
    changedInline.content[5] = table('Befehl')
    ;(changedInline.content[1] as { content: unknown[] }).content[3] = code('qb starten')
    expect(check(changedInline as TiptapContent).problems).toEqual([
      { code: 'code_block_changed', detail: 'qb init' },
    ])
  })

  it('finds a lost link, image and embed', () => {
    const lost = doc(
      h(2, 'Installieren'),
      p(text('Öffne die Einstellungen und führe '), code('qb init')),
      codeBlock('curl https://example.com/api'),
      table('Befehl'),
      h(3, 'Fertig')
    )
    expect(check(lost).problems.map((p) => p.code)).toEqual([
      'link_missing',
      'image_missing',
      'embed_missing',
    ])
  })

  it('finds changed headings and an empty result', () => {
    const flat = structuredClone(translated) as { content: unknown[] }
    flat.content[6] = h(2, 'Fertig')
    expect(check(flat as TiptapContent).problems).toEqual([
      { code: 'headings_changed', detail: 'H2 H3 -> H2 H2' },
    ])
    expect(check(translated, '  ').problems).toEqual([{ code: 'empty' }])
  })

  it('finds a never-translate word that went missing', () => {
    expect(check(translated, 'Installieren', ['Quackback']).problems).toEqual([
      { code: 'term_changed', detail: 'Quackback' },
    ])
    expect(check(translated, 'Quackback installieren', ['Quackback']).ok).toBe(true)
  })
})

describe('the text the model translates', () => {
  it('hides code, targets and rich nodes, and a faithful answer comes back whole', () => {
    const prepared = prepareTranslationText(source)
    expect(prepared.markdown).not.toContain('example.com')
    expect(prepared.markdown).not.toContain('qb init')
    expect(prepared.markdown).not.toContain('youtube')
    expect(prepared.markdown).toContain('Open')

    const answer = prepared.markdown.replace('Install', 'Installieren').replace('Command', 'Befehl')
    const restored = restoreTranslationText(answer, prepared)
    const result = checkTranslation({
      source: { title: 'Install', body: source },
      result: { title: 'Installieren', body: restored.contentJson },
    })
    expect(result).toEqual({ ok: true, problems: [] })
    expect(JSON.stringify(restored.contentJson)).toContain('"type":"youtube"')
    expect(JSON.stringify(restored.contentJson)).toContain('"type":"table"')
  })

  it('a token the model dropped shows up in the checks', () => {
    const prepared = prepareTranslationText(source)
    const answer = prepared.markdown.replace(/⟦N\d+⟧/, '').replace(/\(⟦U\d+⟧\)/, '(⟦U99⟧)')
    const restored = restoreTranslationText(answer, prepared)
    const result = checkTranslation({
      source: { title: 'Install', body: source },
      result: { title: 'Installieren', body: restored.contentJson },
    })
    expect(result.problems.map((p) => p.code)).toEqual(['link_missing', 'embed_missing'])
  })
})
