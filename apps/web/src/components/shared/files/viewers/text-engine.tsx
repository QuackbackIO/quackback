/**
 * Text, logs and code: numbered lines on a dark code surface, virtualized so a
 * 50,000-line log scrolls smoothly. Code is highlighted by extension, log
 * levels are coloured, and a whole JSON file is shown formatted. Find and
 * wrap are reported to the shell; the find bar lives in the content area.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatBytes } from '@/lib/shared/files/file-types'
import { cn } from '@/lib/shared/utils'
import type { ViewerEngineProps } from '../types'
import { FindBar } from './find-bar'
import { TEXT_HEAD_BYTES } from './index'
import {
  decodeText,
  findMatches,
  isJsonName,
  lineStyleFor,
  markTokens,
  MAX_MATCHES,
  prettyJson,
  tokensFor,
  TOKEN_COLOR,
  type Token,
} from './text-lines'

const LINE_HEIGHT = 20

export default function TextEngine({
  file,
  data,
  truncated,
  onToolbar,
  compact,
}: ViewerEngineProps) {
  const intl = useIntl()
  const lines = useMemo(() => {
    const text = decodeText(data)
    const shown = !truncated && isJsonName(file.name) ? (prettyJson(text) ?? text) : text
    return shown.split('\n')
  }, [data, truncated, file.name])

  const style = useMemo(
    () => lineStyleFor(file.name, file.family, lines.join('\n'), lines.length),
    [file.name, file.family, lines]
  )
  // Scrolling re-renders the visible lines; tokenize each line once.
  const tokenCache = useMemo(() => new Map<number, Token[]>(), [style])
  const tokensOf = (index: number) => {
    let tokens = tokenCache.get(index)
    if (!tokens) {
      tokens = tokensFor(style, index, lines[index]!)
      tokenCache.set(index, tokens)
    }
    return tokens
  }

  const [wrap, setWrap] = useState(compact)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const openFind = useCallback(() => {
    setFindOpen(true)
    // Focus after the bar mounts; select so typing replaces the last query.
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])
  const toggleWrap = useCallback(() => setWrap((on) => !on), [])

  useEffect(() => {
    onToolbar({
      find: { open: openFind },
      wrap: { on: wrap, toggle: toggleWrap },
      note: truncated
        ? undefined
        : intl.formatMessage(
            {
              id: 'files.count.lines',
              defaultMessage: '{count, plural, one {# line} other {# lines}}',
            },
            { count: lines.length }
          ),
    })
  }, [onToolbar, openFind, toggleWrap, wrap, truncated, lines.length, intl])

  const matches = useMemo(
    () => (findOpen ? findMatches(lines, query) : []),
    [findOpen, lines, query]
  )
  const current = matches.length > 0 ? Math.min(active, matches.length - 1) : -1
  const matchesByLine = useMemo(() => {
    const byLine = new Map<number, { start: number; end: number; current: boolean }[]>()
    matches.forEach((m, i) => {
      const list = byLine.get(m.line) ?? []
      list.push({ start: m.start, end: m.end, current: i === current })
      byLine.set(m.line, list)
    })
    return byLine
  }, [matches, current])

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20,
  })

  // Wrapped lines take more than one row; measure them again when wrap flips.
  useEffect(() => {
    virtualizer.measure()
  }, [wrap, virtualizer])

  useEffect(() => {
    if (current >= 0) virtualizer.scrollToIndex(matches[current]!.line, { align: 'center' })
  }, [current, matches, virtualizer])

  function step(delta: number) {
    if (matches.length === 0) return
    setActive((current + delta + matches.length) % matches.length)
  }

  function closeFind() {
    setFindOpen(false)
    scrollRef.current?.focus()
  }

  const gutter = `${Math.max(2, String(lines.length).length) + 2}ch`

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-[#16161a] text-[#d4d4d8]">
      {findOpen && (
        <FindBar
          inputRef={inputRef}
          query={query}
          onQueryChange={(next) => {
            setQuery(next)
            setActive(0)
          }}
          current={current}
          total={matches.length}
          capped={matches.length >= MAX_MATCHES}
          onStep={step}
          onClose={closeFind}
        />
      )}

      <div
        ref={scrollRef}
        tabIndex={0}
        data-viewer-arrows=""
        aria-label={file.name}
        className="min-h-0 flex-1 overflow-auto font-mono text-[12.5px] leading-5 outline-none"
      >
        <div
          className="relative py-2.5"
          style={{ height: virtualizer.getTotalSize() + 20, minWidth: '100%' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const ranges = matchesByLine.get(item.index) ?? []
            const tokens = markTokens(tokensOf(item.index), ranges)
            const hit = ranges.some((r) => r.current)
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={cn(
                  'absolute left-0 flex',
                  wrap ? 'w-full' : 'w-max min-w-full',
                  hit && 'bg-red-500/15 shadow-[inset_3px_0_0_#ef4444]'
                )}
                style={{ top: 10, transform: `translateY(${item.start}px)` }}
              >
                <span
                  data-line-number=""
                  aria-hidden="true"
                  className="sticky left-0 shrink-0 bg-[#16161a] pr-3.5 text-right text-[#5b5b66] select-none"
                  style={{ width: gutter }}
                >
                  {item.index + 1}
                </span>
                <span
                  data-line-text=""
                  className={cn(
                    'min-w-0 pr-4',
                    wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                  )}
                >
                  {tokens.map((token, i) => {
                    const cls = token.cls ? cn(token.cls, TOKEN_COLOR[token.cls]) : undefined
                    if (!token.mark) {
                      return cls ? (
                        <span key={i} className={cls}>
                          {token.text}
                        </span>
                      ) : (
                        token.text
                      )
                    }
                    return (
                      <mark
                        key={i}
                        data-current={token.mark === 'current' ? '' : undefined}
                        className={cn(
                          'rounded-[2px] text-inherit',
                          token.mark === 'current' ? 'bg-amber-400/70' : 'bg-amber-200/25',
                          cls
                        )}
                      >
                        {token.text}
                      </mark>
                    )
                  })}
                </span>
              </div>
            )
          })}
        </div>
        {truncated && (
          <p className="border-t border-white/10 px-4 py-3 font-sans text-xs text-zinc-400">
            {intl.formatMessage(
              { id: 'files.viewer.showingFirst', defaultMessage: 'Showing the first {size}' },
              { size: formatBytes(TEXT_HEAD_BYTES) }
            )}
          </p>
        )}
      </div>
    </div>
  )
}
