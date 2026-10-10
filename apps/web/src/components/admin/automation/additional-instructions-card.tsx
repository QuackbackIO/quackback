import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantVoice } from '@/lib/client/mutations/assistant'
import {
  AssistantConflictNotice,
  isAssistantFieldManaged,
  ManagedSettingHint,
  useAssistantAutosave,
  useUnsavedChanges,
} from './assistant-form'

const MAX_INSTRUCTIONS = 2_000
const SAVE_DELAY_MS = 800

export function AdditionalInstructionsCard() {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery(assistantQueries.settings())
  const updateVoice = useUpdateAssistantVoice()
  const [draft, setDraft] = useState<string | null>(null)
  // The last text the server is known to hold. It is trimmed, so a trailing space is not an unsaved change.
  const [saved, setSaved] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const dirty = draft !== null && saved !== null && draft.trim() !== saved
  const tooLong = draft !== null && draft.length > MAX_INSTRUCTIONS
  useUnsavedChanges(dirty, 'basics')

  async function save() {
    const latest = queryClient.getQueryData(assistantQueries.settings().queryKey)
    if (!latest || draft === null) return
    const sent = draft.trim()
    await updateVoice.mutateAsync({
      expectedRevision: latest.revision,
      voice: { ...latest.config.agents.agent.voice, additionalInstructions: sent },
    })
    setSaved(sent)
  }

  const { conflict, clearConflict } = useAssistantAutosave({
    dirty,
    valid: !tooLong,
    signature: draft ?? '',
    delayMs: SAVE_DELAY_MS,
    save,
  })

  // The draft is what the person typed. The server's text replaces it only when
  // it changed elsewhere and the person has nothing pending or in hand.
  useEffect(() => {
    if (!settingsQuery.data || dirty || focused) return
    const instructions = settingsQuery.data.config.agents.agent.voice.additionalInstructions
    if (draft !== null && instructions === saved) return
    setDraft(instructions)
    setSaved(instructions)
  }, [settingsQuery.data, dirty, focused, draft, saved])

  if (settingsQuery.isError) {
    return (
      <SettingsCard
        title={intl.formatMessage({
          id: 'automation.agent.instructions.title',
          defaultMessage: 'Writing guidelines',
        })}
      >
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'automation.agent.loadError',
              defaultMessage: 'AI agent settings could not be loaded.',
            })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void settingsQuery.refetch()}>
            {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
          </Button>
        </div>
      </SettingsCard>
    )
  }

  if (settingsQuery.isPending || draft === null || saved === null) {
    return (
      <SettingsCard
        title={intl.formatMessage({
          id: 'automation.agent.instructions.title',
          defaultMessage: 'Writing guidelines',
        })}
      >
        <p role="status" className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.agent.loading',
            defaultMessage: 'Loading AI agent settings...',
          })}
        </p>
      </SettingsCard>
    )
  }

  const managed = isAssistantFieldManaged(
    settingsQuery.data.managedFieldPaths,
    'agents.agent.voice.additionalInstructions'
  )

  async function reloadLatest() {
    const result = await settingsQuery.refetch()
    if (!result.data) return
    const instructions = result.data.config.agents.agent.voice.additionalInstructions
    setDraft(instructions)
    setSaved(instructions)
    clearConflict()
  }

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.agent.instructions.title',
        defaultMessage: 'Writing guidelines',
      })}
    >
      <div className="space-y-3">
        <Label htmlFor="assistant-additional-instructions">
          {intl.formatMessage({
            id: 'automation.agent.instructions.fieldLabel',
            defaultMessage: 'Guidelines used in every response',
          })}
        </Label>
        <Textarea
          id="assistant-additional-instructions"
          value={draft}
          rows={6}
          disabled={managed}
          aria-invalid={tooLong}
          aria-describedby="assistant-additional-instructions-help assistant-additional-instructions-count"
          placeholder={intl.formatMessage({
            id: 'automation.agent.instructions.placeholder',
            defaultMessage:
              'For example: Call customers "members", use UK English, and avoid exclamation marks.',
          })}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
        />
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <p id="assistant-additional-instructions-help" className="text-xs text-muted-foreground">
            {intl.formatMessage({
              id: 'automation.agent.instructions.help',
              defaultMessage:
                'These instructions shape how your AI agent communicates. They cannot change access permissions, accuracy requirements, or which actions it is allowed to take.',
            })}
          </p>
          <p
            id="assistant-additional-instructions-count"
            className={
              tooLong
                ? 'shrink-0 text-xs tabular-nums text-destructive'
                : 'shrink-0 text-xs tabular-nums text-muted-foreground'
            }
          >
            {intl.formatMessage(
              { id: 'automation.agent.instructions.count', defaultMessage: '{used} of 2,000' },
              { used: draft.length }
            )}
          </p>
        </div>
        {tooLong && (
          <p role="alert" className="text-xs text-destructive">
            {intl.formatMessage({
              id: 'automation.agent.instructions.tooLong',
              defaultMessage: 'Use 2,000 characters or fewer.',
            })}
          </p>
        )}
        {managed && <ManagedSettingHint />}
        {conflict && <AssistantConflictNotice onReload={reloadLatest} />}
      </div>
    </SettingsCard>
  )
}
