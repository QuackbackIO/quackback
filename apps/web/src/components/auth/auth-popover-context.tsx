import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'

type AuthMode = 'login' | 'signup'

/** An `account_not_linked` recovery request: the OAuth sign-in found an
 *  existing local account that isn't verified yet. The dialog opens
 *  straight into the link-conflict view so the user can confirm the
 *  email and have the provider connected. */
export interface LinkConflictContext {
  providerId?: string
  providerType?: 'oidc' | 'social'
  email?: string
}

interface OpenAuthPopoverOptions {
  mode: AuthMode
  onSuccess?: () => void
  callbackUrl?: string
  linkConflict?: LinkConflictContext
  /** Why the visitor is signing in, as plain text the caller has already
   *  translated. Replaces the default "vote and comment" line under the
   *  dialog's title. */
  description?: string
}

/** What opens, closes and completes the sign-in dialog: the same functions for the page's life. */
interface AuthPopoverActions {
  openAuthPopover: (options: OpenAuthPopoverOptions) => void
  closeAuthPopover: () => void
  setMode: (mode: AuthMode) => void
  /** Called when auth completes successfully */
  onAuthSuccess: () => void
}

/** The dialog's state, which only the dialog reads. */
interface AuthPopoverState {
  isOpen: boolean
  mode: AuthMode
  callbackUrl: string | undefined
  linkConflict: LinkConflictContext | undefined
  description: string | undefined
}

/**
 * Two contexts, so opening the dialog redraws the dialog alone. Every vote
 * button and post card on a page asks for openAuthPopover; with the state in
 * the same context, opening the dialog redrew each of them too, and on a slow
 * phone a visitor's first vote waited on all of it.
 */
const AuthPopoverContext = createContext<AuthPopoverActions | null>(null)
const AuthPopoverStateContext = createContext<AuthPopoverState | null>(null)

interface AuthPopoverProviderProps {
  children: ReactNode
}

export function AuthPopoverProvider({ children }: AuthPopoverProviderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<AuthMode>('login')
  const [callbackUrl, setCallbackUrl] = useState<string | undefined>(undefined)
  const [linkConflict, setLinkConflict] = useState<LinkConflictContext | undefined>(undefined)
  const [description, setDescription] = useState<string | undefined>(undefined)
  const onSuccessCallbackRef = useRef<(() => void) | null>(null)

  const openAuthPopover = useCallback((options: OpenAuthPopoverOptions) => {
    setMode(options.mode)
    onSuccessCallbackRef.current = options.onSuccess || null
    setCallbackUrl(options.callbackUrl)
    setLinkConflict(options.linkConflict)
    setDescription(options.description)
    setIsOpen(true)
  }, [])

  const reset = useCallback(() => {
    setIsOpen(false)
    setCallbackUrl(undefined)
    setLinkConflict(undefined)
    setDescription(undefined)
    onSuccessCallbackRef.current = null
  }, [])

  const closeAuthPopover = reset

  const onAuthSuccess = useCallback(() => {
    onSuccessCallbackRef.current?.()
    reset()
  }, [reset])

  const actions = useMemo(
    () => ({ openAuthPopover, closeAuthPopover, setMode, onAuthSuccess }),
    [openAuthPopover, closeAuthPopover, onAuthSuccess]
  )
  const state = useMemo(
    () => ({ isOpen, mode, callbackUrl, linkConflict, description }),
    [isOpen, mode, callbackUrl, linkConflict, description]
  )

  return (
    <AuthPopoverContext.Provider value={actions}>
      <AuthPopoverStateContext.Provider value={state}>{children}</AuthPopoverStateContext.Provider>
    </AuthPopoverContext.Provider>
  )
}

export function useAuthPopover(): AuthPopoverActions {
  const context = useContext(AuthPopoverContext)
  if (!context) {
    throw new Error('useAuthPopover must be used within an AuthPopoverProvider')
  }
  return context
}

/** The dialog's state and actions, for the dialog itself. */
export function useAuthPopoverState(): AuthPopoverState & AuthPopoverActions {
  const actions = useAuthPopover()
  const state = useContext(AuthPopoverStateContext)
  if (!state) {
    throw new Error('useAuthPopoverState must be used within an AuthPopoverProvider')
  }
  return { ...state, ...actions }
}

/**
 * Safe version that returns null if not within provider.
 * Useful for components that may be rendered outside portal layout.
 */
export function useAuthPopoverSafe(): AuthPopoverActions | null {
  return useContext(AuthPopoverContext)
}
