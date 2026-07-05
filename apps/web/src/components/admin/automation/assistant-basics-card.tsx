/**
 * Basics: the coarse tone + length preset most workspaces reach for before
 * ever touching a guidance rule. Saved independently per field; an unset
 * field adds no persona directive to the prompt (see buildBasicsPrompt in
 * assistant.runtime.ts). The selects always show a value — the neutral
 * defaults below are a display fallback only, not written until the admin
 * actually changes a field.
 */
import { useState, useTransition } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ASSISTANT_TONES,
  ASSISTANT_TONE_LABELS,
  ASSISTANT_LENGTHS,
  ASSISTANT_LENGTH_LABELS,
  type AssistantTone,
  type AssistantLength,
} from '@/lib/shared/assistant/basics'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantBasics } from '@/lib/client/mutations/assistant'

const DEFAULT_TONE: AssistantTone = 'neutral'
const DEFAULT_LENGTH: AssistantLength = 'standard'

export function AssistantBasicsCard() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const settingsQuery = useQuery(assistantQueries.settings())
  const updateBasics = useUpdateAssistantBasics()
  // Instant feedback while a save is in flight; cleared on failure so the
  // select falls back to the last-saved value, same idiom as ToolControlsCard.
  const [toneOverride, setToneOverride] = useState<AssistantTone | null>(null)
  const [lengthOverride, setLengthOverride] = useState<AssistantLength | null>(null)
  const [saving, setSaving] = useState<'tone' | 'length' | null>(null)

  const saved = settingsQuery.data?.basics ?? {}
  const tone = toneOverride ?? saved.tone ?? DEFAULT_TONE
  const length = lengthOverride ?? saved.length ?? DEFAULT_LENGTH

  async function save(
    field: 'tone' | 'length',
    next: { tone?: AssistantTone; length?: AssistantLength },
    revert: () => void
  ) {
    setSaving(field)
    try {
      await updateBasics.mutateAsync({ tone, length, ...next })
      startTransition(() => router.invalidate())
    } catch {
      revert()
    } finally {
      setSaving(null)
    }
  }

  return (
    <SettingsCard
      title="Basics"
      description="Set the assistant's tone and answer length. Guidance rules below can refine specific situations further."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="assistant-basics-tone">Tone</Label>
            <InlineSpinner visible={saving === 'tone'} />
          </div>
          <Select
            value={tone}
            onValueChange={(value) => {
              const next = value as AssistantTone
              setToneOverride(next)
              void save('tone', { tone: next }, () => setToneOverride(null))
            }}
            disabled={saving === 'tone'}
          >
            <SelectTrigger id="assistant-basics-tone" className="w-full" aria-label="Tone">
              <SelectValue>{ASSISTANT_TONE_LABELS[tone]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ASSISTANT_TONES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ASSISTANT_TONE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="assistant-basics-length">Answer length</Label>
            <InlineSpinner visible={saving === 'length'} />
          </div>
          <Select
            value={length}
            onValueChange={(value) => {
              const next = value as AssistantLength
              setLengthOverride(next)
              void save('length', { length: next }, () => setLengthOverride(null))
            }}
            disabled={saving === 'length'}
          >
            <SelectTrigger id="assistant-basics-length" className="w-full" aria-label="Answer length">
              <SelectValue>{ASSISTANT_LENGTH_LABELS[length]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ASSISTANT_LENGTHS.map((l) => (
                <SelectItem key={l} value={l}>
                  {ASSISTANT_LENGTH_LABELS[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </SettingsCard>
  )
}
