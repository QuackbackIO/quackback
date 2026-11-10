/**
 * Held-out cases for overrides, written after the contract: an element's look
 * for one part ("just this button"), one page, one Home block, phones and a
 * state, and rich words and headlines that keep their alignment and colours
 * when rewritten. Each is judged by its rule: the look lands at its scope and
 * nowhere wider, and nothing else changes.
 */
import type { PortalDesign } from '@/lib/shared/design/schema'
import { findOverride } from '@/lib/shared/design/style-overrides'
import type { WordsDoc, WordsNode } from '@/lib/shared/design/rich-words'
import type { EvalCase } from './cases'

type Look = Record<string, Record<string, unknown> | undefined> | undefined
const valueOf = (look: Look, state: string, prop: string) => look?.[state]?.[prop]
const own = (d: PortalDesign, id: string, layer: 'style' | 'styleDark' | 'phone' = 'style') =>
  findOverride(d, id)?.[layer] as Look
const blockOf = (d: PortalDesign, id: string) => d.pages.home.blocks.find((b) => b.id === id)

const BLACK = ['black', 'ink', '#000000', '#111111', '#0a0a0a']
const isBlack = (v: unknown) => BLACK.includes(String(v).toLowerCase())
/** Nothing set for every one of the element: the change stayed where it was asked. */
const noWider = (d: PortalDesign, element: string) =>
  !(d.style as Record<string, unknown> | undefined)?.[element]

const OVERRIDES = ['overrides']

/** A Welcome block with a centred heading and words in the second colour. */
const styledWelcome = (d: PortalDesign) => {
  const welcome = blockOf(d, 'welcome001') as { body: unknown }
  welcome.body = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, textAlign: 'center' },
        content: [{ type: 'text', text: 'Welcome' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Tell us ' },
          {
            type: 'text',
            text: 'what to build',
            marks: [{ type: 'colour', attrs: { role: 'support' } }],
          },
          { type: 'text', text: ' next.' },
        ],
      },
    ],
  }
}
const welcomeBody = (d: PortalDesign) => (blockOf(d, 'welcome001') as { body: WordsDoc }).body
const textOf = (node: WordsNode | undefined): string =>
  node?.type === 'text' ? (node.text ?? '') : (node?.content ?? []).map(textOf).join('')
/** The words coloured in a role, joined. */
const colouredIn = (doc: WordsDoc, role: string) => {
  const out: string[] = []
  const walk = (node: WordsNode) => {
    if (
      node.type === 'text' &&
      node.marks?.some((m) => m.type === 'colour' && m.attrs?.role === role)
    )
      out.push(node.text ?? '')
    node.content?.forEach(walk)
  }
  ;(doc.content ?? []).forEach(walk)
  return out.join('').trim()
}
const headingCentred = (doc: WordsDoc) =>
  doc.content?.some(
    (n) => n.type === 'heading' && n.attrs?.textAlign === 'center' && textOf(n).includes('Welcome')
  ) ?? false

const ACCENTED = 'Help shape what Acme grows into'
const accentedHeadline =
  (colour?: 'support') =>
  (d: PortalDesign): void => {
    d.pages.home.headline = {
      title: { en: ACCENTED },
      subtitle: {},
      accent: { style: 'colour', text: { en: 'Acme' }, ...(colour ? { colour } : {}) },
    }
  }

