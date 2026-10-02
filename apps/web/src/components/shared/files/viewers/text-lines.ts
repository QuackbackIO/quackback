/**
 * Turning a text file's bytes into the lines the text engine draws: decoding,
 * JSON formatting, log levels, find, and which files go to the highlighter
 * (`highlight-lines.ts`, run in a worker so its grammars never load on the
 * page). Pure functions, so the engine stays about rendering.
 */
import { fileExtension } from '@/lib/shared/files/file-types'
import { MAX_FIND_MATCHES } from './find-limit'

/** A run of text with at most one highlight class. */
export interface Token {
  text: string
  cls?: string
}

export interface Match {
  line: number
  start: number
  end: number
}

/**
 * Text up to this many characters is highlighted whole, off the page, so
 * multi-line comments and strings colour right. That is four times the most
 * the viewer reads of a file, room for JSON once formatted; past it, the time
 * to highlight and the tokens to hand back outgrow what colour adds.
 */
export const MAX_HIGHLIGHT_CHARS = 1024 * 1024
/** Guessing a language costs a pass per grammar, so only small files get a guess. */
export const GUESS_HIGHLIGHT_CHARS = 20 * 1024
/** Lines longer than this are drawn plain: their tokens cost more to draw than they show. */
export const MAX_HIGHLIGHT_LINE = 2000

/** The most text the highlighter takes in a known language, or when guessing one (null). */
export function highlightLimit(language: string | null): number {
  return language ? MAX_HIGHLIGHT_CHARS : GUESS_HIGHLIGHT_CHARS
}

/** Highlight languages by file extension; every one is in the highlighter's common set. */
export const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  json: 'json',
  har: 'json',
  ndjson: 'json',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  env: 'bash',
  css: 'css',
  scss: 'scss',
  less: 'less',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  md: 'markdown',
  markdown: 'markdown',
  diff: 'diff',
  patch: 'diff',
  graphql: 'graphql',
  lua: 'lua',
  r: 'r',
}

/** Highlight colours for the dark code surface, by highlight class. */
export const TOKEN_COLOR: Record<string, string> = {
  'hljs-keyword': 'text-violet-300',
  'hljs-built_in': 'text-violet-300',
  'hljs-literal': 'text-rose-300',
  'hljs-number': 'text-rose-300',
  'hljs-string': 'text-green-300',
  'hljs-regexp': 'text-orange-300',
  'hljs-attr': 'text-sky-300',
  'hljs-attribute': 'text-sky-300',
  'hljs-property': 'text-sky-300',
  'hljs-comment': 'text-zinc-500 italic',
  'hljs-quote': 'text-zinc-500',
  'hljs-meta': 'text-zinc-400',
  'hljs-title': 'text-blue-300',
  'hljs-section': 'text-blue-300',
  'hljs-type': 'text-amber-300',
  'hljs-class': 'text-amber-300',
  'hljs-selector-class': 'text-amber-300',
  'hljs-selector-id': 'text-amber-300',
  'hljs-selector-tag': 'text-violet-300',
  'hljs-variable': 'text-orange-300',
  'hljs-template-variable': 'text-orange-300',
  'hljs-symbol': 'text-orange-300',
  'hljs-bullet': 'text-amber-300',
  'hljs-tag': 'text-zinc-400',
  'hljs-name': 'text-rose-300',
  'hljs-addition': 'text-green-300',
  'hljs-deletion': 'text-red-300',
  'hljs-punctuation': 'text-zinc-400',
  'log-trace': 'text-zinc-500',
  'log-debug': 'text-zinc-500',
  'log-info': 'text-blue-400',
  'log-warn': 'text-amber-400',
  'log-error': 'text-red-400 font-semibold',
}

export function decodeText(data: ArrayBuffer | null): string {
  if (!data) return ''
  const bytes = new Uint8Array(data)
  let encoding = 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le'
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be'
  return new TextDecoder(encoding).decode(bytes).replace(/\r\n?/g, '\n')
}

/**
 * The lines a reader sees: a final line break ends the last line rather than
 * starting an empty one, as the preview job counts them. `text` has its line
 * breaks already made LF (see `decodeText`).
 */
export function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function isJsonName(name: string): boolean {
  const ext = fileExtension(name)
  return ext === 'json' || ext === 'har'
}

/**
 * Re-indents valid JSON two spaces deep by walking its characters, so numbers
 * keep their exact digits (parsing would round ids past 2^53). Null when the
 * text is not JSON.
 */
export function prettyJson(text: string): string | null {
  try {
    JSON.parse(text)
  } catch {
    return null
  }
  let out = ''
  let depth = 0
  const newline = () => '\n' + '  '.repeat(depth)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue
    if (ch === '{' || ch === '[') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j]!)) j++
      const close = ch === '{' ? '}' : ']'
      if (text[j] === close) {
        out += ch + close
        i = j
        continue
      }
      depth++
      out += ch + newline()
    } else if (ch === '}' || ch === ']') {
      depth--
      out += newline() + ch
    } else if (ch === ',') {
      out += ',' + newline()
    } else if (ch === ':') {
      out += ': '
    } else {
      out += ch
    }
  }
  return out
}

