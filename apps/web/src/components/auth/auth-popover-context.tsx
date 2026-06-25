import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'

type AuthMode = 'login' | 'signup'

interface OpenAuthPopoverOptions {
  mode: AuthMode
  onSuccess?: () => void
  callbackUrl?: string
}

interface AuthPopoverContextValue {
  isOpen: boolean
  mode: AuthMode
  callbackUrl: string | undefined
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
  const [callbackUrl, setCallbackUrl] = useState<string | undefined>(undefined)
  const onSuccessCallbackRef = useRef<(() => void) | null>(null)

  const openAuthPopover = useCallback((options: OpenAuthPopoverOptions) => {
    setMode(options.mode)
    onSuccessCallbackRef.current = options.onSuccess || null
    setCallbackUrl(options.callbackUrl)
    setIsOpen(true)
  }, [])

  const reset = useCallback(() => {
    setIsOpen(false)
    setCallbackUrl(undefined)
    onSuccessCallbackRef.current = null
  }, [])

  const closeAuthPopover = reset

  const onAuthSuccess = useCallback(() => {
    onSuccessCallbackRef.current?.()
    reset()
  }, [reset])

  return (
    <AuthPopoverContext.Provider
      value={{
        isOpen,
        mode,
        callbackUrl,
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
