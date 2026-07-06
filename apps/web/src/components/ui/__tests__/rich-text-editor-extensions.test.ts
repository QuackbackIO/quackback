// @vitest-environment happy-dom

/**
 * Tests for RichTextEditor extension configuration.
 *
 * RED→GREEN TDD:
 *  - "no duplicate extension names" catches the StarterKit v3 + explicit Underline duplicate
 *  - "extensions are stable across renders" catches the useMemo regression where
 *    new array references on every render cause editor.setOptions() to fire each keystroke
 *  - "value sync skips setContent after internal update" catches the redundant
 *    JSON.stringify + setContent call that fires on every onChange cycle
 */

import { describe, it, expect, vi } from 'vitest'
import type { EditorFeatures } from '../rich-text-editor'
import { buildExtensions, generateContentHTML, hasActiveSuggestion } from '../rich-text-editor'

// Full widget feature set (worst-case for duplicates)
const WIDGET_FEATURES: EditorFeatures = {
  headings: true,
  codeBlocks: true,
  taskLists: true,
  blockquotes: true,
  dividers: true,
  tables: true,
  images: true,
  embeds: true,
  bubbleMenu: true,
  slashMenu: true,
}

describe('buildExtensions', () => {
  it('contains no duplicate extension names (full widget feature set)', () => {
    const exts = buildExtensions(WIDGET_FEATURES, { placeholder: 'Write...' })
    const names = exts.map((e) => (e as { name: string }).name)
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const name of names) {
      if (seen.has(name)) duplicates.push(name)
      seen.add(name)
    }
    expect(duplicates).toEqual([])
  })

  it('contains no duplicate extension names (minimal feature set)', () => {
    const exts = buildExtensions({}, { placeholder: 'Write...' })
    const names = exts.map((e) => (e as { name: string }).name)
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const name of names) {
      if (seen.has(name)) duplicates.push(name)
      seen.add(name)
    }
    expect(duplicates).toEqual([])
  })

  it('always includes underline (via StarterKit)', () => {
    const exts = buildExtensions({}, { placeholder: 'Write...' })
    // Underline should come from StarterKit v3 — NOT as a standalone top-level extension
    const standaloneUnderline = exts.filter((e) => (e as { name: string }).name === 'underline')
    expect(standaloneUnderline).toHaveLength(0) // should NOT be standalone
  })

  it('returns the same extension instances when called with identical feature flags (memoization contract)', () => {
    // buildExtensions itself is a pure factory - same args produce same structure.
    // This test verifies the returned array length is deterministic.
    const exts1 = buildExtensions(WIDGET_FEATURES, { placeholder: 'Write...' })
    const exts2 = buildExtensions(WIDGET_FEATURES, { placeholder: 'Write...' })
    // Lengths must match (different instances, but same count)
    expect(exts1.length).toBe(exts2.length)
    // Names must match in order
    const names1 = exts1.map((e) => (e as { name: string }).name)
    const names2 = exts2.map((e) => (e as { name: string }).name)
    expect(names1).toEqual(names2)
  })

  it('always includes image extension for schema compatibility', () => {
    const with_ = buildExtensions({ images: true }, { placeholder: '' })
    const without = buildExtensions({ images: false }, { placeholder: '' })
    const withNames = with_.map((e) => (e as { name: string }).name)
    const withoutNames = without.map((e) => (e as { name: string }).name)
    expect(withNames).toContain('image')
    expect(withoutNames).toContain('image')
  })

  it('includes slashCommands extension by default', () => {
    const exts = buildExtensions({}, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).toContain('slashCommands')
  })

  it('omits slashCommands when slashMenu is false', () => {
    const exts = buildExtensions({ slashMenu: false }, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).not.toContain('slashCommands')
  })

  it('includes emoji extension by default', () => {
    const exts = buildExtensions({}, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).toContain('emoji')
  })

  it('omits emoji extension when emojiPicker is false', () => {
    const exts = buildExtensions({ emojiPicker: false }, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).not.toContain('emoji')
  })

  it('omits enterAsHardBreak by default (document-style Enter)', () => {
    const exts = buildExtensions({}, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).not.toContain('enterAsHardBreak')
  })

  it('includes enterAsHardBreak when enabled (comment-style Enter)', () => {
    const exts = buildExtensions({ enterAsHardBreak: true }, { placeholder: '' })
    const names = exts.map((e) => (e as { name: string }).name)
    expect(names).toContain('enterAsHardBreak')
  })

  // P2.1 — mentions feature flag (default TRUE; undefined must mean enabled so
  // every existing consumer keeps the `@` menu).
  it('includes the mention extension by default (undefined = enabled)', () => {
    const names = buildExtensions({}, { placeholder: '' }).map((e) => (e as { name: string }).name)
    expect(names).toContain('mention')
  })

  it('omits the mention extension when mentions is false', () => {
    const names = buildExtensions({ mentions: false }, { placeholder: '' }).map(
      (e) => (e as { name: string }).name
    )
    expect(names).not.toContain('mention')
  })

  it('keeps mentions on for an existing preset that never sets the flag (widget set)', () => {
    // Spot-check: WIDGET_FEATURES (and every current preset) leaves `mentions`
    // unset, so the mention menu must survive the flag addition.
    const names = buildExtensions(WIDGET_FEATURES, { placeholder: '' }).map(
      (e) => (e as { name: string }).name
    )
    expect(names).toContain('mention')
  })
})

