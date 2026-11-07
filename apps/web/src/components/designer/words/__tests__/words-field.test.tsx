// @vitest-environment happy-dom
/**
 * The words editor in the panel: the format bar shows on a selection with
 * only the marks the words allow, Enter keeps a line, Escape puts back what
 * was there, a quiet count shows near the limit, and the other languages
 * show as a hint.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import {
  docText,
  headlineDoc,
  headlineFromDoc,
  plainDoc,
  readRichMarkdown,
  type WordsDoc,
  type WordsKind,
} from '@/lib/shared/design/rich-words'
import { WordsField } from '../words-field'
import { resetWordsMore, WordsBubble } from '../words-bubble'
import type { WordsRole } from '@/lib/shared/design/colour-roles'
import { pressKey, retype, selectWords, typeWords, wordsEditor } from './words-test-utils'
import type { WordsState } from '@/lib/shared/words-editor/extensions'

afterEach(() => {
  cleanup()
  resetWordsMore()
})

const ROLES: WordsRole[] = [
  { role: 'accent', name: 'Brand colour', colour: '#2255ff' },
  { role: 'support', name: 'Second colour', colour: '#ffcc00' },
]

function Harness({
  kind,
  start,
  onChange,
  limit,
  elsewhere,
  roles,
}: {
  kind: WordsKind
  roles?: WordsRole[]
  start: WordsDoc
  onChange?: (doc: WordsDoc) => void
  limit?: number
  elsewhere?: Array<{ locale: string; text: string }>
}) {
  const [value, setValue] = useState(start)
  return (
    <WordsField
      label="Words"
      kind={kind}
      value={value}
      limit={limit}
      elsewhere={elsewhere}
      roles={roles}
      onChange={(doc) => {
        setValue(doc)
        onChange?.(doc)
      }}
    />
  )
}

const rich = (text: string) => {
  const read = readRichMarkdown(text)
  if (!read.ok) throw new Error(read.refusal)
  return read.doc
}

describe('the format bar', () => {
  it('offers Accent, Highlight and Lighter on a headline, and nothing else', async () => {
    render(
      <Harness kind="headline" start={headlineDoc({ title: 'Help shape Acme', accent: null })} />
    )
    const editor = await wordsEditor('Words')
    expect(screen.queryByRole('toolbar')).toBeNull()
    selectWords(editor, 'Acme')
    const bar = await screen.findByRole('toolbar', { name: 'Set words apart' })
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Accent', 'Highlight', 'Lighter'])
  })

  it('offers bold, italic, a link and lists on rich words', async () => {
    render(<Harness kind="rich" start={rich('Hello there')} />)
    const editor = await wordsEditor('Words')
    selectWords(editor, 'Hello')
    const bar = await screen.findByRole('toolbar', { name: 'Format words' })
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Bold', 'Italic', 'Link', 'Bulleted list', 'Numbered list', 'More'])
  })

  it('shows no bar for plain words', async () => {
    render(<Harness kind="plain" start={plainDoc('Top posts')} />)
    selectWords(await wordsEditor('Words'), 'Top')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('moves the one phrase of a headline, and says which look is on', async () => {
    const onChange = vi.fn()
    render(
      <Harness
        kind="headline"
        onChange={onChange}
        start={headlineDoc({ title: 'Help shape Acme', accent: { text: 'Acme', style: 'colour' } })}
      />
    )
    const editor = await wordsEditor('Words')
    selectWords(editor, 'Help')
    fireEvent.click(await screen.findByRole('button', { name: 'Highlight' }))
    expect(headlineFromDoc(onChange.mock.lastCall![0])).toEqual({
      title: 'Help shape Acme',
      accent: { text: 'Help', style: 'highlight' },
    })
    expect(screen.getByRole('button', { name: 'Highlight' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('links the selected words from the address field', async () => {
    const onChange = vi.fn()
    render(<Harness kind="rich" start={rich('Read the docs')} onChange={onChange} />)
    const editor = await wordsEditor('Words')
    selectWords(editor, 'docs')
    fireEvent.click(await screen.findByRole('button', { name: 'Link' }))
    const field = screen.getByLabelText('Link address')
    fireEvent.change(field, { target: { value: 'nope' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.getByText('A web or email address')).toBeTruthy()
    fireEvent.change(field, { target: { value: 'acme.com/docs' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(JSON.stringify(onChange.mock.lastCall![0])).toContain('https://acme.com/docs')
  })

  it('opens the address field on Mod-K', async () => {
    render(<Harness kind="rich" start={rich('Read the docs')} />)
    const editor = await wordsEditor('Words')
    selectWords(editor, 'docs')
    pressKey(editor, 'k', { ctrlKey: true })
    expect(await screen.findByLabelText('Link address')).toBeTruthy()
  })
})

describe('keys', () => {
  it('puts back what was there on Escape', async () => {
    const onChange = vi.fn()
    render(<Harness kind="plain" start={plainDoc('Top posts')} onChange={onChange} />)
    const editor = await wordsEditor('Words')
    retype(editor, 'Loved')
    expect(docText(onChange.mock.lastCall![0])).toBe('Loved')
    pressKey(editor, 'Escape')
    expect(docText(onChange.mock.lastCall![0])).toBe('Top posts')
  })

  it('keeps a line on Enter, with no second line', async () => {
    const onChange = vi.fn()
    render(<Harness kind="plain" start={plainDoc('Top')} onChange={onChange} />)
    const editor = await wordsEditor('Words')
    editor.commands.focus('end')
    pressKey(editor, 'Enter')
    typeWords(editor, ' posts')
    expect(editor.getJSON().content).toHaveLength(1)
    expect(editor.getText()).toBe('Top posts')
  })
})

describe('limits and languages', () => {
  it('shows a quiet count only near the limit', async () => {
    render(<Harness kind="plain" start={plainDoc('abc')} limit={10} />)
    const editor = await wordsEditor('Words')
    expect(document.querySelector('[data-words-count]')).toBeNull()
    retype(editor, 'abcdefghi')
    expect(document.querySelector('[data-words-count]')?.textContent).toBe('9/10')
  })

  it('shows the same words in the other languages as a hint', async () => {
    render(
      <Harness
        kind="plain"
        start={plainDoc('')}
        elsewhere={[{ locale: 'de', text: 'Beliebte Ideen' }]}
      />
    )
    expect(await screen.findByText(/German: “Beliebte Ideen”/)).toBeTruthy()
  })
})

describe('the bar alone', () => {
  const base: WordsState = {
    kind: 'headline',
    selected: true,
    selectedLength: 80,
    accent: null,
    accentElsewhere: false,
    bold: false,
    italic: false,
    link: null,
    bulletList: false,
    orderedList: false,
    heading: 0,
    align: 'start',
    colour: null,
    accentColour: null,
    length: 80,
    limit: 280,
  }

  it('keeps a phrase over 60 characters from being set apart', () => {
    render(<WordsBubble state={base} onCommand={vi.fn()} onReturn={vi.fn()} />)
    for (const name of ['Accent', 'Highlight', 'Lighter'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('takes focus when asked, moves along with the arrows and goes back on Escape', () => {
    const onReturn = vi.fn()
    render(
      <WordsBubble
        state={{ ...base, selectedLength: 4 }}
        onCommand={vi.fn()}
        onReturn={onReturn}
        focusOnMount
      />
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accent' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Highlight' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onReturn).toHaveBeenCalled()
  })
})

describe('More in the format bar', () => {
  const names = (bar: HTMLElement) =>
    within(bar)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))

  it('holds headings, alignment and the brand’s colours for rich words, and stays open', async () => {
    const onChange = vi.fn()
    render(<Harness kind="rich" start={rich('Hello there')} onChange={onChange} roles={ROLES} />)
    const editor = await wordsEditor('Words')
    selectWords(editor, 'Hello')
    const bar = await screen.findByRole('toolbar', { name: 'Format words' })
    const more = within(bar).getByRole('button', { name: 'More' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(names(bar).slice(6)).toEqual([
      'Paragraph',
      'Heading 2',
      'Heading 3',
      'Start',
      'Centre',
      'End',
      'Text colour',
      'Brand colour',
      'Second colour',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Second colour' }))
    fireEvent.click(screen.getByRole('button', { name: 'Heading 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Centre' }))
    expect(onChange.mock.lastCall![0].content[0]).toEqual({
      type: 'heading',
      attrs: { level: 2, textAlign: 'center' },
      content: [
        { type: 'text', text: 'Hello', marks: [{ type: 'colour', attrs: { role: 'support' } }] },
        { type: 'text', text: ' there' },
      ],
    })
    expect(screen.getByRole('button', { name: 'Heading 2' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    cleanup()
    render(<Harness kind="rich" start={rich('Again')} roles={ROLES} />)
    selectWords(await wordsEditor('Words'), 'Again')
    expect(await screen.findByRole('button', { name: 'Heading 3' })).toBeTruthy()
  })

  it('picks the colour of a headline’s phrase', async () => {
    const onChange = vi.fn()
    render(
      <Harness
        kind="headline"
        roles={ROLES}
        onChange={onChange}
        start={headlineDoc({ title: 'Help shape Acme', accent: { text: 'Acme', style: 'colour' } })}
      />
    )
    const editor = await wordsEditor('Words')
    selectWords(editor, 'Acme')
    fireEvent.click(await screen.findByRole('button', { name: 'More' }))
    expect(
      screen.getByRole('button', { name: 'Phrase in brand colour' }).getAttribute('aria-pressed')
    ).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Phrase in second colour' }))
    expect(headlineFromDoc(onChange.mock.lastCall![0]).accent).toEqual({
      text: 'Acme',
      style: 'colour',
      colour: 'support',
    })
  })

  it('is not offered on a headline with no phrase set apart, or one colour', async () => {
    render(
      <Harness
        kind="headline"
        roles={ROLES}
        start={headlineDoc({ title: 'Help shape Acme', accent: null })}
      />
    )
    selectWords(await wordsEditor('Words'), 'Acme')
    const bar = await screen.findByRole('toolbar', { name: 'Set words apart' })
    expect(names(bar)).toEqual(['Accent', 'Highlight', 'Lighter'])
  })

  it('keeps headings out of lists', () => {
    render(
      <WordsBubble
        state={{
          kind: 'rich',
          selected: true,
          selectedLength: 4,
          accent: null,
          accentElsewhere: false,
          accentColour: null,
          bold: false,
          italic: false,
          link: null,
          bulletList: true,
          orderedList: false,
          heading: 0,
          align: 'start',
          colour: null,
          length: 4,
          limit: null,
        }}
        roles={ROLES}
        onCommand={vi.fn()}
        onReturn={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect((screen.getByRole('button', { name: 'Heading 2' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})

describe('Typing in a field', () => {
  it('keeps the editor as it is, rather than setting it up again on each change', async () => {
    const changes = vi.fn()
    render(<Harness kind="headline" start={plainDoc('Got an idea?')} onChange={changes} />)
    const editor = await wordsEditor('Words')
    const setOptions = vi.spyOn(editor, 'setOptions')
    selectWords(editor, 'idea')
    typeWords(editor, 'thought')
    typeWords(editor, ' or two')
    expect(changes).toHaveBeenCalled()
    expect(docText(changes.mock.lastCall![0] as WordsDoc)).toBe('Got an thought or two?')
    expect(setOptions).not.toHaveBeenCalled()
  })

  it('makes a new editor for a new kind of words, holding the words as they are then', async () => {
    const { rerender } = render(
      <WordsField label="Words" kind="plain" value={plainDoc('Hello')} onChange={() => {}} />
    )
    const first = await wordsEditor('Words')
    rerender(
      <WordsField label="Words" kind="rich" value={plainDoc('Hello there')} onChange={() => {}} />
    )
    const second = await wordsEditor('Words')
    expect(second).not.toBe(first)
    expect(second.schema.nodes.bulletList).toBeDefined()
    expect(second.getText()).toBe('Hello there')
  })
})
