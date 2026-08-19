import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
} from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'

export type AssistantSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'
export type AssistantSettingsTab = 'basics' | 'guidance' | 'actions'

interface AssistantDirtyState {
  dirtyTabs: ReadonlySet<AssistantSettingsTab>
  hasUnsavedChanges: boolean
  reportDirty: (id: string, tab: AssistantSettingsTab, dirty: boolean) => void
}

const AssistantDirtyStateContext = createContext<AssistantDirtyState | null>(null)

export function AssistantDirtyStateProvider({ children }: { children: ReactNode }) {
  const [dirtyForms, setDirtyForms] = useState<Map<string, AssistantSettingsTab>>(() => new Map())
  const reportDirty = useCallback((id: string, tab: AssistantSettingsTab, dirty: boolean) => {
    setDirtyForms((current) => {
      if (dirty && current.get(id) === tab) return current
      if (!dirty && !current.has(id)) return current

      const next = new Map(current)
      if (dirty) next.set(id, tab)
      else next.delete(id)
      return next
    })
  }, [])

  return (
    <AssistantDirtyStateContext.Provider
      value={{
        dirtyTabs: new Set(dirtyForms.values()),
        hasUnsavedChanges: dirtyForms.size > 0,
        reportDirty,
      }}
    >
      {children}
    </AssistantDirtyStateContext.Provider>
  )
}

export function useAssistantDirtyState(): Omit<AssistantDirtyState, 'reportDirty'> {
  const state = useContext(AssistantDirtyStateContext)
  if (!state)
    throw new Error('useAssistantDirtyState must be used within AssistantDirtyStateProvider')
  return state
}

export function isAssistantFieldManaged(managedPaths: string[], path: string): boolean {
  const fullPath = `assistant.${path}`
  return managedPaths.some(
    (managedPath) => fullPath === managedPath || fullPath.startsWith(`${managedPath}.`)
  )
}

export function isAssistantRevisionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; statusCode?: unknown; message?: unknown }
  return (
    value.code === 'ASSISTANT_CONFIG_REVISION_CONFLICT' ||
    value.statusCode === 409 ||
    (typeof value.message === 'string' &&
      /changed in another session|revision conflict/i.test(value.message))
  )
}

export function useUnsavedChanges(isDirty: boolean, tab?: AssistantSettingsTab) {
  const formId = useId()
  const reportDirty = useContext(AssistantDirtyStateContext)?.reportDirty

  useEffect(() => {
    if (!isDirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    if (!reportDirty || !tab) return
    reportDirty(formId, tab, isDirty)
    return () => reportDirty(formId, tab, false)
  }, [formId, isDirty, reportDirty, tab])
}

export function ManagedSettingHint() {
  const intl = useIntl()
  return (
    <p className="text-xs text-muted-foreground">
      {intl.formatMessage({
        id: 'automation.agent.managed',
        defaultMessage: 'This setting is managed by your deployment configuration.',
      })}
    </p>
  )
}

export function AssistantSaveFeedback({
  state,
  onReload,
}: {
  state: AssistantSaveState
  onReload?: () => void | Promise<void>
}) {
  const intl = useIntl()
  const message =
    state === 'saving'
      ? intl.formatMessage({
          id: 'automation.agent.save.saving',
          defaultMessage: 'Saving changes…',
        })
      : state === 'saved'
        ? intl.formatMessage({
            id: 'automation.agent.save.saved',
            defaultMessage: 'Changes saved.',
          })
        : state === 'error'
          ? intl.formatMessage({
              id: 'automation.agent.save.error',
              defaultMessage: 'Changes could not be saved. Your draft is still here.',
            })
          : state === 'conflict'
            ? intl.formatMessage({
                id: 'automation.agent.save.conflict',
                defaultMessage:
                  'These settings changed in another session. Reload the latest settings before saving again.',
              })
            : ''

  return (
    <div className="flex min-h-9 flex-col items-start justify-center gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p
        className={
          state === 'error' || state === 'conflict'
            ? 'text-xs text-destructive'
            : 'text-xs text-muted-foreground'
        }
        role={state === 'error' || state === 'conflict' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {message}
      </p>
      {state === 'conflict' && onReload && (
        <Button type="button" variant="outline" size="sm" onClick={() => void onReload()}>
          {intl.formatMessage({
            id: 'automation.agent.save.reload',
            defaultMessage: 'Reload latest settings',
          })}
        </Button>
      )}
    </div>
  )
}
