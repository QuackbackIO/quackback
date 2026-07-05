/**
 * Per-surface prompt instructions: extra guidance folded in on top of the
 * assistant's base personality for a specific deploy surface. v1 only
 * exposes the widget surface (the only one prompt assembly reads today);
 * email and workflow_step join by adding to `EDITABLE_SURFACES` once their
 * callers pass surface-scoped instructions through, no layout change needed.
 */
import { useEffect, useState, useTransition } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ASSISTANT_SURFACE_LABELS } from '@/lib/shared/assistant/surfaces'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantSurfaces } from '@/lib/client/mutations/assistant'

const EDITABLE_SURFACES = ['widget'] as const
type EditableSurface = (typeof EDITABLE_SURFACES)[number]

// Mirrors settings.assistant.ts's (unexported) SURFACE_INSTRUCTIONS_MAX — a
// UI-only guard; the server validator enforces the authoritative limit.
const INSTRUCTIONS_MAX = 2000

export function SurfaceInstructionsCard() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const settingsQuery = useQuery(assistantQueries.settings())
  const updateSurfaces = useUpdateAssistantSurfaces()
  const [drafts, setDrafts] = useState<Record<EditableSurface, string>>({ widget: '' })
  const [savedDrafts, setSavedDrafts] = useState<Record<EditableSurface, string>>({ widget: '' })
  const [saving, setSaving] = useState<EditableSurface | null>(null)
  const [hydrated, setHydrated] = useState(false)

  const surfaces = settingsQuery.data?.surfaces ?? {}

  // Seed local drafts once from the loaded settings; later refetches (after a
  // save) do not clobber whatever the admin is mid-typing in the other field.
  useEffect(() => {
    if (settingsQuery.data && !hydrated) {
      const seeded = {} as Record<EditableSurface, string>
      for (const surface of EDITABLE_SURFACES) {
        seeded[surface] = settingsQuery.data.surfaces[surface]?.instructions ?? ''
      }
      setDrafts(seeded)
      setSavedDrafts(seeded)
      setHydrated(true)
    }
  }, [settingsQuery.data, hydrated])

  async function save(surface: EditableSurface, value: string) {
    setSaving(surface)
    try {
      const merged = { ...surfaces, [surface]: { instructions: value } }
      await updateSurfaces.mutateAsync(merged)
      setSavedDrafts((prev) => ({ ...prev, [surface]: value }))
      startTransition(() => router.invalidate())
    } catch {
      setDrafts((prev) => ({ ...prev, [surface]: savedDrafts[surface] }))
    } finally {
      setSaving(null)
    }
  }

  return (
    <SettingsCard
      title="Surface instructions"
      description="Extra instructions folded into the assistant's prompt for a specific surface, on top of its base personality."
    >
      <div className="space-y-4">
        {EDITABLE_SURFACES.map((surface) => (
          <div key={surface} className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`surface-instructions-${surface}`}>
                {ASSISTANT_SURFACE_LABELS[surface].label}
              </Label>
              <InlineSpinner visible={saving === surface} />
            </div>
            <p className="text-xs text-muted-foreground">
              {ASSISTANT_SURFACE_LABELS[surface].description}
            </p>
            <Textarea
              id={`surface-instructions-${surface}`}
              value={drafts[surface]}
              maxLength={INSTRUCTIONS_MAX}
              rows={4}
              placeholder="e.g. Keep replies under three sentences and always offer a human handoff."
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [surface]: e.target.value }))
              }
              onBlur={(e) => {
                const value = e.target.value
                if (value === savedDrafts[surface]) return
                void save(surface, value)
              }}
              disabled={saving === surface}
            />
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
