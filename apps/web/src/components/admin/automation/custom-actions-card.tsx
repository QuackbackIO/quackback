import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { PencilSquareIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/solid'
import type { AssistantCustomActionId } from '@quackback/ids'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { assistantQueries } from '@/lib/client/queries/assistant'
import {
  useCreateCustomAction,
  useDeleteCustomAction,
  useTestCustomAction,
  useUpdateCustomAction,
} from '@/lib/client/mutations/assistant-custom-actions'
import type { AssistantAgentKind } from '@/lib/shared/assistant/config'
import {
  ASSISTANT_ACTION_DEFAULT_RESPONSE_CHAR_LIMIT,
  ASSISTANT_ACTION_MAX_RESPONSE_CHAR_LIMIT,
  ASSISTANT_ACTION_METHODS,
  ASSISTANT_ACTION_MIN_RESPONSE_CHAR_LIMIT,
  ASSISTANT_ACTION_NAME_MAX_LENGTH,
  ASSISTANT_ACTION_WHEN_TO_USE_MAX_LENGTH,
  assistantActionInputSchema,
  type AssistantActionDTO,
  type AssistantActionInput,
  type AssistantActionMethod,
} from '@/lib/shared/assistant/custom-actions'
import type { CustomActionTestResult } from '@/lib/server/functions/assistant-custom-actions'
import { useUnsavedChanges } from './assistant-form'

interface HeaderRow {
  key: string
  name: string
  value: string
  secret: boolean
  hasValue: boolean
}

interface VariableRow {
  key: string
  name: string
  description: string
}

interface AllowlistRow {
  key: string
  path: string
}

function nextRowKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `row-${Math.random().toString(36).slice(2)}`
}

/** True for the service's slug-collision rejection. Duck-typed off the thrown
 *  error's `code` (own enumerable property) rather than `instanceof`, since a
 *  server-fn error's prototype chain isn't guaranteed to survive the RPC
 *  boundary — same pattern as use-pending-action-decision's error checks. */
function isDuplicateNameError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'ASSISTANT_ACTION_DUPLICATE_NAME'
  )
}

/** Project an existing definition back into editable form input (D6: secret
 * header values never round-trip — they stay empty, which the backend reads
 * as "keep the stored secret" when the field goes untouched). */
function actionInputFromDTO(action: AssistantActionDTO): AssistantActionInput {
  return {
    name: action.name,
    whenToUse: action.whenToUse,
    request: {
      method: action.request.method,
      url: action.request.url,
      headers: action.request.headers.map((header) => ({
        name: header.name,
        value: header.value,
        secret: header.secret,
      })),
      body: action.request.body ?? undefined,
    },
    variables: action.variables,
    responseAllowlist: action.responseAllowlist,
    responseCharLimit: action.responseCharLimit,
    assignments: action.assignments,
    enabled: action.enabled,
  }
}