export function languageFor(name: string): string | null {
  const ext = fileExtension(name)
  return Object.hasOwn(LANGUAGE_BY_EXTENSION, ext) ? LANGUAGE_BY_EXTENSION[ext]! : null
}

export function isLogName(name: string): boolean {
  return fileExtension(name) === 'log' || /\.log\.\d+$/i.test(name)
}

/**
 * Whether a file's text goes to the highlighter: code, not a log, within the
 * size it may be highlighted at (smaller when its language must be guessed).
 */
export function wantsHighlight(name: string, family: string, text: string): boolean {
  if (family !== 'code' || isLogName(name)) return false
  return text.length <= highlightLimit(languageFor(name))
}

const LOG_LEVEL = /\b(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|CRIT|PANIC)\b/

function logClass(level: string): string {
  switch (level) {
    case 'TRACE':
      return 'log-trace'
    case 'DEBUG':
      return 'log-debug'
    case 'INFO':
    case 'NOTICE':
      return 'log-info'
    case 'WARN':
    case 'WARNING':
      return 'log-warn'
    default:
      return 'log-error'
  }
}

/** A log line with its first level word coloured. */
export function logTokens(line: string): Token[] {
  const match = LOG_LEVEL.exec(line)
  if (!match) return line ? [{ text: line }] : []
  const at = match.index
  const out: Token[] = []
  if (at > 0) out.push({ text: line.slice(0, at) })
  out.push({ text: match[0], cls: logClass(match[1]!) })
  const rest = line.slice(at + match[0].length)
  if (rest) out.push({ text: rest })
  return out
}

/**
 * Highlighted lines as the worker hands them over: numbers in arrays it can
 * transfer, so the page copies nothing and makes tokens only for the lines it
 * draws.
 */
export interface HighlightedLines {
  /** The highlight classes the runs name. */
  classes: string[]
  /** Where each line's runs begin in `runs`, and one more entry where the last line's end. */
  starts: Uint32Array
  /** Two numbers per run: its length, and its class's index in `classes` plus one (0 for none). */
  runs: Uint32Array
}

export function highlightedLineCount(lines: HighlightedLines): number {
  return lines.starts.length - 1
}

function highlightedTokens(lines: HighlightedLines, index: number, line: string): Token[] {
  if (index + 1 >= lines.starts.length) return line ? [{ text: line }] : []
  const out: Token[] = []
  let at = 0
  for (let run = lines.starts[index]!; run < lines.starts[index + 1]!; run += 2) {
    const length = lines.runs[run]!
    const text = line.slice(at, at + length)
    at += length
    const cls = lines.classes[lines.runs[run + 1]! - 1]
    out.push(cls ? { text, cls } : { text })
  }
  return out
}

export type LineStyle =
  | { kind: 'plain' }
  | { kind: 'log' }
  /** Highlighted off the page. */
  | { kind: 'highlighted'; lines: HighlightedLines }

/** The tokens of one line under a style. Plain lines are one token. */
export function tokensFor(style: LineStyle, index: number, line: string): Token[] {
  switch (style.kind) {
    case 'highlighted':
      return highlightedTokens(style.lines, index, line)
    case 'log':
      return logTokens(line)
    default:
      return line ? [{ text: line }] : []
  }
}

/** Case-insensitive matches of `query` across lines, capped. */
export function findMatches(lines: string[], query: string): Match[] {
  const needle = query.toLowerCase()
  if (!needle) return []
  const out: Match[] = []
  for (let line = 0; line < lines.length; line++) {
    const hay = lines[line]!.toLowerCase()
    let from = 0
    for (;;) {
      const at = hay.indexOf(needle, from)
      if (at === -1) break
      out.push({ line, start: at, end: at + needle.length })
      if (out.length >= MAX_FIND_MATCHES) return out
      from = at + needle.length
    }
  }
  return out
}

/** Splits tokens at match boundaries so matches can be marked inside highlighted text. */
export function markTokens(
  tokens: Token[],
  ranges: { start: number; end: number; current: boolean }[]
): (Token & { mark?: 'match' | 'current' })[] {
  if (ranges.length === 0) return tokens
  const out: (Token & { mark?: 'match' | 'current' })[] = []
  let offset = 0
  for (const token of tokens) {
    const tokenEnd = offset + token.text.length
    let cursor = offset
    for (const range of ranges) {
      if (range.end <= cursor || range.start >= tokenEnd) continue
      const start = Math.max(range.start, cursor)
      const end = Math.min(range.end, tokenEnd)
      if (start > cursor)
        out.push({ ...token, text: token.text.slice(cursor - offset, start - offset) })
      out.push({
        ...token,
        text: token.text.slice(start - offset, end - offset),
        mark: range.current ? 'current' : 'match',
      })
      cursor = end
    }
    if (cursor < tokenEnd) out.push({ ...token, text: token.text.slice(cursor - offset) })
    offset = tokenEnd
  }
  return out
}
