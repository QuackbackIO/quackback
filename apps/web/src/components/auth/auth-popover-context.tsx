import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react'

type AuthMode = 'login' | 'signup'

interface OpenAuthPopoverOptions {
  mode: AuthMode
  onSuccess?: () => void
}

interface AuthPopoverContextValue {
  isOpen: boolean
  mode: AuthMode
  openAuthPopover: (options: OpenAuthPopoverOptions) => void
  closeAuthPopover: () => void
  setMode: (mode: AuthMode) => void
  /** Called when auth completes successfully */
  onAuthSuccess: () => void
}

const AuthPopoverContext = createContext<AuthPopoverContextValue | null>(null)

interface AuthPopoverProviderProps {
  children: ReactNode
}

export function AuthPopoverProvider({ children }: AuthPopoverProviderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<AuthMode>('login')
  const onSuccessCallbackRef = useRef<(() => void) | null>(null)

  // DEBUG: Log provider initialization
  useEffect(() => {
    console.log('[AuthPopoverProvider] Provider initialized')
  }, [])

  const openAuthPopover = useCallback((options: OpenAuthPopoverOptions) => {
    console.log('[AuthPopoverProvider] openAuthPopover called with mode:', options.mode)
    setMode(options.mode)
    onSuccessCallbackRef.current = options.onSuccess || null
    setIsOpen(true)
  }, [])

  const closeAuthPopover = useCallback(() => {
    setIsOpen(false)
    onSuccessCallbackRef.current = null
  }, [])

  const onAuthSuccess = useCallback(() => {
    // Call the success callback if provided
    onSuccessCallbackRef.current?.()
    // Close the popover
    setIsOpen(false)
    onSuccessCallbackRef.current = null
  }, [])

  return (
    <AuthPopoverContext.Provider
      value={{
        isOpen,
        mode,
        openAuthPopover,
        closeAuthPopover,
        setMode,
        onAuthSuccess,
      }}
    >
      {children}
    </AuthPopoverContext.Provider>
  )
}

export function useAuthPopover(): AuthPopoverContextValue {
  const context = useContext(AuthPopoverContext)
  if (!context) {
    throw new Error('useAuthPopover must be used within an AuthPopoverProvider')
  }
  return context
}

/**
 * Safe version that returns null if not within provider.
 * Useful for components that may be rendered outside portal layout.
 */
export function useAuthPopoverSafe(): AuthPopoverContextValue | null {
  return useContext(AuthPopoverContext)
}
