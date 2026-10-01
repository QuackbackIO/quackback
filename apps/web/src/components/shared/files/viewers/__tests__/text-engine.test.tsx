// @vitest-environment happy-dom
import { act } from 'react'
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import TextEngine from '../text-engine'
import type { EngineToolbar, ViewerFile } from '../../types'
import type { FileFamily } from '@/lib/shared/files/file-types'

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

function renderText(
  text: string,
  {
    name = 'notes.txt',
    family = 'text',
    truncated = false,
    compact = false,
    locale = 'en-US',
    messages = {},
  }: {
    name?: string
    family?: FileFamily
    truncated?: boolean
    compact?: boolean
    locale?: string
    messages?: Record<string, string>
  } = {}
) {
  const data = new TextEncoder().encode(text)
  const file: ViewerFile = {
    key: name,
    url: `/api/storage/files/${name}?read=tok`,
    name,
    contentType: 'text/plain',
    size: data.byteLength,
    family,
  }
  const toolbars: EngineToolbar[] = []
  const onToolbar = vi.fn((t: EngineToolbar) => {
    toolbars.push(t)
  })
  const onError = vi.fn()
  const result = rtlRender(
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
  return { ...result, toolbar: () => toolbars.at(-1)!, onError }
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

  it('highlights code by its extension, across multi-line comments', () => {
    const { container } = renderText('/* one\ntwo */\nconst a = 1', {
      name: 'app.js',
      family: 'code',
    })
    const lines = container.querySelectorAll('[data-line-text]')
    expect(lines[1]!.querySelector('.hljs-comment')?.textContent).toBe('two */')
    expect(lines[2]!.querySelector('.hljs-keyword')?.textContent).toBe('const')
  })

  it('leaves plain text unhighlighted', () => {
    const { container } = renderText('const a = 1', { name: 'notes.txt' })
    expect(container.querySelector('[class*="hljs-"]')).toBeNull()
  })

  it('colours log levels', () => {
    const { container } = renderText(
      '2026-09-27T14:01:58Z INFO start\n2026-09-27T14:02:01Z WARN slow\n2026-09-27T14:02:02Z ERROR boom',
      { name: 'import.log' }
    )
    expect(container.querySelector('.log-info')?.textContent).toBe('INFO')
    expect(container.querySelector('.log-warn')?.textContent).toBe('WARN')
    expect(container.querySelector('.log-error')?.textContent).toBe('ERROR')
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
