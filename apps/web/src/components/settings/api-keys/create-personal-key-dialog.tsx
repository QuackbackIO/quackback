'use client'

import { useState, useTransition } from 'react'
import { defineMessages, useIntl } from 'react-intl'
import { useRouter } from '@tanstack/react-router'
import { DomainAccessPicker } from '@/components/domain-access-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { LocalDate } from '@/components/ui/local-date'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createMyApiKeyFn } from '@/lib/server/functions/personal-api-keys'
import {
  API_KEY_SCOPES,
  domainAccessLevels,
  scopesFromDomainLevels,
  type DomainAccessLevels,
} from '@/lib/shared/api-key-scopes'
import {
  DEFAULT_PERSONAL_KEY_EXPIRY,
  PERSONAL_KEY_EXPIRY_CHOICES,
  personalKeyExpiresAt,
  type PersonalKeyExpiry,
} from '@/lib/shared/api-key-refusal'
import type { ApiKey } from '@/lib/shared/types'
import { refusalText } from '@/components/admin/settings/api-keys/key-messages'
import { PORTAL_KEY_MESSAGES, portalScopeWords } from './portal-key-messages'

const m = defineMessages({
  title: { id: 'portal.settings.apiKeys.createTitle', defaultMessage: 'Create API key' },
  actsAsYou: {
    id: 'portal.settings.apiKeys.actsAsYou',
    defaultMessage: 'Keys act as you. They can see and do what you can.',
  },
  name: { id: 'portal.settings.apiKeys.name', defaultMessage: 'Name' },
  namePlaceholder: {
    id: 'portal.settings.apiKeys.namePlaceholder',
    defaultMessage: 'e.g. Inbox triage script',
  },
  access: { id: 'portal.settings.apiKeys.access', defaultMessage: 'Access' },
  accessHint: {
    id: 'portal.settings.apiKeys.accessHint',
    defaultMessage:
      'The key can only do what you select. Read and write includes lookup in that area.',
  },
  expires: { id: 'portal.settings.apiKeys.expires', defaultMessage: 'Expires' },
  expiresOn: {
    id: 'portal.settings.apiKeys.expiresOn',
    defaultMessage: 'The key stops working on {date}.',
  },
  neverExpires: {
    id: 'portal.settings.apiKeys.neverExpiresHint',
    defaultMessage: 'The key works until you revoke it or leave the workspace.',
  },
  days30: { id: 'portal.settings.apiKeys.expiry.30d', defaultMessage: '30 days' },
  days90: { id: 'portal.settings.apiKeys.expiry.90d', defaultMessage: '90 days' },
  year: { id: 'portal.settings.apiKeys.expiry.1y', defaultMessage: '1 year' },
  never: { id: 'portal.settings.apiKeys.expiry.never', defaultMessage: 'No expiry' },
  cancel: { id: 'portal.settings.apiKeys.cancel', defaultMessage: 'Cancel' },
  create: { id: 'portal.settings.apiKeys.create', defaultMessage: 'Create key' },
  creating: { id: 'portal.settings.apiKeys.creating', defaultMessage: 'Creating...' },
  failed: {
    id: 'portal.settings.apiKeys.createFailed',
    defaultMessage: 'The key could not be created.',
  },
})

/** "Feb 4, 2027" */
const EXPIRY_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

const EXPIRY_LABELS = {
  '30d': m.days30,
  '90d': m.days90,
  '1y': m.year,
  never: m.never,
} as const

function defaultLevels(): DomainAccessLevels {
  return domainAccessLevels(API_KEY_SCOPES)
}

/** Make a personal key that acts as the signed-in teammate. */
export function CreatePersonalKeyDialog({
  open,
  onOpenChange,
  onKeyCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onKeyCreated: (key: ApiKey, plainTextKey: string) => void
}) {
  const intl = useIntl()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [levels, setLevels] = useState<DomainAccessLevels>(defaultLevels)
  const [expiry, setExpiry] = useState<PersonalKeyExpiry>(DEFAULT_PERSONAL_KEY_EXPIRY)
  const [error, setError] = useState<string | null>(null)

  const scopes = scopesFromDomainLevels(levels)
  const busy = saving || isPending
  const expiresAt = personalKeyExpiresAt(expiry)

  const reset = () => {
    setName('')
    setLevels(defaultLevels())
    setExpiry(DEFAULT_PERSONAL_KEY_EXPIRY)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || scopes.length === 0) return
    setError(null)
    setSaving(true)
    try {
      const result = await createMyApiKeyFn({ data: { name: name.trim(), scopes, expiry } })
      if (!result.ok) {
        setError(refusalText(intl, PORTAL_KEY_MESSAGES, result.code))
        return
      }
      startTransition(() => {
        router.invalidate()
      })
      reset()
      onKeyCreated(result.apiKey, result.plainTextKey)
    } catch {
      setError(intl.formatMessage(m.failed))
    } finally {
      setSaving(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage(m.title)}</DialogTitle>
          <DialogDescription>{intl.formatMessage(m.actsAsYou)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="personal-key-name">{intl.formatMessage(m.name)}</Label>
              <Input
                id="personal-key-name"
                placeholder={intl.formatMessage(m.namePlaceholder)}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>{intl.formatMessage(m.access)}</Label>
              <div className="overflow-hidden rounded-lg border border-border/50">
                <DomainAccessPicker
                  levels={levels}
                  onChange={setLevels}
                  disabled={busy}
                  words={portalScopeWords(intl)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{intl.formatMessage(m.accessHint)}</p>
            </div>
            <div className="space-y-2">
              <Label>{intl.formatMessage(m.expires)}</Label>
              <RadioGroup
                value={expiry}
                onValueChange={(next) => setExpiry(next as PersonalKeyExpiry)}
                disabled={busy}
                className="grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {PERSONAL_KEY_EXPIRY_CHOICES.map((choice) => (
                  <label
                    key={choice}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm has-[[data-checked]]:border-primary/40 has-[[data-checked]]:bg-primary/5"
                  >
                    <RadioGroupItem
                      value={choice}
                      aria-label={intl.formatMessage(EXPIRY_LABELS[choice])}
                    />
                    {intl.formatMessage(EXPIRY_LABELS[choice])}
                  </label>
                ))}
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                {expiresAt
                  ? intl.formatMessage(m.expiresOn, {
                      date: <LocalDate date={expiresAt} options={EXPIRY_DATE} />,
                    })
                  : intl.formatMessage(m.neverExpires)}
              </p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              {intl.formatMessage(m.cancel)}
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || scopes.length === 0}>
              {intl.formatMessage(busy ? m.creating : m.create)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
