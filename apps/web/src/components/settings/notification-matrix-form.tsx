import { useCallback, useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Switch } from '@/components/ui/switch'
import { useMutation } from '@tanstack/react-query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { AUTOSAVE } from '@/lib/client/autosave'
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

type Message = { id: string; defaultMessage: string }

const GROUP_LABELS: Record<NotificationGroup, Message> = {
  feedback: { id: 'portal.settings.notifications.group.feedback', defaultMessage: 'Feedback' },
  support: { id: 'portal.settings.notifications.group.support', defaultMessage: 'Support' },
  changelog: { id: 'portal.settings.notifications.group.changelog', defaultMessage: 'Changelog' },
}

// Push is not offered until it is delivered.
const CHANNEL_LABELS = {
  inApp: { id: 'portal.settings.notifications.channel.inApp', defaultMessage: 'In-app' },
  email: { id: 'portal.settings.notifications.channel.email', defaultMessage: 'Email' },
} as const satisfies Partial<Record<NotificationChannel, Message>>

/** The rows the portal shows, in the app's language. Admin-only rows keep the
 *  catalog's English label and description. */
const TYPE_LABELS: Partial<
  Record<NotificationTypeMeta['type'], { label: Message; description: Message }>
> = {
  post_status_changed: {
    label: {
      id: 'portal.settings.notifications.type.statusChanged.label',
      defaultMessage: 'Status changed',
    },
    description: {
      id: 'portal.settings.notifications.type.statusChanged.description',
      defaultMessage: 'A post you follow changes status',
    },
  },
  comment_created: {
    label: {
      id: 'portal.settings.notifications.type.newComment.label',
      defaultMessage: 'New comment',
    },
    description: {
      id: 'portal.settings.notifications.type.newComment.description',
      defaultMessage: 'Someone comments on a post you follow',
    },
  },
  post_mentioned: {
    label: {
      id: 'portal.settings.notifications.type.postMention.label',
      defaultMessage: 'Mentioned in a post',
    },
    description: {
      id: 'portal.settings.notifications.type.postMention.description',
      defaultMessage: 'Someone @-mentions you in a post',
    },
  },
  comment_mentioned: {
    label: {
      id: 'portal.settings.notifications.type.commentMention.label',
      defaultMessage: 'Mentioned in a comment',
    },
    description: {
      id: 'portal.settings.notifications.type.commentMention.description',
      defaultMessage: 'Someone @-mentions you in a comment',
    },
  },
  ticket_status_changed: {
    label: {
      id: 'portal.settings.notifications.type.ticketStatusChanged.label',
      defaultMessage: 'Ticket status changed',
    },
    description: {
      id: 'portal.settings.notifications.type.ticketStatusChanged.description',
      defaultMessage: 'A ticket you own changes status',
    },
  },
  ticket_replied: {
    label: {
      id: 'portal.settings.notifications.type.ticketReplied.label',
      defaultMessage: 'Ticket replies',
    },
    description: {
      id: 'portal.settings.notifications.type.ticketReplied.description',
      defaultMessage: 'A ticket you follow receives a reply',
    },
  },
  ticket_created: {
    label: {
      id: 'portal.settings.notifications.type.ticketCreated.label',
      defaultMessage: 'Ticket received',
    },
    description: {
      id: 'portal.settings.notifications.type.ticketCreated.description',
      defaultMessage: 'Confirmation when we receive your ticket',
    },
  },
  changelog_published: {
    label: {
      id: 'portal.settings.notifications.type.changelogPublished.label',
      defaultMessage: 'Changelog published',
    },
    description: {
      id: 'portal.settings.notifications.type.changelogPublished.description',
      defaultMessage: 'A new changelog entry is published',
    },
  },
  status_incident: {
    label: {
      id: 'portal.settings.notifications.type.statusIncident.label',
      defaultMessage: 'Status incident',
    },
    description: {
      id: 'portal.settings.notifications.type.statusIncident.description',
      defaultMessage: 'A status incident or maintenance window is posted',
    },
  },
}

/**
 * One notification-type x channel matrix, grouped into per-group tabs.
 *
 * `initialPreferences`: when the caller's own loader already fetched these
 * (the portal preferences page and the admin notifications page fold this
 * into their document response, since a separate post-hydration request would
 * redo the session/principal lookup that loader already paid for), pass the
 * result here to skip the mount fetch. Without it, or when the loader's read
 * failed (null), the form fetches on mount.
 */