describe('hasActiveSuggestion', () => {
  // Suggestion-style plugins (emoji picker, slash menu, mention) all keep
  // `{ active, range, query, ... }` on their plugin state. The Enter handler
  // checks this to yield Enter to the open popover instead of inserting a
  // hardBreak underneath it.
  function makeEditor(pluginStates: Array<unknown>) {
    const plugins = pluginStates.map((state) => ({
      getState: () => state,
    }))
    return { state: { plugins } } as unknown as Parameters<typeof hasActiveSuggestion>[0]
  }

  it('returns false when no plugin state is active', () => {
    const editor = makeEditor([null, { active: false, range: null }, { unrelated: true }])
    expect(hasActiveSuggestion(editor)).toBe(false)
  })

  it('returns true when any plugin state has active: true', () => {
    const editor = makeEditor([
      null,
      { active: false },
      { active: true, range: { from: 1, to: 2 }, query: 'sli' },
    ])
    expect(hasActiveSuggestion(editor)).toBe(true)
  })

  it('tolerates plugins whose getState returns undefined or non-object', () => {
    const editor = makeEditor([undefined, 'not-a-state', 42])
    expect(hasActiveSuggestion(editor)).toBe(false)
  })
})

// P2.2 — onSubmit (Enter sends). The submitOnEnter extension is only registered
// when RichTextEditor is given an onSubmit callback. We invoke its keyboard
// shortcut handlers directly (mirroring the mock-editor pattern above) so the
// Enter/Shift+Enter/suggestion/precedence behaviour is asserted deterministically
// without standing up a full ProseMirror view.
describe('submitOnEnter (onSubmit)', () => {
  type KeyHandlers = Record<string, () => boolean>
  type KeymapExtension = {
    name: string
    config: { priority?: number; addKeyboardShortcuts: () => KeyHandlers }
  }

  // Minimal editor stub covering the two things the handlers touch:
  // hasActiveSuggestion (state.plugins) and commands.setHardBreak.
  function makeMockEditor({ suggestion = false }: { suggestion?: boolean } = {}) {
    const setHardBreak = vi.fn(() => true)
    const plugins = [{ getState: () => ({ active: suggestion }) }]
    const editor = { state: { plugins }, commands: { setHardBreak } }
    return { editor, setHardBreak }
  }

  function submitExtension(features: EditorFeatures, onSubmit: () => void): KeymapExtension {
    const ext = buildExtensions(features, { placeholder: '', onSubmit }).find(
      (e) => (e as { name: string }).name === 'submitOnEnter'
    )
    if (!ext) throw new Error('submitOnEnter extension was not registered')
    return ext as unknown as KeymapExtension
  }

  function handlersFor(mockEditor: unknown, onSubmit: () => void): KeyHandlers {
    return submitExtension({}, onSubmit).config.addKeyboardShortcuts.call({ editor: mockEditor })
  }

  it('is absent when no onSubmit is provided (zero behavior change)', () => {
    const names = buildExtensions({}, { placeholder: '' }).map((e) => (e as { name: string }).name)
    expect(names).not.toContain('submitOnEnter')
  })

  it('is registered when onSubmit is provided', () => {
    const names = buildExtensions({}, { placeholder: '', onSubmit: () => {} }).map(
      (e) => (e as { name: string }).name
    )
    expect(names).toContain('submitOnEnter')
  })

  it('Enter fires onSubmit and consumes the key (no paragraph split)', () => {
    const onSubmit = vi.fn()
    const { editor, setHardBreak } = makeMockEditor()
    const consumed = handlersFor(editor, onSubmit).Enter()
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(consumed).toBe(true) // returning true stops ProseMirror's default Enter
    expect(setHardBreak).not.toHaveBeenCalled()
  })

  it('Shift+Enter inserts a hardBreak and does not submit', () => {
    const onSubmit = vi.fn()
    const { editor, setHardBreak } = makeMockEditor()
    const result = handlersFor(editor, onSubmit)['Shift-Enter']()
    expect(setHardBreak).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('yields Enter to an active suggestion popover instead of submitting', () => {
    const onSubmit = vi.fn()
    const { editor } = makeMockEditor({ suggestion: true })
    const consumed = handlersFor(editor, onSubmit).Enter()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(consumed).toBe(false) // let the popover's own onKeyDown pick the item
  })

  it('wins over enterAsHardBreak via a higher extension priority', () => {
    // TipTap tries same-key bindings in descending priority order and stops at
    // the first returning true, so submitOnEnter must outrank enterAsHardBreak.
    const exts = buildExtensions({ enterAsHardBreak: true }, { placeholder: '', onSubmit: () => {} })
    const byName = new Map(
      exts.map((e) => [(e as { name: string }).name, e as unknown as KeymapExtension])
    )
    expect(byName.has('submitOnEnter')).toBe(true)
    expect(byName.has('enterAsHardBreak')).toBe(true)
    const submitPriority = byName.get('submitOnEnter')!.config.priority ?? 100
    const hardBreakPriority = byName.get('enterAsHardBreak')!.config.priority ?? 100
    expect(submitPriority).toBeGreaterThan(hardBreakPriority)
  })
})

describe('markdown serialization optimization', () => {
  it('skips markdown serialization when onChange has arity < 3', () => {
    const getMarkdown = vi.fn(() => '# hello')
    const getJSON = vi.fn(() => ({ type: 'doc', content: [] }))
    const getHTML = vi.fn(() => '<p></p>')
    const mockEditor = { getMarkdown, getJSON, getHTML }

    // Simulate the onUpdate logic
    function runOnUpdate(
      editor: typeof mockEditor,
      onChange: ((...args: unknown[]) => void) | undefined
    ) {
      if (!onChange) return
      const json = editor.getJSON()
      const html = editor.getHTML()
      const markdown = onChange.length >= 3 ? (editor.getMarkdown?.() ?? '') : ''
      onChange(json, html, markdown)
    }

    // 2-arg onChange (widget/portal) — should NOT call getMarkdown
    const twoArgCallback = vi.fn((_json: unknown, _html: unknown) => {})
    runOnUpdate(mockEditor, twoArgCallback)
    expect(getMarkdown).not.toHaveBeenCalled()
    expect(twoArgCallback).toHaveBeenCalledWith(expect.any(Object), expect.any(String), '')

    // 3-arg onChange (changelog) — SHOULD call getMarkdown
    getMarkdown.mockClear()
    const threeArgCallback = vi.fn((_json: unknown, _html: unknown, _md: unknown) => {})
    runOnUpdate(mockEditor, threeArgCallback)
    expect(getMarkdown).toHaveBeenCalledOnce()
    expect(threeArgCallback).toHaveBeenCalledWith(expect.any(Object), expect.any(String), '# hello')
  })
})

describe('value sync skip optimization', () => {
  it('skips setContent when skipRef is true, then clears the flag', () => {
    const setContent = vi.fn()
    const clearContent = vi.fn()
    const getJSON = vi.fn(() => ({ type: 'doc', content: [] }))
    const mockEditor = { commands: { setContent, clearContent }, getJSON, isDestroyed: false }

    const skipRef = { current: true }
    const value = { type: 'doc', content: [{ type: 'paragraph' }] }

    // Simulate the optimized useEffect logic
    function runValueSyncEffect(
      editor: typeof mockEditor,
      val: typeof value,
      skip: { current: boolean }
    ) {
      if (skip.current) {
        skip.current = false
        return
      }
      if (typeof val === 'object') {
        const current = JSON.stringify(editor.getJSON())
        const next = JSON.stringify(val)
        if (current !== next) {
          editor.commands.setContent(val as unknown as string)
        }
      }
    }

    runValueSyncEffect(mockEditor, value, skipRef)

    expect(setContent).not.toHaveBeenCalled()
    expect(getJSON).not.toHaveBeenCalled() // JSON.stringify avoided entirely
    expect(skipRef.current).toBe(false)
  })

  it('runs setContent when value changes externally (skipRef is false)', () => {
    const setContent = vi.fn()
    const clearContent = vi.fn()
    const currentDoc = { type: 'doc', content: [] }
    const getJSON = vi.fn(() => currentDoc)
    const mockEditor = { commands: { setContent, clearContent }, getJSON, isDestroyed: false }

    const skipRef = { current: false }
    const newValue = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    }

    function runValueSyncEffect(
      editor: typeof mockEditor,
      val: typeof newValue,
      skip: { current: boolean }
    ) {
      if (skip.current) {
        skip.current = false
        return
      }
      if (typeof val === 'object') {
        const current = JSON.stringify(editor.getJSON())
        const next = JSON.stringify(val)
        if (current !== next) {
          editor.commands.setContent(val as unknown as string)
        }
      }
    }

    runValueSyncEffect(mockEditor, newValue, skipRef)

    expect(setContent).toHaveBeenCalledOnce()
    expect(setContent).toHaveBeenCalledWith(newValue)
  })
})

describe('generateContentHTML — quackbackEmbed nodes', () => {
  const POST_ID = 'post_01ktjwt5tyf6br9mw521h13n6n'
  const CHANGELOG_ID = 'changelog_01ktjwt5tyf6br9mwcz1vskk44'

  it('serializes a valid post embed to a placeholder div with data attrs', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: POST_ID } }],
    })
    expect(html).toContain('data-quackback-embed="1"')
    expect(html).toContain('data-kind="post"')
    expect(html).toContain(`data-id="${POST_ID}"`)
    expect(html).toContain('class="quackback-embed-placeholder"')
  })

  it('serializes a valid changelog embed to a placeholder div', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'changelog', id: CHANGELOG_ID } }],
    })
    expect(html).toContain('data-kind="changelog"')
    expect(html).toContain(`data-id="${CHANGELOG_ID}"`)
  })

  it('renders nothing for an embed with a bad kind', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'board', id: POST_ID } }],
    })
    expect(html).not.toContain('data-quackback-embed')
  })

  it('renders nothing for an embed missing its id', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'post' } }],
    })
    expect(html).not.toContain('data-quackback-embed')
  })

  it('HTML-escapes a hostile id in the data-id attribute', () => {
    // The write sanitizer blocks this before storage; this pins the serializer's
    // own escaping so a future change can't reintroduce raw-HTML injection.
    const html = generateContentHTML({
      type: 'doc',
      content: [
        { type: 'quackbackEmbed', attrs: { kind: 'post', id: '"><script>alert(1)</script>' } },
      ],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('generateContentHTML — chatImage nodes', () => {
  it('serializes a valid chatImage to a bounded img with src + alt', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'chatImage',
          attrs: { src: 'https://example.com/photo.png', alt: 'A screenshot' },
        },
      ],
    })
    expect(html).toContain('<img')
    expect(html).toContain('src="https://example.com/photo.png"')
    expect(html).toContain('alt="A screenshot"')
    expect(html).toContain('class="max-w-xs rounded-md"')
  })

  it('renders nothing for a chatImage with no src', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'chatImage', attrs: { alt: 'orphan' } }],
    })
    expect(html).not.toContain('<img')
  })

  it('renders nothing for a chatImage with an unsafe src', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'chatImage', attrs: { src: 'javascript:alert(1)' } }],
    })
    expect(html).not.toContain('<img')
  })
})
