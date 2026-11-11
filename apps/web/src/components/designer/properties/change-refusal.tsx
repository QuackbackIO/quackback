/**
 * Where a refused change says why. The draft never commits a change the
 * server would refuse (use-design-draft.ts); its one-line reason shows under
 * the row whose control made the change: the row touched last, by pointer or
 * key. A change made away from any row, such as on the canvas, says it in the
 * line over the canvas. The line goes once a change commits.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

interface RefusalLine {
  message: string
  /** The row that made the change, or null where none did. */
  row: string | null
}

export interface RefusalValue {
  shown: RefusalLine | null
  /** Marks a row as the one a change now comes from. */
  touch: (row: string) => void
}

const RefusalContext = createContext<RefusalValue | null>(null)

/** The builder's refusal line: who shows it, and the ways to show and clear it. */
export function useRefusalLines() {
  const touched = useRef<string | null>(null)
  const [shown, setShown] = useState<RefusalLine | null>(null)
  useEffect(() => {
    // Anything touched outside a row, or the canvas taking focus, is no row's change.
    // A row's own handlers run after these, as React listens below the document.
    const away = () => (touched.current = null)
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', away, true)
    window.addEventListener('blur', away)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', away, true)
      window.removeEventListener('blur', away)
    }
  }, [])
  const refuse = useCallback((message: string) => setShown({ message, row: touched.current }), [])
  const clear = useCallback(() => setShown(null), [])
  const touch = useCallback((row: string) => (touched.current = row), [])
  const value = useMemo<RefusalValue>(() => ({ shown, touch }), [shown, touch])
  return { value, refuse, clear }
}

export function RefusalLines({ value, children }: { value: RefusalValue; children: ReactNode }) {
  return <RefusalContext.Provider value={value}>{children}</RefusalContext.Provider>
}

/** A row's part in it: the handlers that mark it touched, and its line, if it is the row refused. */
export function useRowRefusal(row: string) {
  const ctx = useContext(RefusalContext)
  const touch = ctx?.touch
  const mark = useCallback(() => touch?.(row), [touch, row])
  return {
    handlers: ctx
      ? { onPointerDownCapture: mark, onKeyDownCapture: mark, onFocusCapture: mark }
      : {},
    message: ctx?.shown?.row === row ? ctx.shown.message : null,
  }
}

/** The one line, under a row's control. */
export function RefusalText({ message, className }: { message: string; className?: string }) {
  return (
    <p role="alert" data-refusal="" className={className ?? 'text-xs text-destructive'}>
      {message}
    </p>
  )
}

/** The line for a refused change no row made, over the canvas. */
export function RefusalFallback({ value }: { value: RefusalValue }) {
  if (!value.shown || value.shown.row !== null) return null
  return <RefusalText message={value.shown.message} className="text-ui text-destructive" />
}
