import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantVoice } from '@/lib/client/mutations/assistant'
import {
  AssistantSaveFeedback,
  type AssistantSaveState,
  isAssistantFieldManaged,
  isAssistantRevisionConflict,
  ManagedSettingHint,
  useUnsavedChanges,
} from './assistant-form'

const MAX_INSTRUCTIONS = 2_000

export function AdditionalInstructionsCard() {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const updateVoice = useUpdateAssistantVoice()
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<AssistantSaveState>('idle')
  const dirty = draft !== null && saved !== null && draft !== saved
  useUnsavedChanges(dirty, 'basics')

  useEffect(() => {
    if (!settingsQuery.data || dirty) return
    const instructions = settingsQuery.data.config.agents.agent.voice.additionalInstructions
    setDraft(instructions)
    setSaved(instructions)
  }, [settingsQuery.data, dirty])

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
            defaultMessage: 'Loading AI agent settings…',
          })}
        </p>
      </SettingsCard>
    )
  }

  const managed = isAssistantFieldManaged(
    settingsQuery.data.managedFieldPaths,
    'agents.agent.voice.additionalInstructions'
  )
  const tooLong = draft.length > MAX_INSTRUCTIONS

  async function reloadLatest() {
    const result = await settingsQuery.refetch()
    if (!result.data) return
    const instructions = result.data.config.agents.agent.voice.additionalInstructions
    setDraft(instructions)
    setSaved(instructions)
    setSaveState('idle')
  }

  async function save() {
    if (!settingsQuery.data || tooLong) return
    const instructions = draft
    if (instructions === null) return
    setSaveState('saving')
    try {
      const result = await updateVoice.mutateAsync({
        expectedRevision: settingsQuery.data.revision,
        voice: {
          ...settingsQuery.data.config.agents.agent.voice,
          additionalInstructions: instructions.trim(),
        },
      })
      const savedInstructions = result.config.agents.agent.voice.additionalInstructions
      setDraft(savedInstructions)
      setSaved(savedInstructions)
      setSaveState('saved')
    } catch (error) {
      setSaveState(isAssistantRevisionConflict(error) ? 'conflict' : 'error')
    }
  }

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.agent.instructions.title',
        defaultMessage: 'Writing guidelines',
      })}
      description={intl.formatMessage({
        id: 'automation.agent.instructions.description',
        defaultMessage: 'Set preferred terminology, brand voice, and response conventions.',
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
          disabled={managed || saveState === 'saving'}
          aria-invalid={tooLong}
          aria-describedby="assistant-additional-instructions-help assistant-additional-instructions-count"
          placeholder={intl.formatMessage({
            id: 'automation.agent.instructions.placeholder',
            defaultMessage:
              'For example: Call customers “members”, use UK English, and avoid exclamation marks.',
          })}
          onChange={(event) => {
            setDraft(event.target.value)
            setSaveState('idle')
          }}
        />
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <p
            id="assistant-additional-instructions-help"
            className="max-w-2xl text-xs text-muted-foreground"
          >
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
        <AssistantSaveFeedback state={saveState} onReload={reloadLatest} />
        <div className="flex justify-end">
          <Button
            type="button"
            className="min-h-11 sm:min-h-9"
            disabled={!dirty || tooLong || saveState === 'saving'}
            onClick={() => void save()}
          >
            {saveState === 'saving'
              ? intl.formatMessage({
                  id: 'automation.agent.save.savingButton',
                  defaultMessage: 'Saving…',
                })
              : intl.formatMessage({
                  id: 'automation.agent.save.button',
                  defaultMessage: 'Save changes',
                })}
          </Button>
        </div>
      </div>
    </SettingsCard>
  )
}
