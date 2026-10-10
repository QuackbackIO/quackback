import { cn } from '@/lib/shared/utils'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { RADIO_TILE_DOT, RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantVoice } from '@/lib/client/mutations/assistant'
import {
  ASSISTANT_RESPONSE_LENGTHS,
  ASSISTANT_TONES,
  type AssistantResponseLength,
  type AssistantTone,
} from '@/lib/shared/assistant/config'
import {
  AssistantConflictNotice,
  isAssistantFieldManaged,
  ManagedSettingHint,
  useAssistantAutosave,
  useUnsavedChanges,
} from './assistant-form'

const TONE_MESSAGES: Record<AssistantTone, { label: string; description: string }> = {
  warm: {
    label: 'Warm',
    description: 'Friendly, empathetic, and conversational.',
  },
  balanced: {
    label: 'Balanced',
    description: 'Clear, calm, and natural. Recommended.',
  },
  professional: {
    label: 'Professional',
    description: 'Polished and more formal.',
  },
}

const LENGTH_MESSAGES: Record<AssistantResponseLength, { label: string; description: string }> = {
  brief: {
    label: 'Brief',
    description: 'Gives the answer and immediate next step.',
  },
  balanced: {
    label: 'Balanced',
    description: 'Adds useful context without over-explaining. Recommended.',
  },
  detailed: {
    label: 'Detailed',
    description: 'Uses fuller explanations or steps when helpful.',
  },
}

export function AssistantVoiceCard() {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery(assistantQueries.settings())
  const updateVoice = useUpdateAssistantVoice()
  const [tone, setTone] = useState<AssistantTone | null>(null)
  const [responseLength, setResponseLength] = useState<AssistantResponseLength | null>(null)
  const [savedTone, setSavedTone] = useState<AssistantTone | null>(null)
  const [savedLength, setSavedLength] = useState<AssistantResponseLength | null>(null)
  const dirty = Boolean(
    tone && responseLength && (tone !== savedTone || responseLength !== savedLength)
  )
  useUnsavedChanges(dirty, 'basics')

  async function save() {
    const latest = queryClient.getQueryData(assistantQueries.settings().queryKey)
    if (!latest || !tone || !responseLength) return
    const sentTone = tone
    const sentLength = responseLength
    await updateVoice.mutateAsync({
      expectedRevision: latest.revision,
      voice: {
        ...latest.config.agents.agent.voice,
        tone: sentTone,
        responseLength: sentLength,
      },
    })
    setSavedTone(sentTone)
    setSavedLength(sentLength)
  }

  const { conflict, clearConflict, touch } = useAssistantAutosave({
    dirty,
    signature: `${tone}|${responseLength}`,
    delayMs: 0,
    save,
  })

  useEffect(() => {
    if (!settingsQuery.data || dirty) return
    const voice = settingsQuery.data.config.agents.agent.voice
    setTone(voice.tone)
    setResponseLength(voice.responseLength)
    setSavedTone(voice.tone)
    setSavedLength(voice.responseLength)
  }, [settingsQuery.data, dirty])

  if (settingsQuery.isError) {
    return (
      <SettingsCard
        title={intl.formatMessage({
          id: 'automation.agent.voice.title',
          defaultMessage: 'Response style',
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

  if (!tone || !responseLength || settingsQuery.isPending) {
    return (
      <SettingsCard
        title={intl.formatMessage({
          id: 'automation.agent.voice.title',
          defaultMessage: 'Response style',
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

  const managedPaths = settingsQuery.data.managedFieldPaths
  const toneManaged = isAssistantFieldManaged(managedPaths, 'agents.agent.voice.tone')
  const lengthManaged = isAssistantFieldManaged(managedPaths, 'agents.agent.voice.responseLength')

  async function reloadLatest() {
    const result = await settingsQuery.refetch()
    if (!result.data) return
    const voice = result.data.config.agents.agent.voice
    setTone(voice.tone)
    setResponseLength(voice.responseLength)
    setSavedTone(voice.tone)
    setSavedLength(voice.responseLength)
    clearConflict()
  }

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.agent.voice.title',
        defaultMessage: 'Response style',
      })}
    >
      <div className="space-y-6">
        <fieldset className="space-y-3">
          <legend id="assistant-tone-label" className="text-sm font-medium">
            {intl.formatMessage({ id: 'automation.agent.voice.tone', defaultMessage: 'Tone' })}
          </legend>
          <RadioGroup
            value={tone}
            aria-labelledby="assistant-tone-label"
            className="grid gap-2 sm:grid-cols-3"
            disabled={toneManaged}
            onValueChange={(value) => {
              setTone(value as AssistantTone)
            }}
          >
            {ASSISTANT_TONES.map((value) => {
              const descriptionId = `assistant-tone-${value}-description`
              return (
                <label
                  key={value}
                  onClick={touch}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border/60 p-3 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
                >
                  <RadioGroupItem
                    value={value}
                    aria-describedby={descriptionId}
                    className={cn('mt-0.5', RADIO_TILE_DOT)}
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {intl.formatMessage({
                        id: `automation.agent.voice.tone.${value}.label`,
                        defaultMessage: TONE_MESSAGES[value].label,
                      })}
                    </span>
                    <span id={descriptionId} className="mt-0.5 block text-xs text-muted-foreground">
                      {intl.formatMessage({
                        id: `automation.agent.voice.tone.${value}.description`,
                        defaultMessage: TONE_MESSAGES[value].description,
                      })}
                    </span>
                  </span>
                </label>
              )
            })}
          </RadioGroup>
          {toneManaged && <ManagedSettingHint />}
        </fieldset>

        <fieldset className="space-y-3">
          <legend id="assistant-length-label" className="text-sm font-medium">
            {intl.formatMessage({
              id: 'automation.agent.voice.responseLength',
              defaultMessage: 'Response length',
            })}
          </legend>
          <RadioGroup
            value={responseLength}
            aria-labelledby="assistant-length-label"
            className="grid gap-2 sm:grid-cols-3"
            disabled={lengthManaged}
            onValueChange={(value) => {
              setResponseLength(value as AssistantResponseLength)
            }}
          >
            {ASSISTANT_RESPONSE_LENGTHS.map((value) => {
              const descriptionId = `assistant-length-${value}-description`
              return (
                <label
                  key={value}
                  onClick={touch}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border/60 p-3 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
                >
                  <RadioGroupItem
                    value={value}
                    aria-describedby={descriptionId}
                    className={cn('mt-0.5', RADIO_TILE_DOT)}
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {intl.formatMessage({
                        id: `automation.agent.voice.length.${value}.label`,
                        defaultMessage: LENGTH_MESSAGES[value].label,
                      })}
                    </span>
                    <span id={descriptionId} className="mt-0.5 block text-xs text-muted-foreground">
                      {intl.formatMessage({
                        id: `automation.agent.voice.length.${value}.description`,
                        defaultMessage: LENGTH_MESSAGES[value].description,
                      })}
                    </span>
                  </span>
                </label>
              )
            })}
          </RadioGroup>
          {lengthManaged && <ManagedSettingHint />}
        </fieldset>

        {conflict && <AssistantConflictNotice onReload={reloadLatest} />}
      </div>
    </SettingsCard>
  )
}