export const OVERRIDE_CASES: EvalCase[] = [
  {
    name: 'override part: just this button, picked',
    request: 'Make just this button black',
    picked: { scope: 'band', element: { element: 'button', part: 'hero.home.cta' } },
    ops: [
      {
        op: 'override',
        target: 'part:hero.home.cta',
        key: 'button.base.background',
        value: 'black',
      },
    ],
    check: (d) =>
      isBlack(valueOf(own(d, 'part:hero.home.cta:button'), 'base', 'background')) &&
      noWider(d, 'button'),
    touches: OVERRIDES,
  },
  {
    name: 'override part: the hero’s call to action, named',
    request: "Make the hero's call to action black but leave the other buttons",
    ops: [
      {
        op: 'override',
        target: 'part:hero.home.cta',
        key: 'button.base.background',
        value: 'black',
      },
    ],
    check: (d) =>
      isBlack(valueOf(own(d, 'part:hero.home.cta:button'), 'base', 'background')) &&
      noWider(d, 'button'),
    touches: OVERRIDES,
  },
  {
    name: 'override part: picked headline bigger',
    request: 'Make this one bigger, 60px',
    picked: { scope: 'band', element: { element: 'headline', part: 'hero.home.headline' } },
    ops: [{ op: 'override', target: 'part:hero.home.headline', key: 'size', value: '60' }],
    check: (d) =>
      valueOf(own(d, 'part:hero.home.headline:headline'), 'base', 'size') === 60 &&
      noWider(d, 'headline'),
    touches: OVERRIDES,
  },
  {
    name: 'override page: round buttons on the roadmap only',
    request: 'Only on the roadmap page, make the buttons fully round',
    ops: [{ op: 'override', target: 'page:roadmap', key: 'button.base.radius', value: '999' }],
    check: (d) => {
      const r = valueOf(own(d, 'page:roadmap:button'), 'base', 'radius')
      return typeof r === 'number' && r >= 99 && noWider(d, 'button')
    },
    touches: OVERRIDES,
  },
  {
    name: 'override page: lifted cards on the changelog',
    request: 'Give the cards on the changelog a lifted shadow, just there',
    ops: [{ op: 'override', target: 'page:changelog', key: 'card.base.shadow', value: 'lifted' }],
    check: (d) =>
      valueOf(own(d, 'page:changelog:card'), 'base', 'shadow') === 'lifted' && noWider(d, 'card'),
    touches: OVERRIDES,
  },
  {
    name: 'override block: this block’s heading in the second colour',
    request: "This block's heading in the second colour",
    picked: { scope: 'home', blockId: 'updates001' },
    ops: [{ op: 'set', target: 'updates001', key: 'style.heading.base.color', value: 'support' }],
    check: (d) =>
      valueOf(
        (blockOf(d, 'updates001')?.look?.style as Record<string, Look> | undefined)?.heading,
        'base',
        'color'
      ) === 'support' ||
      valueOf(own(d, 'part:block.updates001.heading:heading'), 'base', 'color') === 'support',
    touches: ['pages.home.blocks', 'overrides'],
  },
  {
    name: 'override phone: smaller headline on phones',
    request: 'On phones, make the headline smaller, about 32px',
    ops: [{ op: 'override', target: 'everywhere', key: 'phone.headline.base.size', value: '32' }],
    check: (d) => {
      const size =
        d.stylePhone?.headline?.base?.size ??
        valueOf(own(d, 'part:hero.home.headline:headline', 'phone'), 'base', 'size')
      return typeof size === 'number' && size >= 24 && size <= 36 && noWider(d, 'headline')
    },
    touches: ['stylePhone', 'overrides'],
  },
  {
    name: 'override phone: taller buttons on mobile',
    request: 'Make the buttons 48px tall on mobile',
    ops: [{ op: 'override', target: 'everywhere', key: 'phone.button.base.height', value: '48' }],
    check: (d) => d.stylePhone?.button?.base?.height === 48 && noWider(d, 'button'),
    touches: ['stylePhone'],
  },
  {
    name: 'override state: black hover on the feedback page',
    request: 'Only on the feedback page, buttons should go black on hover',
    ops: [
      {
        op: 'override',
        target: 'page:feedback',
        key: 'button.hover.background',
        value: 'black',
      },
    ],
    check: (d) =>
      isBlack(valueOf(own(d, 'page:feedback:button'), 'hover', 'background')) &&
      noWider(d, 'button'),
    touches: OVERRIDES,
  },
  {
    name: 'override state: picked button darker on hover',
    request: 'Give just this one a fill of #1e1b4b when hovered',
    picked: { scope: 'band', element: { element: 'button', part: 'hero.home.cta' } },
    ops: [
      {
        op: 'override',
        target: 'part:hero.home.cta',
        key: 'hover.background',
        value: '#1e1b4b',
      },
    ],
    check: (d) =>
      valueOf(own(d, 'part:hero.home.cta:button'), 'hover', 'background') === '#1e1b4b' &&
      noWider(d, 'button'),
    touches: OVERRIDES,
  },
  {
    name: 'words markup: a rewrite keeps alignment and colour',
    request: 'In the welcome text, change "next" to "this year"',
    fixture: styledWelcome,
    ops: [
      {
        op: 'set',
        target: 'welcome001',
        key: 'body',
        value: '## Welcome {center}\n\nTell us [what to build]{support} this year.',
      },
    ],
    check: (d) => {
      const body = welcomeBody(d)
      return (
        headingCentred(body) &&
        colouredIn(body, 'support') === 'what to build' &&
        textOf(body.content?.[1]) === 'Tell us what to build this year.'
      )
    },
    touches: ['pages.home.blocks'],
  },
  {
    name: 'words markup: centre the welcome',
    request: 'Centre the welcome text',
    fixture: styledWelcome,
    ops: [
      {
        op: 'set',
        target: 'welcome001',
        key: 'body',
        value: '## Welcome {center}\n\nTell us [what to build]{support} next. {center}',
      },
    ],
    check: (d) => {
      const body = welcomeBody(d)
      return (
        headingCentred(body) &&
        body.content?.[1]?.attrs?.textAlign === 'center' &&
        colouredIn(body, 'support') === 'what to build'
      )
    },
    touches: ['pages.home.blocks'],
  },
  {
    name: 'words markup: colour words in the welcome',
    request: 'Put "next" in the brand colour in the welcome text',
    fixture: styledWelcome,
    ops: [
      {
        op: 'set',
        target: 'welcome001',
        key: 'body',
        value: '## Welcome {center}\n\nTell us [what to build]{support} [next]{accent}.',
      },
    ],
    check: (d) => {
      const body = welcomeBody(d)
      return (
        headingCentred(body) &&
        colouredIn(body, 'accent') === 'next' &&
        colouredIn(body, 'support') === 'what to build'
      )
    },
    touches: ['pages.home.blocks'],
  },
  {
    name: 'words markup: the headline accent in the second colour',
    request: 'Make the accent in the headline use our second colour',
    fixture: accentedHeadline(),
    ops: [
      {
        op: 'words',
        target: 'home',
        key: 'title',
        value: 'Help shape what [Acme]{accent:support} grows into',
      },
    ],
    check: (d) => {
      const h = d.pages.home.headline
      return (
        h?.title.en === ACCENTED && h.accent?.text.en === 'Acme' && h.accent.colour === 'support'
      )
    },
    touches: ['pages.home.headline'],
  },
  {
    name: 'words markup: a new headline keeps the accent’s colour',
    request: 'Change the headline to "Help shape what Acme becomes", keeping Acme as the accent',
    fixture: accentedHeadline('support'),
    ops: [
      {
        op: 'words',
        target: 'home',
        key: 'title',
        value: 'Help shape what [Acme]{accent:support} becomes',
      },
    ],
    check: (d) => {
      const h = d.pages.home.headline
      return (
        h?.title.en === 'Help shape what Acme becomes' &&
        h.accent?.text.en === 'Acme' &&
        h.accent.colour === 'support'
      )
    },
    touches: ['pages.home.headline'],
  },
]
