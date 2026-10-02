// @vitest-environment happy-dom
import { act } from 'react'
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineToolbar, ViewerFile } from '../../types'
import type { FileFamily } from '@/lib/shared/files/file-types'
import { ENGINE_TIMEOUT_MS } from '../budgets'
import { handleHighlightRequest } from '../highlight-lines'
import { GUESS_HIGHLIGHT_CHARS, MAX_HIGHLIGHT_CHARS, type HighlightedLines } from '../text-lines'

/**
 * Stands in for the worker client: answers each request with the real
 * highlighting code on a later task, as the worker would, unless the test
 * holds the answers back, makes the worker fail, or has it answer for
 * different text than it was sent.
 */
class FakeHighlighter {
  static instances: FakeHighlighter[] = []
  static mode: 'answer' | 'hold' | 'fail' | 'extra-line' = 'answer'
  requests: { text: string; language: string | null }[] = []
  terminated = false
  private held: (() => void)[] = []

  constructor() {
    FakeHighlighter.instances.push(this)
  }

  highlight(text: string, language: string | null): Promise<HighlightedLines | null> {
    this.requests.push({ text, language })
    const mode = FakeHighlighter.mode
    return new Promise((resolve, reject) => {
      const answer = () => {
        const answered = mode === 'extra-line' ? `${text}\nextra` : text
        resolve(handleHighlightRequest({ id: 0, text: answered, language }).lines)
      }
      if (mode === 'hold') {
        this.held.push(answer)
        return
      }
      setTimeout(() => {
        if (this.terminated) return
        if (mode === 'fail') reject(new Error('The highlighter failed'))
        else answer()
      }, 0)
    })
  }

  /** Lets held answers through, even once stopped: answers already on their way. */
  release() {
    for (const answer of this.held.splice(0)) answer()
  }

  terminate() {
    this.terminated = true
  }
}

vi.mock('../highlight-worker-client', () => ({
  createCodeHighlighter: () => new FakeHighlighter(),
}))

const { default: TextEngine } = await import('../text-engine')

beforeEach(() => {
  FakeHighlighter.instances = []
  FakeHighlighter.mode = 'answer'
})
afterEach(() => {
  vi.useRealTimers()
})

// happy-dom does no layout. Give the scroll area a 400px viewport and each
// line its 20px, so the virtualizer draws what a browser would.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-index') ? 20 : 400
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  })
})
afterAll(() => {
  if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
  if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth)
})

interface TextOptions {
  name?: string
  family?: FileFamily
  truncated?: boolean
  compact?: boolean
  locale?: string
  messages?: Record<string, string>
}

function renderText(text: string, options: TextOptions = {}) {
  const toolbars: EngineToolbar[] = []
  const onToolbar = vi.fn((t: EngineToolbar) => {
    toolbars.push(t)
  })
  const onError = vi.fn()
  const tree = (
    text: string,
    {
      name = 'notes.txt',
      family = 'text',
      truncated = false,
      compact = false,
      locale = 'en-US',
      messages = {},
    }: TextOptions
  ) => {
    const data = new TextEncoder().encode(text)
    const file: ViewerFile = {
      key: name,
      url: `/api/storage/files/${name}?read=tok`,
      name,
      contentType: 'text/plain',
      size: data.byteLength,
      family,
    }
    return (
      <IntlProvider locale={locale} messages={messages}>
        <TextEngine
          file={file}
          data={data.buffer.slice(0) as ArrayBuffer}
          truncated={truncated}
          src={`${file.url}&proxy=1`}
          onToolbar={onToolbar}
          onError={onError}
          compact={compact}
        />
      </IntlProvider>
    )
  }
  const result = rtlRender(tree(text, options))
  return {
    ...result,
    /** Shows another file in the same engine, as the shell may. */
    showText: (next: string, nextOptions: TextOptions = {}) =>
      result.rerender(tree(next, nextOptions)),
    toolbar: () => toolbars.at(-1)!,
    onError,
  }
}