export function CustomActionsCard({ agent }: { agent: AssistantAgentKind }) {
  const intl = useIntl()
  const actionsQuery = useQuery(assistantQueries.customActions())
  const updateAction = useUpdateCustomAction()
  const deleteAction = useDeleteCustomAction()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAction, setEditingAction] = useState<AssistantActionDTO | null>(null)
  const [deletingAction, setDeletingAction] = useState<AssistantActionDTO | null>(null)

  const title = intl.formatMessage({
    id: 'automation.actions.custom.title',
    defaultMessage: 'Custom actions',
  })

  function openCreate() {
    setEditingAction(null)
    setDialogOpen(true)
  }

  if (actionsQuery.isError) {
    return (
      <SettingsCard title={title}>
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'automation.actions.custom.loadError',
              defaultMessage: 'Custom actions could not be loaded.',
            })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void actionsQuery.refetch()}>
            {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
          </Button>
        </div>
      </SettingsCard>
    )
  }

  if (actionsQuery.isPending) {
    return (
      <SettingsCard title={title}>
        <p role="status" className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.actions.custom.loading',
            defaultMessage: 'Loading custom actions…',
          })}
        </p>
      </SettingsCard>
    )
  }

  const actions = actionsQuery.data.actions

  async function toggleEnabled(action: AssistantActionDTO) {
    try {
      await updateAction.mutateAsync({
        id: action.id as AssistantCustomActionId,
        ...actionInputFromDTO(action),
        enabled: !action.enabled,
      })
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'automation.actions.custom.updateError',
          defaultMessage: 'The custom action could not be updated.',
        })
      )
    }
  }

  async function toggleAssignment(action: AssistantActionDTO) {
    try {
      await updateAction.mutateAsync({
        id: action.id as AssistantCustomActionId,
        ...actionInputFromDTO(action),
        assignments: { ...action.assignments, [agent]: !action.assignments[agent] },
      })
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'automation.actions.custom.updateError',
          defaultMessage: 'The custom action could not be updated.',
        })
      )
    }
  }

  async function confirmDelete() {
    if (!deletingAction) return
    try {
      await deleteAction.mutateAsync(deletingAction.id as AssistantCustomActionId)
      setDeletingAction(null)
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'automation.actions.custom.deleteError',
          defaultMessage: 'The custom action could not be deleted.',
        })
      )
    }
  }

  const agentLabel =
    agent === 'copilot'
      ? intl.formatMessage({
          id: 'automation.actions.agentName.copilot',
          defaultMessage: 'Copilot',
        })
      : intl.formatMessage({ id: 'automation.actions.agentName.agent', defaultMessage: 'Agent' })

  return (
    <>
      <SettingsCard
        title={title}
        description={intl.formatMessage({
          id: 'automation.actions.custom.description',
          defaultMessage:
            'Admin-authored HTTP actions Quinn can call. Define one once, then assign it to Agent, Copilot, or both.',
        })}
        action={
          <Button type="button" size="sm" className="min-h-11 sm:min-h-8" onClick={openCreate}>
            <PlusIcon className="size-4" />
            {intl.formatMessage({
              id: 'automation.actions.custom.new',
              defaultMessage: 'New action',
            })}
          </Button>
        }
      >
        {actions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-5">
            <p className="text-sm font-medium">
              {intl.formatMessage({
                id: 'automation.actions.custom.emptyTitle',
                defaultMessage: 'Add your first custom action',
              })}
            </p>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.actions.custom.emptyDescription',
                defaultMessage:
                  'For example, call your billing API to look up an invoice, or your order system to check a shipment status.',
              })}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 min-h-11 sm:min-h-8"
              onClick={openCreate}
            >
              {intl.formatMessage({
                id: 'automation.actions.custom.new',
                defaultMessage: 'New action',
              })}
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {actions.map((action) => (
              <article key={action.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <Switch
                    checked={action.enabled}
                    onCheckedChange={() => void toggleEnabled(action)}
                    aria-label={intl.formatMessage(
                      {
                        id: 'automation.actions.custom.enableAria',
                        defaultMessage: 'Enable {name}',
                      },
                      { name: action.name }
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{action.name}</h3>
                      {action.assignments.agent && (
                        <Badge size="sm" variant="secondary" shape="pill">
                          {intl.formatMessage({
                            id: 'automation.actions.agentName.agent',
                            defaultMessage: 'Agent',
                          })}
                        </Badge>
                      )}
                      {action.assignments.copilot && (
                        <Badge size="sm" variant="secondary" shape="pill">
                          {intl.formatMessage({
                            id: 'automation.actions.agentName.copilot',
                            defaultMessage: 'Copilot',
                          })}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {action.whenToUse}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {intl.formatMessage(
                        {
                          id: 'automation.actions.custom.assignedHere',
                          defaultMessage: 'Used by {agent}',
                        },
                        { agent: agentLabel }
                      )}
                    </span>
                    <Switch
                      checked={action.assignments[agent]}
                      onCheckedChange={() => void toggleAssignment(action)}
                      aria-label={intl.formatMessage(
                        {
                          id: 'automation.actions.custom.assignedHereAria',
                          defaultMessage: 'Use {name} for {agent}',
                        },
                        { name: action.name, agent: agentLabel }
                      )}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-8"
                    aria-label={intl.formatMessage(
                      { id: 'automation.actions.custom.editAria', defaultMessage: 'Edit {name}' },
                      { name: action.name }
                    )}
                    onClick={() => {
                      setEditingAction(action)
                      setDialogOpen(true)
                    }}
                  >
                    <PencilSquareIcon className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 text-muted-foreground hover:text-destructive sm:size-8"
                    aria-label={intl.formatMessage(
                      {
                        id: 'automation.actions.custom.deleteAria',
                        defaultMessage: 'Delete {name}',
                      },
                      { name: action.name }
                    )}
                    onClick={() => setDeletingAction(action)}
                  >
                    <TrashIcon className="size-4" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </SettingsCard>

      <CustomActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={editingAction}
        defaultAgent={agent}
      />

      <ConfirmDialog
        open={Boolean(deletingAction)}
        onOpenChange={(open) => {
          if (!open) setDeletingAction(null)
        }}
        title={intl.formatMessage({
          id: 'automation.actions.custom.deleteTitle',
          defaultMessage: 'Delete custom action?',
        })}
        description={intl.formatMessage(
          {
            id: 'automation.actions.custom.deleteDescription',
            defaultMessage: '“{name}” will no longer be available to Quinn. This cannot be undone.',
          },
          { name: deletingAction?.name ?? '' }
        )}
        confirmLabel={intl.formatMessage({
          id: 'automation.actions.custom.deleteConfirm',
          defaultMessage: 'Delete action',
        })}
        cancelLabel={intl.formatMessage({
          id: 'automation.common.cancel',
          defaultMessage: 'Cancel',
        })}
        variant="destructive"
        isPending={deleteAction.isPending}
        onConfirm={confirmDelete}
      />
    </>
  )
}

function CustomActionDialog({
  open,
  onOpenChange,
  action,
  defaultAgent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: AssistantActionDTO | null
  defaultAgent: AssistantAgentKind
}) {
  const intl = useIntl()
  const createAction = useCreateCustomAction()
  const updateAction = useUpdateCustomAction()
  const testAction = useTestCustomAction()
  const errorSummaryRef = useRef<HTMLDivElement>(null)

  const [name, setName] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [method, setMethod] = useState<AssistantActionMethod>('GET')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<HeaderRow[]>([])
  const [body, setBody] = useState('')
  const [variables, setVariables] = useState<VariableRow[]>([])
  const [allowlist, setAllowlist] = useState<AllowlistRow[]>([])
  const [responseCharLimit, setResponseCharLimit] = useState(
    ASSISTANT_ACTION_DEFAULT_RESPONSE_CHAR_LIMIT
  )
  const [assignments, setAssignments] = useState({ agent: false, copilot: false })
  const [enabled, setEnabled] = useState(true)
  const [sampleVariables, setSampleVariables] = useState<Record<string, string>>({})

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [generalErrors, setGeneralErrors] = useState<string[]>([])
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<CustomActionTestResult | null>(null)
  const [testError, setTestError] = useState('')
  // The dialog walks the admin through the action in four ordered steps
  // (define -> request -> response data -> assign & test) rather than one
  // long form; the live test stays the last step before saving.
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setName(action?.name ?? '')
    setWhenToUse(action?.whenToUse ?? '')
    setMethod(action?.request.method ?? 'GET')
    setUrl(action?.request.url ?? '')
    setHeaders(
      action?.request.headers.map((header) => ({
        key: nextRowKey(),
        name: header.name,
        value: header.value,
        secret: header.secret,
        hasValue: header.hasValue,
      })) ?? []
    )
    setBody(action?.request.body ?? '')
    setVariables(
      action?.variables.map((variable) => ({
        key: nextRowKey(),
        name: variable.name,
        description: variable.description,
      })) ?? []
    )
    setAllowlist(
      action?.responseAllowlist.map((path) => ({ key: nextRowKey(), path })) ?? [
        { key: nextRowKey(), path: '' },
      ]
    )
    setResponseCharLimit(action?.responseCharLimit ?? ASSISTANT_ACTION_DEFAULT_RESPONSE_CHAR_LIMIT)
    setAssignments(
      action?.assignments ?? {
        agent: defaultAgent === 'agent',
        copilot: defaultAgent === 'copilot',
      }
    )
    setEnabled(action?.enabled ?? true)
    setSampleVariables({})
    setFieldErrors({})
    setGeneralErrors([])
    setSaveError('')
    setTestResult(null)
    setTestError('')
  }, [open, action, defaultAgent])

  function buildInput(): AssistantActionInput {
    return {
      name: name.trim(),
      whenToUse: whenToUse.trim(),
      request: {
        method,
        url: url.trim(),
        headers: headers
          .filter((row) => row.name.trim().length > 0)
          .map((row) => ({ name: row.name.trim(), value: row.value, secret: row.secret })),
        body: method === 'POST' && body.trim().length > 0 ? body : undefined,
      },
      variables: variables
        .filter((row) => row.name.trim().length > 0)
        .map((row) => ({ name: row.name.trim(), description: row.description.trim() })),
      responseAllowlist: allowlist.map((row) => row.path.trim()).filter((path) => path.length > 0),
      responseCharLimit,
      assignments,
      enabled,
    }
  }

  const initial: AssistantActionInput = action
    ? actionInputFromDTO(action)
    : {
        name: '',
        whenToUse: '',
        request: { method: 'GET', url: '', headers: [], body: undefined },
        variables: [],
        responseAllowlist: [],
        responseCharLimit: ASSISTANT_ACTION_DEFAULT_RESPONSE_CHAR_LIMIT,
        assignments: { agent: defaultAgent === 'agent', copilot: defaultAgent === 'copilot' },
        enabled: true,
      }
  const current = buildInput()
  const dirty = open && JSON.stringify(current) !== JSON.stringify(initial)
  useUnsavedChanges(dirty, 'actions')

  function updateHeader(key: string, patch: Partial<HeaderRow>) {
    setHeaders((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }
  function addHeader() {
    setHeaders((rows) => [
      ...rows,
      { key: nextRowKey(), name: '', value: '', secret: false, hasValue: false },
    ])
  }
  function removeHeader(key: string) {
    setHeaders((rows) => rows.filter((row) => row.key !== key))
  }

  function updateVariable(key: string, patch: Partial<VariableRow>) {
    setVariables((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }
  function addVariable() {
    setVariables((rows) => [...rows, { key: nextRowKey(), name: '', description: '' }])
  }
  function removeVariable(key: string) {
    setVariables((rows) => rows.filter((row) => row.key !== key))
  }

  function updateAllowlistPath(key: string, path: string) {
    setAllowlist((rows) => rows.map((row) => (row.key === key ? { ...row, path } : row)))
  }
  function addAllowlistPath() {
    setAllowlist((rows) => [...rows, { key: nextRowKey(), path: '' }])
  }
  function removeAllowlistPath(key: string) {
    setAllowlist((rows) => rows.filter((row) => row.key !== key))
  }

  async function runTest() {
    setTestError('')
    setTestResult(null)
    const input = buildInput()
    if (!input.request.url.trim()) {
      setTestError(
        intl.formatMessage({
          id: 'automation.actions.dialog.test.urlRequired',
          defaultMessage: 'Enter a URL before testing.',
        })
      )
      return
    }
    try {
      const result = await testAction.mutateAsync({
        id: action?.id,
        request: input.request,
        variables: sampleVariables,
        responseAllowlist: input.responseAllowlist,
        responseCharLimit: input.responseCharLimit,
      })
      setTestResult(result)
    } catch {
      setTestError(
        intl.formatMessage({
          id: 'automation.actions.dialog.test.error',
          defaultMessage: 'The test request could not be run.',
        })
      )
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const input = buildInput()
    const nextFieldErrors: Record<string, string> = {}

    if (!input.name) {
      nextFieldErrors.name = intl.formatMessage({
        id: 'automation.actions.dialog.nameRequired',
        defaultMessage: 'Name this action.',
      })
    } else if (input.name.length > ASSISTANT_ACTION_NAME_MAX_LENGTH) {
      nextFieldErrors.name = intl.formatMessage({
        id: 'automation.actions.dialog.nameTooLong',
        defaultMessage: 'Use 80 characters or fewer.',
      })
    }
    if (!input.whenToUse) {
      nextFieldErrors.whenToUse = intl.formatMessage({
        id: 'automation.actions.dialog.whenToUseRequired',
        defaultMessage: 'Describe when Quinn should use this action.',
      })
    } else if (input.whenToUse.length > ASSISTANT_ACTION_WHEN_TO_USE_MAX_LENGTH) {
      nextFieldErrors.whenToUse = intl.formatMessage({
        id: 'automation.actions.dialog.whenToUseTooLong',
        defaultMessage: 'Use 500 characters or fewer.',
      })
    }
    if (!input.request.url) {
      nextFieldErrors.url = intl.formatMessage({
        id: 'automation.actions.dialog.urlRequired',
        defaultMessage: 'Enter a URL.',
      })
    } else if (!/^https?:\/\//i.test(input.request.url)) {
      nextFieldErrors.url = intl.formatMessage({
        id: 'automation.actions.dialog.urlInvalid',
        defaultMessage: 'The URL must start with http:// or https://.',
      })
    }

    const parsed = assistantActionInputSchema.safeParse(input)
    const nextGeneralErrors = parsed.success
      ? []
      : [...new Set(parsed.error.issues.map((issue) => issue.message))]

    setFieldErrors(nextFieldErrors)
    setGeneralErrors(nextGeneralErrors)
    if (Object.keys(nextFieldErrors).length > 0 || !parsed.success) {
      // The wizard hides non-current steps, so a validation failure must jump
      // back to the step that owns the errored field or the admin would see
      // the summary with no highlighted field.
      if (nextFieldErrors.name || nextFieldErrors.whenToUse) setStep(0)
      else if (nextFieldErrors.url) setStep(1)
      requestAnimationFrame(() => errorSummaryRef.current?.focus())
      return
    }

    setSaving(true)
    setSaveError('')
    try {
      if (action) {
        await updateAction.mutateAsync({ id: action.id as AssistantCustomActionId, ...parsed.data })
      } else {
        await createAction.mutateAsync(parsed.data)
      }
      onOpenChange(false)
    } catch (error) {
      // A slug collision with another definition (service-enforced, and backed
      // by a lower(name) unique index) comes back with a distinct code — point
      // it at the name field so the fix is obvious, rather than the generic
      // save error.
      if (isDuplicateNameError(error)) {
        const message = intl.formatMessage({
          id: 'automation.actions.dialog.duplicateName',
          defaultMessage: 'Another action already uses a similar name. Choose a distinct name.',
        })
        setFieldErrors((current) => ({ ...current, name: message }))
        // The name field lives on step 0; jump back so the error is visible.
        setStep(0)
        requestAnimationFrame(() => errorSummaryRef.current?.focus())
      } else {
        setSaveError(
          intl.formatMessage({
            id: 'automation.actions.dialog.saveError',
            defaultMessage: 'The custom action could not be saved. Your draft is still here.',
          })
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const declaredVariables = variables.filter((row) => row.name.trim().length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {action
              ? intl.formatMessage({
                  id: 'automation.actions.dialog.editTitle',
                  defaultMessage: 'Edit custom action',
                })
              : intl.formatMessage({
                  id: 'automation.actions.dialog.addTitle',
                  defaultMessage: 'New custom action',
                })}
          </DialogTitle>
        </DialogHeader>

        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {[
            intl.formatMessage({
              id: 'automation.actions.dialog.steps.define',
              defaultMessage: 'Define',
            }),
            intl.formatMessage({
              id: 'automation.actions.dialog.steps.request',
              defaultMessage: 'Request',
            }),
            intl.formatMessage({
              id: 'automation.actions.dialog.steps.data',
              defaultMessage: 'Response data',
            }),
            intl.formatMessage({
              id: 'automation.actions.dialog.steps.test',
              defaultMessage: 'Assign & test',
            }),
          ].map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={
                index === step
                  ? 'font-medium text-foreground'
                  : index < step
                    ? 'text-foreground/70'
                    : undefined
              }
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        <form onSubmit={submit} className="space-y-5">
          {(Object.keys(fieldErrors).length > 0 || generalErrors.length > 0) && (
            <div
              ref={errorSummaryRef}
              tabIndex={-1}
              role="alert"
              className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p>
                {intl.formatMessage({
                  id: 'automation.actions.dialog.validationSummary',
                  defaultMessage: 'Review the highlighted fields before saving.',
                })}
              </p>
              {generalErrors.length > 0 && (
                <ul className="list-inside list-disc text-xs">
                  {generalErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="action-name">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.nameLabel',
                    defaultMessage: 'Name this action',
                  })}
                </Label>
                <Input
                  id="action-name"
                  value={name}
                  aria-invalid={Boolean(fieldErrors.name)}
                  onChange={(event) => setName(event.target.value)}
                />
                {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="action-when-to-use">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.whenToUseLabel',
                    defaultMessage: 'When should Quinn use this?',
                  })}
                </Label>
                <Textarea
                  id="action-when-to-use"
                  value={whenToUse}
                  rows={3}
                  aria-invalid={Boolean(fieldErrors.whenToUse)}
                  placeholder={intl.formatMessage({
                    id: 'automation.actions.dialog.whenToUsePlaceholder',
                    defaultMessage:
                      'For example: Look up a shipment status when a customer asks where their order is.',
                  })}
                  onChange={(event) => setWhenToUse(event.target.value)}
                />
                <p className="text-end text-xs tabular-nums text-muted-foreground">
                  {whenToUse.length} / {ASSISTANT_ACTION_WHEN_TO_USE_MAX_LENGTH}
                </p>
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.whenToUseHelp',
                    defaultMessage:
                      'This text is model-facing: it is exactly what Quinn reads to decide when to call this action.',
                  })}
                </p>
                {fieldErrors.whenToUse && (
                  <p className="text-xs text-destructive">{fieldErrors.whenToUse}</p>
                )}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.requestLegend',
                    defaultMessage: 'Request',
                  })}
                </legend>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={method}
                    onValueChange={(value) => setMethod(value as AssistantActionMethod)}
                  >
                    <SelectTrigger size="sm" className="w-full sm:w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSISTANT_ACTION_METHODS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="flex-1"
                    value={url}
                    aria-invalid={Boolean(fieldErrors.url)}
                    placeholder={intl.formatMessage({
                      id: 'automation.actions.dialog.urlPlaceholder',
                      defaultMessage: 'https://api.example.com/orders/{{orderId}}',
                    })}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.urlHelp',
                    defaultMessage:
                      'Use {{variable}} placeholders in the URL or body. Quinn fills them in from the variables declared below.',
                  })}
                </p>
                {fieldErrors.url && <p className="text-xs text-destructive">{fieldErrors.url}</p>}

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {intl.formatMessage({
                      id: 'automation.actions.dialog.headersLabel',
                      defaultMessage: 'Headers',
                    })}
                  </p>
                  {headers.map((row) => (
                    <div
                      key={row.key}
                      className="flex flex-col gap-2 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-center"
                    >
                      <Input
                        className="sm:w-40"
                        value={row.name}
                        placeholder={intl.formatMessage({
                          id: 'automation.actions.dialog.headers.namePlaceholder',
                          defaultMessage: 'Header name',
                        })}
                        aria-label={intl.formatMessage({
                          id: 'automation.actions.dialog.headers.nameAria',
                          defaultMessage: 'Header name',
                        })}
                        onChange={(event) => updateHeader(row.key, { name: event.target.value })}
                      />
                      <Input
                        className="flex-1"
                        type={row.secret ? 'password' : 'text'}
                        value={row.value}
                        placeholder={
                          row.secret && row.hasValue && !row.value
                            ? intl.formatMessage({
                                id: 'automation.actions.dialog.headers.savedPlaceholder',
                                defaultMessage: '•••• saved',
                              })
                            : intl.formatMessage({
                                id: 'automation.actions.dialog.headers.valuePlaceholder',
                                defaultMessage: 'Header value',
                              })
                        }
                        aria-label={intl.formatMessage({
                          id: 'automation.actions.dialog.headers.valueAria',
                          defaultMessage: 'Header value',
                        })}
                        onChange={(event) => updateHeader(row.key, { value: event.target.value })}
                      />
                      <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={row.secret}
                          onCheckedChange={(checked) =>
                            updateHeader(row.key, { secret: checked === true })
                          }
                        />
                        {intl.formatMessage({
                          id: 'automation.actions.dialog.headers.secretLabel',
                          defaultMessage: 'Secret',
                        })}
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label={intl.formatMessage({
                          id: 'automation.actions.dialog.headers.removeAria',
                          defaultMessage: 'Remove header',
                        })}
                        onClick={() => removeHeader(row.key)}
                      >
                        <XMarkIcon className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addHeader}>
                    <PlusIcon className="size-4" />
                    {intl.formatMessage({
                      id: 'automation.actions.dialog.headers.add',
                      defaultMessage: 'Add header',
                    })}
                  </Button>
                </div>

                {method === 'POST' && (
                  <div className="space-y-2">
                    <Label htmlFor="action-body">
                      {intl.formatMessage({
                        id: 'automation.actions.dialog.bodyLabel',
                        defaultMessage: 'Request body',
                      })}
                    </Label>
                    <Textarea
                      id="action-body"
                      value={body}
                      rows={4}
                      className="font-mono text-xs"
                      placeholder={intl.formatMessage({
                        id: 'automation.actions.dialog.bodyPlaceholder',
                        defaultMessage: '{"orderId": "{{orderId}}"}',
                      })}
                      onChange={(event) => setBody(event.target.value)}
                    />
                  </div>
                )}
              </fieldset>
            </>
          )}

          {step === 2 && (
            <>
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.variablesLegend',
                    defaultMessage: 'Variables',
                  })}
                </legend>
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.variablesHelp',
                    defaultMessage:
                      'Declare each {{variable}} Quinn should fill in and what it means.',
                  })}
                </p>
                {variables.map((row) => (
                  <div key={row.key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      className="sm:w-40"
                      value={row.name}
                      placeholder={intl.formatMessage({
                        id: 'automation.actions.dialog.variables.namePlaceholder',
                        defaultMessage: 'orderId',
                      })}
                      aria-label={intl.formatMessage({
                        id: 'automation.actions.dialog.variables.nameAria',
                        defaultMessage: 'Variable name',
                      })}
                      onChange={(event) => updateVariable(row.key, { name: event.target.value })}
                    />
                    <Input
                      className="flex-1"
                      value={row.description}
                      placeholder={intl.formatMessage({
                        id: 'automation.actions.dialog.variables.descriptionPlaceholder',
                        defaultMessage: 'The order number the customer is asking about',
                      })}
                      aria-label={intl.formatMessage({
                        id: 'automation.actions.dialog.variables.descriptionAria',
                        defaultMessage: 'Variable description',
                      })}
                      onChange={(event) =>
                        updateVariable(row.key, { description: event.target.value })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={intl.formatMessage({
                        id: 'automation.actions.dialog.variables.removeAria',
                        defaultMessage: 'Remove variable',
                      })}
                      onClick={() => removeVariable(row.key)}
                    >
                      <XMarkIcon className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addVariable}>
                  <PlusIcon className="size-4" />
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.variables.add',
                    defaultMessage: 'Add variable',
                  })}
                </Button>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.allowlistLegend',
                    defaultMessage: 'Response fields Quinn may see',
                  })}
                </legend>
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.allowlistHelp',
                    defaultMessage:
                      'Only these fields ever reach Quinn. Use dot paths, with [] to fan out across an array, e.g. data.items[].name.',
                  })}
                </p>
                {allowlist.map((row) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <Input
                      className="flex-1 font-mono text-xs"
                      value={row.path}
                      placeholder={intl.formatMessage({
                        id: 'automation.actions.dialog.allowlist.placeholder',
                        defaultMessage: 'data.items[].name',
                      })}
                      aria-label={intl.formatMessage({
                        id: 'automation.actions.dialog.allowlist.aria',
                        defaultMessage: 'Response field path',
                      })}
                      onChange={(event) => updateAllowlistPath(row.key, event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={intl.formatMessage({
                        id: 'automation.actions.dialog.allowlist.removeAria',
                        defaultMessage: 'Remove field path',
                      })}
                      onClick={() => removeAllowlistPath(row.key)}
                    >
                      <XMarkIcon className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addAllowlistPath}>
                  <PlusIcon className="size-4" />
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.allowlist.add',
                    defaultMessage: 'Add field path',
                  })}
                </Button>

                <div className="space-y-2">
                  <Label htmlFor="action-char-limit">
                    {intl.formatMessage({
                      id: 'automation.actions.dialog.charLimitLabel',
                      defaultMessage: 'Response character limit',
                    })}
                  </Label>
                  <Input
                    id="action-char-limit"
                    type="number"
                    className="w-32"
                    min={ASSISTANT_ACTION_MIN_RESPONSE_CHAR_LIMIT}
                    max={ASSISTANT_ACTION_MAX_RESPONSE_CHAR_LIMIT}
                    value={responseCharLimit}
                    onChange={(event) => setResponseCharLimit(Number(event.target.value))}
                  />
                </div>
              </fieldset>
            </>
          )}

          {step === 3 && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.assignmentsLegend',
                    defaultMessage: 'Assign to',
                  })}
                </legend>
                <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3">
                  <Label htmlFor="action-assign-agent" className="cursor-pointer">
                    {intl.formatMessage({
                      id: 'automation.actions.agentName.agent',
                      defaultMessage: 'Agent',
                    })}
                  </Label>
                  <Switch
                    id="action-assign-agent"
                    checked={assignments.agent}
                    onCheckedChange={(checked) =>
                      setAssignments((current) => ({ ...current, agent: checked }))
                    }
                  />
                </div>
                <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3">
                  <Label htmlFor="action-assign-copilot" className="cursor-pointer">
                    {intl.formatMessage({
                      id: 'automation.actions.agentName.copilot',
                      defaultMessage: 'Copilot',
                    })}
                  </Label>
                  <Switch
                    id="action-assign-copilot"
                    checked={assignments.copilot}
                    onCheckedChange={(checked) =>
                      setAssignments((current) => ({ ...current, copilot: checked }))
                    }
                  />
                </div>
              </fieldset>

              <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <Label htmlFor="action-enabled" className="cursor-pointer">
                    {intl.formatMessage({
                      id: 'automation.actions.dialog.enabledLabel',
                      defaultMessage: 'Enabled',
                    })}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {intl.formatMessage({
                      id: 'automation.actions.dialog.enabledHelp',
                      defaultMessage: 'Disabled actions remain saved but are never called.',
                    })}
                  </p>
                </div>
                <Switch id="action-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <fieldset className="space-y-3 rounded-lg border border-border/60 p-3">
                <legend className="px-1 text-sm font-medium">
                  {intl.formatMessage({
                    id: 'automation.actions.dialog.testLegend',
                    defaultMessage: 'Test this action',
                  })}
                </legend>
                {declaredVariables.length > 0 && (
                  <div className="space-y-2">
                    {declaredVariables.map((row) => (
                      <div key={row.key} className="space-y-1">
                        <Label htmlFor={`sample-${row.key}`} className="text-xs">
                          {row.name.trim()}
                        </Label>
                        <Input
                          id={`sample-${row.key}`}
                          value={sampleVariables[row.name.trim()] ?? ''}
                          placeholder={row.description}
                          onChange={(event) =>
                            setSampleVariables((current) => ({
                              ...current,
                              [row.name.trim()]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testAction.isPending}
                  onClick={() => void runTest()}
                >
                  {testAction.isPending
                    ? intl.formatMessage({
                        id: 'automation.actions.dialog.test.running',
                        defaultMessage: 'Testing…',
                      })
                    : intl.formatMessage({
                        id: 'automation.actions.dialog.test.run',
                        defaultMessage: 'Test',
                      })}
                </Button>
                {testError && (
                  <p role="alert" className="text-xs text-destructive">
                    {testError}
                  </p>
                )}
                {testResult && (
                  <div className="space-y-2 rounded-lg bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        size="sm"
                        variant={testResult.ok ? 'secondary' : 'destructive'}
                        shape="pill"
                      >
                        {testResult.ok
                          ? intl.formatMessage({
                              id: 'automation.actions.dialog.test.ok',
                              defaultMessage: 'Success',
                            })
                          : intl.formatMessage({
                              id: 'automation.actions.dialog.test.failed',
                              defaultMessage: 'Failed',
                            })}
                      </Badge>
                      {testResult.httpStatus !== undefined && (
                        <span className="text-xs text-muted-foreground">
                          {intl.formatMessage(
                            {
                              id: 'automation.actions.dialog.test.httpStatus',
                              defaultMessage: 'HTTP {status}',
                            },
                            { status: testResult.httpStatus }
                          )}
                        </span>
                      )}
                    </div>
                    {testResult.note && (
                      <p className="text-xs text-muted-foreground">{testResult.note}</p>
                    )}
                    <pre className="max-h-48 overflow-auto rounded-md bg-background p-2 text-xs break-words whitespace-pre-wrap">
                      {testResult.data}
                    </pre>
                    {testResult.truncated && (
                      <p className="text-xs text-muted-foreground">
                        {intl.formatMessage({
                          id: 'automation.actions.dialog.test.truncated',
                          defaultMessage: 'Response truncated to the character limit above.',
                        })}
                      </p>
                    )}
                  </div>
                )}
              </fieldset>
            </>
          )}

          {saveError && (
            <p role="alert" className="text-sm text-destructive">
              {saveError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {intl.formatMessage({ id: 'automation.common.cancel', defaultMessage: 'Cancel' })}
            </Button>
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                {intl.formatMessage({
                  id: 'automation.actions.dialog.steps.back',
                  defaultMessage: 'Back',
                })}
              </Button>
            )}
            {step < 3 && (
              <Button type="button" onClick={() => setStep(step + 1)}>
                {intl.formatMessage({
                  id: 'automation.actions.dialog.steps.next',
                  defaultMessage: 'Next',
                })}
              </Button>
            )}
            {(action !== null || step === 3) && (
              <Button type="submit" disabled={saving}>
                {saving
                  ? intl.formatMessage({
                      id: 'automation.agent.save.savingButton',
                      defaultMessage: 'Saving…',
                    })
                  : action
                    ? intl.formatMessage({
                        id: 'automation.agent.save.button',
                        defaultMessage: 'Save changes',
                      })
                    : intl.formatMessage({
                        id: 'automation.actions.dialog.addConfirm',
                        defaultMessage: 'Add action',
                      })}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
