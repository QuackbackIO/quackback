import { describe, expect, it } from 'vitest'
import { common } from 'lowlight'
import { encodeLines, handleHighlightRequest, highlightLines } from '../highlight-lines'
import {
  GUESS_HIGHLIGHT_CHARS,
  highlightedLineCount,
  LANGUAGE_BY_EXTENSION,
  MAX_HIGHLIGHT_CHARS,
  MAX_HIGHLIGHT_LINE,
  languageFor,
  tokensFor,
  type Token,
} from '../text-lines'

/** The text of each line, rebuilt from its tokens. */
function texts(lines: Token[][]) {
  return lines.map((tokens) => tokens.map((t) => t.text).join(''))
}

describe('highlightLines', () => {
  it('colours a multi-line comment on every line it spans', () => {
    const lines = highlightLines('/* one\ntwo */\nconst a = 1', 'javascript')!
    expect(texts(lines)).toEqual(['/* one', 'two */', 'const a = 1'])
    expect(lines[0]).toEqual([{ text: '/* one', cls: 'hljs-comment' }])
    expect(lines[1]).toEqual([{ text: 'two */', cls: 'hljs-comment' }])
    expect(lines[2]![0]).toEqual({ text: 'const', cls: 'hljs-keyword' })
  })

  it('keeps blank lines, so the count matches the lines drawn', () => {
    const lines = highlightLines('a = 1\n\nb = 2\n', 'python')!
    expect(texts(lines)).toEqual(['a = 1', '', 'b = 2', ''])
  })

  it('guesses the language of a small file that names none', () => {
    const lines = highlightLines('<?php\necho "hi";\n?>', null)!
    expect(lines.flat().some((t) => t.cls === 'hljs-string')).toBe(true)
  })

  it('leaves a file too big to guess plain', () => {
    const text = 'x = 1\n'.repeat(Math.ceil((GUESS_HIGHLIGHT_CHARS + 1) / 6))
    expect(text.length).toBeGreaterThan(GUESS_HIGHLIGHT_CHARS)
    expect(highlightLines(text, null)).toBeNull()
    expect(highlightLines(text, 'python')).not.toBeNull()
  })

  it('highlights a file up to the cap whole and leaves a bigger one plain', () => {
    const line = '// note\n'
    const atCap = line.repeat(Math.floor(MAX_HIGHLIGHT_CHARS / line.length))
    const lines = highlightLines(atCap, 'javascript')!
    expect(lines).toHaveLength(atCap.split('\n').length)
    expect(lines[0]).toEqual([{ text: '// note', cls: 'hljs-comment' }])
    expect(highlightLines(atCap + 'x'.repeat(line.length), 'javascript')).toBeNull()
  })

  it('draws a line too long to be worth colouring plain', () => {
    const long = `const s = "${'x'.repeat(MAX_HIGHLIGHT_LINE)}"`
    const lines = highlightLines(`const a = 1\n${long}`, 'javascript')!
    expect(lines[0]![0]).toEqual({ text: 'const', cls: 'hljs-keyword' })
    expect(lines[1]).toEqual([{ text: long }])
  })

  it('leaves text plain in a language it has no grammar for', () => {
    expect(highlightLines('anything', 'klingon')).toBeNull()
  })
})

describe('encodeLines', () => {
  it('packs tokens into runs the page turns back into the same tokens', () => {
    const text = '/* one\ntwo */\n\nconst a = "x" // done'
    const lines = highlightLines(text, 'javascript')!
    const packed = encodeLines(lines)
    expect(packed.starts).toBeInstanceOf(Uint32Array)
    expect(packed.runs).toBeInstanceOf(Uint32Array)
    expect(highlightedLineCount(packed)).toBe(4)
    const style = { kind: 'highlighted', lines: packed } as const
    text.split('\n').forEach((line, i) => {
      expect(tokensFor(style, i, line)).toEqual(lines[i])
    })
  })
})

describe('handleHighlightRequest', () => {
  it('answers with the id it was asked under', () => {
    expect(handleHighlightRequest({ id: 7, text: 'a', language: 'klingon' })).toEqual({
      id: 7,
      lines: null,
    })
    const answer = handleHighlightRequest({ id: 8, text: 'const a', language: 'javascript' })
    expect(answer.id).toBe(8)
    expect(tokensFor({ kind: 'highlighted', lines: answer.lines! }, 0, 'const a')[0]).toEqual({
      text: 'const',
      cls: 'hljs-keyword',
    })
  })
})

describe('languageFor', () => {
  it('has a grammar for every language an extension maps to', () => {
    const missing = Object.values(LANGUAGE_BY_EXTENSION).filter((lang) => !(lang in common))
    expect(missing).toEqual([])
  })

  it('maps known extensions and nothing else', () => {
    expect(languageFor('app.TSX')).toBe('typescript')
    expect(languageFor('notes')).toBeNull()
    expect(languageFor('notes.unknown')).toBeNull()
    expect(languageFor('x.constructor')).toBeNull()
    expect(languageFor('x.__proto__')).toBeNull()
  })
})