export function NotificationMatrixForm({
  surface,
  initialPreferences,
}: {
  surface: 'admin' | 'portal'
  initialPreferences?: NotificationPreferences | null
}) {
  const intl = useIntl()
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(
    initialPreferences ?? null
  )
  const [loading, setLoading] = useState(!initialPreferences)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialPreferences) return
    let cancelled = false
    async function fetchPreferences() {
      try {
        const result = await getNotificationPreferencesFn()
        if (!cancelled) setPreferences(result)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : intl.formatMessage({
                  id: 'portal.settings.notifications.loadFailed',
                  defaultMessage: 'Failed to load preferences',
                })
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchPreferences()
    return () => {
      cancelled = true
    }
    // initialPreferences is a loader-time snapshot: intentionally excluded so a
    // later prop identity change (there isn't one across this form's lifetime)
    // never re-triggers the mount fetch it was meant to replace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Every change saves on toggle; a failure reverts the switch and the global
  // autosave handler shows the one toast.
  const save = useMutation({
    meta: AUTOSAVE,
    mutationFn: (input: { matrix: NotificationMatrix } | { emailMuted: boolean }) =>
      updateNotificationPreferencesFn({ data: input }),
    onMutate: () => ({ previous: preferences }),
    onSuccess: (result) => setPreferences(result),
    onError: (_error, _input, context) => {
      if (context?.previous) setPreferences(context.previous)
    },
  })

  // Toggle a single (type, channel) cell. The server persists whatever
  // matrix it's handed, so we read-modify-write the full object here.
  const setCell = useCallback(
    (type: string, channel: NotificationChannel, checked: boolean) => {
      if (!preferences) return
      const prevMatrix = preferences.matrix
      const nextMatrix: NotificationMatrix = {
        ...prevMatrix,
        [type]: { ...prevMatrix?.[type], [channel]: checked },
      }
      setPreferences({ ...preferences, matrix: nextMatrix })
      save.mutate({ matrix: nextMatrix })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preferences]
  )

  const setEmailMuted = useCallback(
    (checked: boolean) => {
      if (!preferences) return
      setPreferences({ ...preferences, emailMuted: checked })
      save.mutate({ emailMuted: checked })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const busy = save.isPending
  // The admin page header shows the save status; the portal has none, so the
  // pause switch carries its own.
  const savingEmailMuted = busy && !!save.variables && 'emailMuted' in save.variables

  return (
    <div className="space-y-6">
      {/* Master email kill switch - overrides every "email" cell below. */}
      <Panel surface={surface} divided>
        <SettingRow
          label={intl.formatMessage({
            id: 'portal.settings.notifications.pauseAll.label',
            defaultMessage: 'Pause all email',
          })}
          description={intl.formatMessage({
            id: 'portal.settings.notifications.pauseAll.description',
            defaultMessage:
              'Turn off email delivery for every notification type below. In-app notifications keep working.',
          })}
          control={
            <>
              {surface === 'portal' && savingEmailMuted && (
                <span
                  role="status"
                  aria-label={intl.formatMessage({
                    id: 'portal.settings.notifications.saving',
                    defaultMessage: 'Saving',
                  })}
                  className="inline-flex"
                >
                  <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                </span>
              )}
              <Switch
                aria-label={intl.formatMessage({
                  id: 'portal.settings.notifications.pauseAll.ariaLabel',
                  defaultMessage: 'Pause all email notifications',
                })}
                checked={preferences.emailMuted}
                onCheckedChange={setEmailMuted}
                disabled={busy}
              />
            </>
          }
          className="py-0"
        />
      </Panel>

      <Tabs
        variant="line"
        className="space-y-6"
        value={activeGroup}
        onValueChange={(value) => setActiveGroup(value as NotificationGroup)}
      >
        <TabsList>
          {groups.map(({ group }) => (
            <TabsTrigger key={group} value={group}>
              {intl.formatMessage(GROUP_LABELS[group])}
            </TabsTrigger>
          ))}
        </TabsList>
        {groups.map(({ group, items }) => (
          <TabsContent key={group} value={group}>
            <Panel surface={surface}>
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
            </Panel>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

/** Admin sections sit in a card; the portal page is flat. */
function Panel({
  surface,
  divided,
  children,
}: {
  surface: 'admin' | 'portal'
  divided?: boolean
  children: React.ReactNode
}) {
  if (surface === 'admin') return <SettingsCard>{children}</SettingsCard>
  return <div className={divided ? 'pb-4 border-b border-border/50' : undefined}>{children}</div>
}

const MATRIX_GRID_COLS = 'grid-cols-[1fr_64px_64px]'

function MatrixHeaderRow() {
  const intl = useIntl()
  return (
    <div className={`grid ${MATRIX_GRID_COLS} items-center gap-3 pb-2`}>
      <span />
      <span className="text-center text-xs font-medium text-muted-foreground">
        {intl.formatMessage(CHANNEL_LABELS.inApp)}
      </span>
      <span className="text-center text-xs font-medium text-muted-foreground">
        {intl.formatMessage(CHANNEL_LABELS.email)}
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
  const intl = useIntl()
  const inAppChecked = matrix?.[meta.type]?.inApp ?? true
  const emailChecked = matrix?.[meta.type]?.email ?? true
  const translated = TYPE_LABELS[meta.type]
  const label = translated ? intl.formatMessage(translated.label) : meta.label
  const description = translated ? intl.formatMessage(translated.description) : meta.description

  return (
    <div className={`grid ${MATRIX_GRID_COLS} items-center gap-3 py-3`}>
      <div className="min-w-0 pr-2">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex justify-center">
        <Switch
          aria-label={`${label} - ${intl.formatMessage(CHANNEL_LABELS.inApp)}`}
          checked={inAppChecked}
          onCheckedChange={(checked) => onToggle(meta.type, 'inApp', checked)}
          disabled={busy}
        />
      </div>
      <div className="flex justify-center">
        <Switch
          aria-label={`${label} - ${intl.formatMessage(CHANNEL_LABELS.email)}`}
          checked={emailChecked}
          onCheckedChange={(checked) => onToggle(meta.type, 'email', checked)}
          disabled={busy}
        />
      </div>
    </div>
  )
}
