import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'

const SearchPaletteDialog = lazy(() =>
  import('./search-palette-dialog').then((module) => ({ default: module.SearchPaletteDialog }))
)

export const SearchPaletteContext = createContext<{ open: () => void } | null>(null)

// Inbox binds Ctrl+K to its own command bar.
const INBOX_PATH = /^\/admin\/inbox(?:\/|$)/

/**
 * Search lives on every admin page: the sidebar Search row and Ctrl+K (Cmd+K
 * on Mac). It needs no AI; its results and dialog load on first open.
 */
export function SearchPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const openRef = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const onInbox = useRouterState({ select: (state) => INBOX_PATH.test(state.location.pathname) })
  const change = useCallback((next: boolean) => {
    if (next && !openRef.current) returnFocus.current = document.activeElement as HTMLElement
    openRef.current = next
    if (next) setMounted(true)
    setOpen(next)
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || onInbox) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'k')
        return
      event.preventDefault()
      change(!openRef.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onInbox, change])
  const value = useMemo(() => ({ open: () => change(true) }), [change])
  return (
    <SearchPaletteContext.Provider value={value}>
      {children}
      {mounted && (
        <Suspense fallback={null}>
          <SearchPaletteDialog open={open} onOpenChange={change} returnFocus={returnFocus} />
        </Suspense>
      )}
    </SearchPaletteContext.Provider>
  )
}

export function useSearchPalette() {
  const value = useContext(SearchPaletteContext)
  if (!value) throw new Error('Search requires its provider')
  return value
}

/** Ctrl K or ⌘K, decided after hydration so the server and browser agree. */
export function useSearchShortcutLabel() {
  const [mac, setMac] = useState(false)
  useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ?? navigator.platform
    setMac(/mac|iphone|ipad|ipod/i.test(platform))
  }, [])
  return mac ? '⌘K' : 'Ctrl K'
}

/** The sidebar Search row. Only the sidebar row is the tour's search stop. */
export function SearchTrigger({ className, tour = false }: { className?: string; tour?: boolean }) {
  const intl = useIntl()
  const { open } = useSearchPalette()
  const shortcut = useSearchShortcutLabel()
  const label = intl.formatMessage({ id: 'ask.search.row', defaultMessage: 'Search' })
  return (
    <button
      type="button"
      onClick={open}
      aria-label={label}
      aria-keyshortcuts="Control+K Meta+K"
      data-admin-rail-item=""
      data-tour={tour ? 'search' : undefined}
      className={className}
    >
      <MagnifyingGlassIcon className="size-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-start">{label}</span>
      <kbd className="text-xs text-muted-foreground">{shortcut}</kbd>
    </button>
  )
}
