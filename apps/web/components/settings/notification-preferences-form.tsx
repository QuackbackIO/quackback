'use client'

import { useState, useEffect, useCallback } from 'react'
import { Switch } from '@/components/ui/switch'
import { Loader2 } from 'lucide-react'

interface NotificationPreferencesFormProps {
  organizationId: string
}

interface Preferences {
  emailStatusChange: boolean
  emailNewComment: boolean
}

export function NotificationPreferencesForm({ organizationId }: NotificationPreferencesFormProps) {
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch preferences on mount
  useEffect(() => {
    async function fetchPreferences() {
      try {
        const response = await fetch(
          `/api/user/notification-preferences?organizationId=${organizationId}`
        )
        if (!response.ok) {
          throw new Error('Failed to fetch preferences')
        }
        const data = await response.json()
        setPreferences(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load preferences')
      } finally {
        setLoading(false)
      }
    }
    fetchPreferences()
  }, [organizationId])

  // Update a single preference
  const updatePreference = useCallback(
    async (key: keyof Preferences, value: boolean) => {
      if (!preferences) return

      setSaving(key)
      setError(null)

      // Optimistic update
      setPreferences((prev) => (prev ? { ...prev, [key]: value } : prev))

      try {
        const response = await fetch('/api/user/notification-preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId, [key]: value }),
        })

        if (!response.ok) {
          throw new Error('Failed to save preference')
        }

        const data = await response.json()
        setPreferences(data.preferences)
      } catch (err) {
        // Revert on error
        setPreferences((prev) => (prev ? { ...prev, [key]: !value } : prev))
        setError(err instanceof Error ? err.message : 'Failed to save preference')
      } finally {
        setSaving(null)
      }
    },
    [organizationId, preferences]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !preferences) {
    return (
      <div className="rounded-lg bg-destructive/10 p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (!preferences) {
    return null
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Status change emails */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Status updates</p>
          <p className="text-xs text-muted-foreground">
            Get notified when feedback you&apos;re subscribed to changes status
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving === 'emailStatusChange' && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <Switch
            checked={preferences.emailStatusChange}
            onCheckedChange={(checked) => updatePreference('emailStatusChange', checked)}
            disabled={saving !== null}
          />
        </div>
      </div>

      {/* New comment emails */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">New comments</p>
          <p className="text-xs text-muted-foreground">
            Get notified when someone comments on feedback you&apos;re subscribed to
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving === 'emailNewComment' && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <Switch
            checked={preferences.emailNewComment}
            onCheckedChange={(checked) => updatePreference('emailNewComment', checked)}
            disabled={saving !== null}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground pt-2">
        You automatically subscribe to posts you submit, vote on, or comment on. Use the bell icon
        on each post to manage individual subscriptions.
      </p>
    </div>
  )
}
