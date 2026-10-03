import { createContext, useContext, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'

export interface WorkspaceCopilotContextValue {
  composer: ReactNode
  conversation: ReactNode
  starters: ReactNode
  focusedConversation: ReactNode
  openPalette: () => void
}

export const WorkspaceCopilotContext = createContext<WorkspaceCopilotContextValue | null>(null)
export const WorkspaceCopilotAvailabilityContext = createContext(false)
export const WorkspaceCopilotFocusedContext = createContext(false)

function useWorkspaceCopilot() {
  const value = useContext(WorkspaceCopilotContext)
  if (!value) throw new Error('Workspace Copilot requires its provider')
  return value
}

export function useWorkspaceCopilotEnabled() {
  return useContext(WorkspaceCopilotAvailabilityContext)
}

export function useWorkspaceCopilotFocused() {
  return useContext(WorkspaceCopilotFocusedContext)
}

export function WorkspaceCopilotFocused() {
  return useWorkspaceCopilot().focusedConversation
}

export function AskQuackbackInline() {
  const { composer, starters } = useWorkspaceCopilot()
  return (
    <div className="space-y-4">
      {composer}
      {starters}
    </div>
  )
}

export function AskPaletteTrigger({ className }: { className?: string }) {
  const intl = useIntl()
  const { openPalette } = useWorkspaceCopilot()
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label={intl.formatMessage({
        id: 'ask.composer.search',
        defaultMessage: 'Search Quackback',
      })}
      data-admin-rail-item=""
      data-tour="search"
      className={className}
    >
      <MagnifyingGlassIcon className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-start">
        {intl.formatMessage({ id: 'ask.composer.search', defaultMessage: 'Search Quackback' })}
      </span>
      <kbd className="text-xs text-muted-foreground">⌘K</kbd>
    </button>
  )
}
