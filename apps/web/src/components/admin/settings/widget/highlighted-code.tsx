import { Fragment } from 'react'

/**
 * Lightweight syntax highlighter for read-only code blocks.
 * Uses VS Code Dark+ color scheme for familiar, readable syntax highlighting.
 */

type TokenType = 'kw' | 'str' | 'cmt' | 'fn' | 'num' | 'dec' | 'txt'

// VS Code Dark+ color palette
const DARK_PLUS = {
  kw: '#c586c0', // keywords — soft purple/magenta
  str: '#ce9178', // strings — warm orange
  cmt: '#6a9955', // comments — muted green
  fn: '#dcdcaa', // function calls — pale yellow
  num: '#b5cea8', // numbers — light green
  dec: '#4ec9b0', // decorators/variables — teal
  bg: '#1e1e1e', // background
  fg: '#d4d4d4', // default text
} as const

const STYLE: Record<TokenType, React.CSSProperties | undefined> = {
  kw: { color: DARK_PLUS.kw },
  str: { color: DARK_PLUS.str },
  cmt: { color: DARK_PLUS.cmt, fontStyle: 'italic' },
  fn: { color: DARK_PLUS.fn },
  num: { color: DARK_PLUS.num },
  dec: { color: DARK_PLUS.dec },
  txt: undefined,
}

interface LangConfig {
  keywords: Set<string>
  commentMarkers: string[]
}

const LANGS: Record<string, LangConfig> = {
  js: {
    keywords: new Set([
      'const',
      'let',
      'var',
      'function',
      'return',
      'import',
      'from',
      'export',
      'async',
      'await',
      'if',
      'else',
      'new',
      'class',
      'default',
      'typeof',
      'null',
      'true',
      'false',
      'this',
      'type',
      'interface',
      'extends',
      'throw',
      'try',
      'catch',
      'finally',
    ]),
    commentMarkers: ['//'],
  },
  python: {
    keywords: new Set([
      'def',
      'class',
      'return',
      'import',
      'from',
      'if',
      'else',
      'elif',
      'True',
      'False',
      'None',
      'and',
      'or',
      'not',
      'in',
      'is',
      'as',
      'with',
      'for',
      'while',
      'try',
      'except',
      'finally',
      'raise',
      'pass',
      'lambda',
      'yield',
    ]),
    commentMarkers: ['#'],
  },
  ruby: {
    keywords: new Set([
      'def',
      'end',
      'class',
      'module',
      'return',
      'require',
      'if',
      'else',
      'elsif',
      'do',
      'true',
      'false',
      'nil',
      'self',
      'then',
      'unless',
      'render',
      'json',
    ]),
    commentMarkers: ['#'],
  },
  php: {
    keywords: new Set([
      'use',
      'class',
      'function',
      'return',
      'public',
      'private',
      'protected',
      'static',
      'new',
      'if',
      'else',
      'true',
      'false',
      'null',
      'extends',
      'namespace',
    ]),
    commentMarkers: ['//', '#'],
  },
  go: {
    keywords: new Set([
      'func',
      'package',
      'import',
      'return',
      'var',
      'const',
      'type',
      'struct',
      'if',
      'else',
      'for',
      'range',
      'nil',
      'true',
      'false',
      'defer',
      'go',
      'chan',
      'map',
      'make',
      'byte',
    ]),
    commentMarkers: ['//'],
  },
  bash: {
    keywords: new Set([
      'curl',
      'echo',
      'export',
      'if',
      'then',
      'else',
      'fi',
      'for',
      'do',
      'done',
      'set',
      'local',
      'return',
      'true',
      'false',
    ]),
    commentMarkers: ['#'],
  },
}

interface Token {
  type: TokenType
  text: string
}

function tokenizeLine(line: string, lang: LangConfig): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < line.length) {
    // Check for comment
    const commentHit = lang.commentMarkers.find((m) => line.startsWith(m, i))
    if (commentHit) {
      tokens.push({ type: 'cmt', text: line.slice(i) })
      break
    }

    // Python decorator
    if (line[i] === '@' && /[a-zA-Z_]/.test(line[i + 1] ?? '')) {
      let j = i + 1
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++
      tokens.push({ type: 'dec', text: line.slice(i, j) })
      i = j
      continue
    }

    // PHP variable ($name)
    if (line[i] === '$' && /[a-zA-Z_]/.test(line[i + 1] ?? '')) {
      let j = i + 1
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++
      tokens.push({ type: 'dec', text: line.slice(i, j) })
      i = j
      continue
    }

    // String
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const quote = line[i]
      let j = i + 1
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j++
        j++
      }
      tokens.push({ type: 'str', text: line.slice(i, j + 1) })
      i = j + 1
      continue
    }

    // Word (keyword, function call, or plain identifier)
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++
      const word = line.slice(i, j)
      if (lang.keywords.has(word)) {
        tokens.push({ type: 'kw', text: word })
      } else if (line[j] === '(') {
        tokens.push({ type: 'fn', text: word })
      } else {
        tokens.push({ type: 'txt', text: word })
      }
      i = j
      continue
    }

    // Number
    if (/[0-9]/.test(line[i])) {
      let j = i
      while (j < line.length && /[0-9.x]/.test(line[j])) j++
      tokens.push({ type: 'num', text: line.slice(i, j) })
      i = j
      continue
    }

    // Everything else (punctuation, whitespace, operators)
    tokens.push({ type: 'txt', text: line[i] })
    i++
  }

  return tokens
}

export type SyntaxLang = 'js' | 'python' | 'ruby' | 'php' | 'go' | 'bash'

interface HighlightedCodeProps {
  code: string
  lang: SyntaxLang
}

export function HighlightedCode({ code, lang }: HighlightedCodeProps) {
  const config = LANGS[lang] ?? LANGS.js
  const lines = code.split('\n')

  return (
    <pre
      className="p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed rounded-br-md h-full"
      style={{ backgroundColor: DARK_PLUS.bg, color: DARK_PLUS.fg }}
    >
      {lines.map((line, lineIdx) => {
        const tokens = tokenizeLine(line, config)
        return (
          <Fragment key={lineIdx}>
            {tokens.map((token, tokenIdx) => {
              const style = STYLE[token.type]
              if (!style) return <Fragment key={tokenIdx}>{token.text}</Fragment>
              return (
                <span key={tokenIdx} style={style}>
                  {token.text}
                </span>
              )
            })}
            {lineIdx < lines.length - 1 ? '\n' : null}
          </Fragment>
        )
      })}
    </pre>
  )
}
