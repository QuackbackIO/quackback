import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  catalogByGroup,
  catalogForSurface,
  type NotificationChannel,
  type NotificationGroup,
  type NotificationTypeMeta,
} from '@/lib/shared/notifications/catalog'
import {
  getNotificationPreferencesFn,
  updateNotificationPreferencesFn,
  type NotificationPreferences,
} from '@/lib/server/functions/user'
import type { NotificationMatrix } from '@/lib/server/domains/subscriptions/notification-matrix'

const GROUP_LABELS: Record<NotificationGroup, string> = {
  feedback: 'Feedback',
  support: 'Support',
  changelog: 'Changelog',
}

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  inApp: 'In-app',
  email: 'Email',
  push: 'Push',
}

/** One notification-type × channel matrix, grouped into per-group tabs. */
export function NotificationMatrixForm({ surface }: { surface: 'admin' | 'portal' }) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchPreferences() {
      try {
        const result = await getNotificationPreferencesFn()
        if (!cancelled) setPreferences(result)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load preferences')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchPreferences()
    return () => {
      cancelled = true
    }
  }, [])

  const groups = useMemo(() => {
    const grouped = catalogByGroup(catalogForSurface(surface))
    return (Object.keys(grouped) as NotificationGroup[])
      .map((group) => ({ group, items: grouped[group] }))
      .filter((entry) => entry.items.length > 0)
  }, [surface])

  const [activeGroup, setActiveGroup] = useState<NotificationGroup | undefined>(
    () => groups[0]?.group
  )

  // Toggle a single (type, channel) cell. The server persists whatever
  // matrix it's handed, so we read-modify-write the full object here.
  const setCell = useCallback(
    async (type: string, channel: NotificationChannel, checked: boolean) => {
      if (!preferences) return
      const cellKey = `${type}:${channel}`
      const prevMatrix = preferences.matrix
      const nextMatrix: NotificationMatrix = {
        ...prevMatrix,
        [type]: { ...prevMatrix?.[type], [channel]: checked },
      }

      setSaving(cellKey)
      setError(null)
      setPreferences((prev) => (prev ? { ...prev, matrix: nextMatrix } : prev))

      try {
        const result = await updateNotificationPreferencesFn({ data: { matrix: nextMatrix } })
        setPreferences(result)
      } catch (err) {
        setPreferences((prev) => (prev ? { ...prev, matrix: prevMatrix } : prev))
        setError(err instanceof Error ? err.message : 'Failed to save preference')
      } finally {
        setSaving(null)
      }
    },
    [preferences]
  )

  const setEmailMuted = useCallback(
    async (checked: boolean) => {
      if (!preferences) return
      setSaving('emailMuted')
      setError(null)
      setPreferences((prev) => (prev ? { ...prev, emailMuted: checked } : prev))

      try {
        const result = await updateNotificationPreferencesFn({ data: { emailMuted: checked } })
        setPreferences(result)
      } catch (err) {
        setPreferences((prev) => (prev ? { ...prev, emailMuted: !checked } : prev))
        setError(err instanceof Error ? err.message : 'Failed to save preference')
      } finally {
        setSaving(null)
      }
    },
    [preferences]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <ArrowPathIcon className="h-6 w-6 animate-spin text-muted-foreground" />
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

  const busy = saving !== null

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Master email kill switch - overrides every "email" cell below. */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-border/50">
        <div className="pr-4">
          <p className="text-sm font-medium">Pause all email</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Turn off email delivery for every notification type below. In-app notifications keep
            working.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving === 'emailMuted' && (
            <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <Switch
            aria-label="Pause all email notifications"
            checked={preferences.emailMuted}
            onCheckedChange={setEmailMuted}
            disabled={busy}
          />
        </div>
      </div>

      <Tabs
        value={activeGroup}
        onValueChange={(value) => setActiveGroup(value as NotificationGroup)}
      >
        <TabsList>
          {groups.map(({ group }) => (
            <TabsTrigger key={group} value={group}>
              {GROUP_LABELS[group]}
            </TabsTrigger>
          ))}
        </TabsList>
        {groups.map(({ group, items }) => (
          <TabsContent key={group} value={group}>
            <MatrixHeaderRow />
            <div className="divide-y divide-border/50">
              {items.map((meta) => (
                <MatrixRow
                  key={meta.type}
                  meta={meta}
                  matrix={preferences.matrix}
                  busy={busy}
                  onToggle={setCell}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

const MATRIX_GRID_COLS = 'grid-cols-[1fr_56px_56px_56px]'

function MatrixHeaderRow() {
  return (
    <div className={`grid ${MATRIX_GRID_COLS} items-center gap-3 pb-2`}>
      <span />
      <span className="text-center text-xs font-medium text-muted-foreground">
        {CHANNEL_LABELS.inApp}
      </span>
      <span className="text-center text-xs font-medium text-muted-foreground">
        {CHANNEL_LABELS.email}
      </span>
      <span className="flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
        {CHANNEL_LABELS.push}
        <Badge size="sm" variant="secondary">
          Soon
        </Badge>
      </span>
    </div>
  )
}

function MatrixRow({
  meta,
  matrix,
  busy,
  onToggle,
}: {
  meta: NotificationTypeMeta
  matrix: NotificationMatrix | undefined
  busy: boolean
  onToggle: (type: string, channel: NotificationChannel, checked: boolean) => void
}) {
  const inAppChecked = matrix?.[meta.type]?.inApp ?? true
  const emailChecked = matrix?.[meta.type]?.email ?? true

  return (
    <div className={`grid ${MATRIX_GRID_COLS} items-center gap-3 py-3`}>
      <div className="min-w-0 pr-2">
        <p className="text-sm font-medium">{meta.label}</p>
        {meta.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
        )}
      </div>
      <div className="flex justify-center">
        <Switch
          aria-label={`${meta.label} - ${CHANNEL_LABELS.inApp}`}
          checked={inAppChecked}
          onCheckedChange={(checked) => onToggle(meta.type, 'inApp', checked)}
          disabled={busy}
        />
      </div>
      <div className="flex justify-center">
        <Switch
          aria-label={`${meta.label} - ${CHANNEL_LABELS.email}`}
          checked={emailChecked}
          onCheckedChange={(checked) => onToggle(meta.type, 'email', checked)}
          disabled={busy}
        />
      </div>
      <div className="flex justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Switch
                aria-label={`${meta.label} - ${CHANNEL_LABELS.push} (coming soon)`}
                checked={false}
                disabled
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>Available with web push</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