/** The text of each rendered line, in order. */
function lineTexts(container: HTMLElement) {
  return [...container.querySelectorAll('[data-line-text]')].map((el) => el.textContent)
}

describe('TextEngine', () => {
  it('shows each line with its number', () => {
    const { container } = renderText('alpha\nbeta\r\ngamma')
    expect(lineTexts(container)).toEqual(['alpha', 'beta', 'gamma'])
    expect([...container.querySelectorAll('[data-line-number]')].map((n) => n.textContent)).toEqual(
      ['1', '2', '3']
    )
  })

  it('counts the lines a reader sees: a final line break ends the last line', () => {
    const { container, toolbar } = renderText('alpha\nbeta\n')
    expect(toolbar().note).toBe('2 lines')
    expect(lineTexts(container)).toEqual(['alpha', 'beta'])
  })

  it('keeps a blank last line when the file ends in two line breaks, CR or LF', () => {
    const lf = renderText('alpha\n\n')
    expect(lf.toolbar().note).toBe('2 lines')
    expect(lineTexts(lf.container)).toEqual(['alpha', ''])
    lf.unmount()
    const cr = renderText('alpha\rbeta\r')
    expect(cr.toolbar().note).toBe('2 lines')
    expect(lineTexts(cr.container)).toEqual(['alpha', 'beta'])
  })

  it('reports find, wrap and the line count to the shell', () => {
    const { toolbar } = renderText('one\ntwo\nthree')
    expect(toolbar().note).toBe('3 lines')
    expect(toolbar().wrap?.on).toBe(false)
    expect(toolbar().find).toBeDefined()
  })

  it('reports the line count in German when the viewer locale is German', () => {
    const { toolbar } = renderText('one\ntwo\nthree', {
      locale: 'de',
      messages: { 'files.count.lines': '{count, plural, one {# Zeile} other {# Zeilen}}' },
    })
    expect(toolbar().note).toBe('3 Zeilen')
  })

  it('wraps lines when the shell toggles wrap', () => {
    const { container, toolbar } = renderText('a long line')
    const line = () => container.querySelector('[data-line-text]')!
    expect(line()).toHaveClass('whitespace-pre')
    act(() => toolbar().wrap!.toggle())
    expect(toolbar().wrap?.on).toBe(true)
    expect(line()).toHaveClass('whitespace-pre-wrap')
  })

  it('starts wrapped on the narrow widget sheet', () => {
    const { toolbar } = renderText('x', { compact: true })
    expect(toolbar().wrap?.on).toBe(true)
  })

  it('finds every match, steps with Enter and Shift+Enter, and wraps around', async () => {
    const { container, toolbar } = renderText('alpha\nbeta\ngamma\nalphabet\nnone')
    act(() => toolbar().find!.open())
    const input = await screen.findByRole('searchbox', { name: 'Find in file' })
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.change(input, { target: { value: 'ALPHA' } })
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(container.querySelectorAll('mark')).toHaveLength(2)
    const current = () => container.querySelector('mark[data-current]')!.closest('[data-index]')
    expect(current()).toHaveAttribute('data-index', '0')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(current()).toHaveAttribute('data-index', '3')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
  })

  it('says when nothing matches', async () => {
    const { toolbar } = renderText('alpha')
    act(() => toolbar().find!.open())
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Find in file' }), {
      target: { value: 'zeta' },
    })
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('closes the find bar on Escape and keeps Escape from closing the viewer', async () => {
    const { toolbar, container } = renderText('alpha')
    act(() => toolbar().find!.open())
    const input = await screen.findByRole('searchbox', { name: 'Find in file' })
    fireEvent.change(input, { target: { value: 'alp' } })
    const notPrevented = fireEvent.keyDown(input, { key: 'Escape' })
    expect(notPrevented).toBe(false)
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('says when only the head of the file is shown, leaving Download to the header', () => {
    renderText('first lines', { truncated: true })
    expect(screen.getByText('Showing the first 256 KB')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('reports an empty file as empty instead of one blank line', () => {
    const { onError, container } = renderText('')
    expect(onError).toHaveBeenCalledWith('empty')
    expect(container.querySelector('[data-line-text]')).toBeNull()
  })

  it('leaves out the line count for a file it only partly has', () => {
    const { toolbar } = renderText('a\nb', { truncated: true })
    expect(toolbar().note).toBeUndefined()
  })

  it('pretty-prints a whole JSON file without touching its values', () => {
    const { container } = renderText('{"a":1,"b":[1,"x,y"],"e":{},"id":12345678901234567890}', {
      name: 'data.json',
      family: 'code',
    })
    expect(lineTexts(container)).toEqual([
      '{',
      '  "a": 1,',
      '  "b": [',
      '    1,',
      '    "x,y"',
      '  ],',
      '  "e": {},',
      '  "id": 12345678901234567890',
      '}',
    ])
  })

  it('leaves a cut-short JSON file as it came', () => {
    const { container } = renderText('{"a":1,"b":', {
      name: 'data.json',
      family: 'code',
      truncated: true,
    })
    expect(lineTexts(container)).toEqual(['{"a":1,"b":'])
  })

  it('shows code at once, then colours it when the highlighter answers', async () => {
    const { container } = renderText('/* one\ntwo */\nconst a = 1', {
      name: 'app.js',
      family: 'code',
    })
    expect(lineTexts(container)).toEqual(['/* one', 'two */', 'const a = 1'])
    expect(container.querySelector('[class*="hljs-"]')).toBeNull()
    expect(FakeHighlighter.instances[0]!.requests).toEqual([
      { text: '/* one\ntwo */\nconst a = 1', language: 'javascript' },
    ])
    const lines = () => container.querySelectorAll('[data-line-text]')
    await waitFor(() =>
      expect(lines()[1]!.querySelector('.hljs-comment')?.textContent).toBe('two */')
    )
    expect(lines()[2]!.querySelector('.hljs-keyword')?.textContent).toBe('const')
    expect(lineTexts(container)).toEqual(['/* one', 'two */', 'const a = 1'])
  })

  it('marks find matches inside coloured code', async () => {
    const { container, toolbar } = renderText('const alpha = 1', { name: 'app.js', family: 'code' })
    await waitFor(() => expect(container.querySelector('.hljs-keyword')).not.toBeNull())
    act(() => toolbar().find!.open())
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Find in file' }), {
      target: { value: 'nst al' },
    })
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
      'nst',
      ' al',
    ])
    expect(container.querySelector('mark.hljs-keyword')?.textContent).toBe('nst')
  })

  it('sends a whole file up to the cap, and keeps a bigger one plain without a worker', () => {
    const line = 'const a = 1 // note\n'
    const atCap = line.repeat(Math.floor(MAX_HIGHLIGHT_CHARS / line.length)).trimEnd()
    renderText(atCap, { name: 'app.ts', family: 'code' }).unmount()
    expect(FakeHighlighter.instances).toHaveLength(1)
    expect(FakeHighlighter.instances[0]!.requests[0]).toEqual({
      text: atCap,
      language: 'typescript',
    })

    const { container } = renderText(atCap + '\n' + line, { name: 'app.ts', family: 'code' })
    expect(FakeHighlighter.instances).toHaveLength(1)
    expect(container.querySelector('[data-line-text]')?.textContent).toBe('const a = 1 // note')
  })

  it('guesses the language only of a small file with no known extension', () => {
    renderText('FROM node:22\nRUN echo hi', { name: 'Dockerfile', family: 'code' }).unmount()
    expect(FakeHighlighter.instances[0]!.requests[0]!.language).toBeNull()

    renderText('x = 1\n'.repeat(GUESS_HIGHLIGHT_CHARS / 4), { name: 'Dockerfile', family: 'code' })
    expect(FakeHighlighter.instances).toHaveLength(1)
  })

  it('ignores an answer that comes back after the engine moved to another file', async () => {
    FakeHighlighter.mode = 'hold'
    const { container, showText } = renderText('const a = 1', { name: 'a.js', family: 'code' })
    showText('let b = 2', { name: 'b.js', family: 'code' })
    const [first, second] = FakeHighlighter.instances
    expect(first!.terminated).toBe(true)
    expect(second!.requests[0]!.text).toBe('let b = 2')

    await act(async () => second!.release())
    expect(container.querySelector('.hljs-keyword')?.textContent).toBe('let')
    await act(async () => first!.release())
    expect(container.querySelector('.hljs-keyword')?.textContent).toBe('let')
    expect(lineTexts(container)).toEqual(['let b = 2'])
  })

  it('shows the next file plain until its own colours arrive', async () => {
    const { container, showText } = renderText('const a = 1', { name: 'a.js', family: 'code' })
    await waitFor(() => expect(container.querySelector('.hljs-keyword')).not.toBeNull())
    FakeHighlighter.mode = 'hold'
    showText('let b = 2', { name: 'b.js', family: 'code' })
    expect(lineTexts(container)).toEqual(['let b = 2'])
    expect(container.querySelector('[class*="hljs-"]')).toBeNull()
  })

  it('stops the highlighter when the viewer closes', () => {
    FakeHighlighter.mode = 'hold'
    const { unmount } = renderText('const a = 1', { name: 'a.js', family: 'code' })
    expect(FakeHighlighter.instances[0]!.terminated).toBe(false)
    unmount()
    expect(FakeHighlighter.instances[0]!.terminated).toBe(true)
  })

  it('stops a highlighter that takes longer than the budget, leaving the code plain', async () => {
    vi.useFakeTimers()
    FakeHighlighter.mode = 'hold'
    const { container } = renderText('const a = 1', { name: 'a.js', family: 'code' })
    const [highlighter] = FakeHighlighter.instances
    act(() => vi.advanceTimersByTime(ENGINE_TIMEOUT_MS - 1))
    expect(highlighter!.terminated).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(highlighter!.terminated).toBe(true)
    await act(async () => highlighter!.release())
    expect(container.querySelector('[class*="hljs-"]')).toBeNull()
  })

  it('keeps the code plain, with no error, when the highlighter fails', async () => {
    FakeHighlighter.mode = 'fail'
    const { container, onError } = renderText('const a = 1', { name: 'a.js', family: 'code' })
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
    expect(FakeHighlighter.instances[0]!.requests).toHaveLength(1)
    expect(lineTexts(container)).toEqual(['const a = 1'])
    expect(container.querySelector('[class*="hljs-"]')).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('keeps the code plain when the answer has a different number of lines', async () => {
    FakeHighlighter.mode = 'extra-line'
    const { container } = renderText('const a = 1', { name: 'a.js', family: 'code' })
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
    expect(FakeHighlighter.instances[0]!.requests).toHaveLength(1)
    expect(lineTexts(container)).toEqual(['const a = 1'])
    expect(container.querySelector('[class*="hljs-"]')).toBeNull()
  })

  it('leaves plain text unhighlighted, without a worker', () => {
    const { container } = renderText('const a = 1', { name: 'notes.txt' })
    expect(container.querySelector('[class*="hljs-"]')).toBeNull()
    expect(FakeHighlighter.instances).toHaveLength(0)
  })

  it('colours log levels at once, without a worker', () => {
    const { container } = renderText(
      '2026-09-27T14:01:58Z INFO start\n2026-09-27T14:02:01Z WARN slow\n2026-09-27T14:02:02Z ERROR boom',
      { name: 'import.log' }
    )
    expect(container.querySelector('.log-info')?.textContent).toBe('INFO')
    expect(container.querySelector('.log-warn')?.textContent).toBe('WARN')
    expect(container.querySelector('.log-error')?.textContent).toBe('ERROR')
    expect(FakeHighlighter.instances).toHaveLength(0)
  })

  it('renders only the lines in view of a long file', () => {
    const text = Array.from({ length: 50_000 }, (_, i) => `line ${i + 1}`).join('\n')
    const { container, toolbar } = renderText(text, { name: 'big.log' })
    expect(toolbar().note).toBe('50,000 lines')
    const rendered = container.querySelectorAll('[data-line-text]').length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(200)
  })
})
