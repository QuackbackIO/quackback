import { useState } from 'react'
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeTrustedSenderEntry, MAX_TRUSTED_SENDERS } from '@/lib/shared/trusted-senders'

interface TrustedSendersCardProps {
  entries: string[]
  /** Persist the full replacement list; resolves once the server accepted it. */
  onSave: (entries: string[]) => Promise<void>
}

/**
 * The spam filter's trusted-sender list: entries here bypass inbound spam
 * classification entirely. An entry is a full address (`jane@acme.com`) or a
 * whole domain (`acme.com`). The server re-validates on save; the client
 * validates first so a typo never makes the round trip.
 */
export function TrustedSendersCard({ entries, onSave }: TrustedSendersCardProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(next: string[]) {
    setSaving(true)
    try {
      await onSave(next)
      setDraft('')
      setError(null)
    } catch {
      setError('Could not save the list. Try again.')
    } finally {
      setSaving(false)
    }
  }

  function addEntry() {
    const normalized = normalizeTrustedSenderEntry(draft)
    if (!normalized) {
      setError('Enter a valid email address or domain (e.g. jane@acme.com or acme.com).')
      return
    }
    if (entries.includes(normalized)) {
      setError('That sender is already on the list.')
      return
    }
    if (entries.length >= MAX_TRUSTED_SENDERS) {
      setError(`The list is capped at ${MAX_TRUSTED_SENDERS} entries.`)
      return
    }
    void save([...entries, normalized])
  }

  return (
    <SettingsCard
      title="Trusted senders"
      description="Senders that always skip the spam filter. Add a full address to trust one mailbox, or a domain to trust everyone at it."
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="trusted-sender-input" className="sr-only">
              Add trusted sender
            </Label>
            <Input
              id="trusted-sender-input"
              value={draft}
              placeholder="jane@acme.com or acme.com"
              onChange={(e) => {
                setDraft(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addEntry()
                }
              }}
              disabled={saving}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addEntry}
            disabled={!draft.trim() || saving}
            className="h-9 shrink-0"
          >
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        {entries.length > 0 ? (
          <ul className="space-y-1.5" role="list" aria-label="Trusted senders">
            {entries.map((entry) => (
              <li
                key={entry}
                className="flex items-center justify-between rounded-md border border-border/50 bg-muted/30 px-3 py-1.5"
              >
                <span className="text-sm font-mono">{entry}</span>
                <button
                  type="button"
                  onClick={() => void save(entries.filter((e) => e !== entry))}
                  disabled={saving}
                  className="ml-2 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 transition-colors"
                  aria-label={`Remove ${entry}`}
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            No trusted senders — every inbound message goes through spam classification.
          </p>
        )}
      </div>
    </SettingsCard>
  )
}
