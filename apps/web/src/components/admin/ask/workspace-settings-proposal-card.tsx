import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import type { AssistantPendingActionId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { assistantPendingActionQueries } from '@/lib/client/queries/assistant-pending-actions'
import type { CopilotProposedAction } from '@/lib/shared/assistant/copilot-contract'
import {
  settingsProposalSchema,
  type MessengerEffect,
  type SettingsChange,
} from '@/lib/shared/assistant/settings-proposals'
import {
  applyWorkspaceSettingsProposalFn,
  undoWorkspaceSettingsProposalFn,
} from '@/lib/server/functions/workspace-copilot'
import { sanitizeImageUrl } from '@/lib/shared/utils/sanitize'
import { refreshSettingsProposalQueries } from './settings-proposal-cache'

export const SETTINGS_CARD_AREA_COPY = {
  branding: 'Branding',
  portal: 'Portal',
  messenger: 'Messenger',
  modules: 'Modules',
  office_hours: 'Office hours',
  changelog: 'Changelog',
} as const
/** Labels for every field a settings proposal can carry. */
export const SETTINGS_CARD_FIELD_COPY: Record<string, string> = {
  logoKey: 'Logo',
  themeMode: 'Appearance',
  displayName: 'Workspace name',
  enabled: 'Enabled',
  welcomeMessage: 'Welcome message',
  supportInbox: 'Support inbox',
  supportTickets: 'Tickets',
  helpCenter: 'Help Center',
  statusPage: 'Status page',
  timezone: 'Timezone',
  intervals: 'Weekly hours',
  holidays: 'Holidays',
  audience: 'Audience',
  autoSubscribe: 'Auto-subscribe',
  emailsDisabled: 'Emails disabled',
  background: 'Background',
  foreground: 'Text',
  card: 'Card',
  primary: 'Brand color',
  secondary: 'Secondary',
  muted: 'Muted',
  mutedForeground: 'Muted text',
  accent: 'Accent',
  destructive: 'Destructive',
  border: 'Border',
  ring: 'Focus ring',
  radius: 'Corner radius',
  success: 'Success',
  fontSans: 'Font',
}
const MESSENGER_EFFECT_COPY: Record<MessengerEffect, { id: string; defaultMessage: string }> = {
  messengerTab: {
    id: 'ask.settings.effect.messengerTabOn',
    defaultMessage: 'Shows the Messages tab in the widget',
  },
  widget: { id: 'ask.settings.effect.widget', defaultMessage: 'Turns on the widget' },
  supportInbox: {
    id: 'ask.settings.effect.supportInbox',
    defaultMessage: 'Turns on the support inbox and portal chats',
  },
}
const MESSENGER_TAB_OFF_COPY = {
  id: 'ask.settings.effect.messengerTabOff',
  defaultMessage: 'Hides the Messages tab in the widget',
}

export interface SettingsChangeCardProps {
  changes: readonly SettingsChange[]
  status: 'proposed' | 'executed' | 'undone' | 'unavailable'
  busy: boolean
  error?: string | null
  onApply: (selectedChangeIds: string[]) => void
  onUndo: () => void
  onOpenSettings: (href: string) => void
}

/** Office hours and other structured values as one readable line. */
function readableValue(value: unknown, locale: string): string {
  if (!Array.isArray(value)) {
    if (value && typeof value === 'object')
      return Object.values(value as Record<string, unknown>)
        .map((item) => readableValue(item, locale))
        .join(', ')
    return String(value)
  }
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return String(item)
      const entry = item as Record<string, unknown>
      if (typeof entry.day === 'number' && typeof entry.start === 'string')
        return `${weekday.format(Date.UTC(2023, 0, 1 + entry.day))} ${entry.start}-${String(entry.end)}`
      if (typeof entry.date === 'string')
        return typeof entry.name === 'string' && entry.name
          ? `${entry.name} (${entry.date})`
          : entry.date
      return readableValue(entry, locale)
    })
    .join(', ')
}

function SettingsValue({ value, preview }: { value: unknown; preview?: string | null }) {
  const intl = useIntl()
  const enums: Record<string, string> = {
    light: 'Light',
    dark: 'Dark',
    user: 'Follow visitor',
    public: 'Public',
    authenticated: 'Signed-in users',
  }
  const text =
    value == null || value === '' || (Array.isArray(value) && value.length === 0)
      ? intl.formatMessage({ id: 'ask.settings.notSet', defaultMessage: 'Not set' })
      : typeof value === 'boolean'
        ? intl.formatMessage({
            id: value ? 'ask.settings.on' : 'ask.settings.off',
            defaultMessage: value ? 'On' : 'Off',
          })
        : typeof value === 'string' && enums[value]
          ? intl.formatMessage({ id: `ask.settings.value.${value}`, defaultMessage: enums[value] })
          : readableValue(value, intl.locale)
  const color =
    typeof value === 'string' &&
    /^(?:#[\da-f]{3,8}|(?:oklch|oklab|hsl|hsla|rgb|rgba)\([\d\s.,%+\-/]+\)|transparent)$/i.test(
      value
    )
      ? value
      : null
  const imageUrl = preview ? sanitizeImageUrl(preview) : null
  return (
    <span className="flex min-w-0 items-center gap-2">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="size-8 shrink-0 rounded object-contain" />
      ) : (
        color && (
          <span
            aria-hidden="true"
            className="size-5 shrink-0 rounded border border-border"
            style={{ backgroundColor: color }}
          />
        )
      )}
      <span className="min-w-0 truncate">
        {imageUrl
          ? intl.formatMessage({ id: 'ask.settings.field.logoKey', defaultMessage: 'Logo' })
          : text}
      </span>
    </span>
  )
}

export function SettingsChangeCard({
  changes,
  status,
  busy,
  error,
  onApply,
  onUndo,
  onOpenSettings,
}: SettingsChangeCardProps) {
  const intl = useIntl()
  const [selection, setSelection] = useState<Set<string> | null>(null)
  const selected = selection ?? new Set(changes.map((change) => change.id))
  const count = changes.filter((change) => selected.has(change.id)).length
  // One way into settings per card: a link per page the changes live on.
  const pages = [
    ...new Map(
      changes.map((change) => [
        change.settingsHref,
        {
          href: change.settingsHref,
          area: intl.formatMessage({
            id: `ask.settings.area.${change.area}`,
            defaultMessage: SETTINGS_CARD_AREA_COPY[change.area],
          }),
        },
      ])
    ).values(),
  ]
  const title =
    status === 'executed'
      ? intl.formatMessage({ id: 'ask.settings.applied', defaultMessage: 'Changes applied' })
      : status === 'undone'
        ? intl.formatMessage({ id: 'ask.settings.undone', defaultMessage: 'Changes undone' })
        : status === 'unavailable'
          ? intl.formatMessage({
              id: 'ask.settings.unavailable',
              defaultMessage: 'These changes are unavailable.',
            })
          : intl.formatMessage({ id: 'ask.settings.proposed', defaultMessage: 'Proposed changes' })
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-raise">
      <p className="text-sm font-medium">{title}</p>
      {changes.map((change) => {
        const area = intl.formatMessage({
          id: `ask.settings.area.${change.area}`,
          defaultMessage: SETTINGS_CARD_AREA_COPY[change.area],
        })
        const field = change.path.at(-1)!
        const fieldLabel = intl.formatMessage({
          id: `ask.settings.field.${field}`,
          defaultMessage: SETTINGS_CARD_FIELD_COPY[field] ?? field,
        })
        const appearance =
          change.path[0] === 'light' || change.path[0] === 'dark'
            ? intl.formatMessage({
                id: `ask.settings.value.${change.path[0]}`,
                defaultMessage: change.path[0] === 'light' ? 'Light' : 'Dark',
              })
            : null
        const changeLabel = `${area}: ${appearance ? `${appearance} · ` : ''}${fieldLabel}`
        const before = status === 'undone' ? change.after : change.before
        const after = status === 'undone' ? change.before : change.after
        return (
          <div key={change.id} className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {status === 'proposed' && (
                  <Checkbox
                    aria-label={changeLabel}
                    checked={selected.has(change.id)}
                    disabled={busy}
                    className="focus-visible:border-muted-foreground focus-visible:ring-foreground/25"
                    onCheckedChange={(checked) =>
                      setSelection((previous) => {
                        const next = new Set(previous ?? changes.map((item) => item.id))
                        if (checked) next.add(change.id)
                        else next.delete(change.id)
                        return next
                      })
                    }
                  />
                )}
                <span className="truncate font-medium">{changeLabel}</span>
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-xs">
              <SettingsValue
                value={before}
                preview={status === 'undone' ? change.afterPreview : change.beforePreview}
              />
              <span aria-hidden="true">→</span>
              <SettingsValue
                value={after}
                preview={status === 'undone' ? change.beforePreview : change.afterPreview}
              />
            </div>
            {status !== 'undone' && change.effects && change.effects.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {change.effects.map((effect) => (
                  <li key={effect}>
                    {intl.formatMessage(
                      effect === 'messengerTab' && change.after !== true
                        ? MESSENGER_TAB_OFF_COPY
                        : MESSENGER_EFFECT_COPY[effect]
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-2">
        {status === 'proposed' && (
          <Button
            type="button"
            size="sm"
            disabled={busy || count === 0}
            className="focus-visible:ring-foreground/25"
            onClick={() => {
              if (count > 0)
                onApply(
                  changes.filter((change) => selected.has(change.id)).map((change) => change.id)
                )
            }}
          >
            {intl.formatMessage(
              {
                id: 'ask.settings.apply',
                defaultMessage: 'Apply {count, plural, one {# change} other {# changes}}',
              },
              { count }
            )}
          </Button>
        )}
        {status === 'executed' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onUndo}
            className="focus-visible:ring-foreground/25"
          >
            {intl.formatMessage({ id: 'ask.settings.undo', defaultMessage: 'Undo' })}
          </Button>
        )}
        {pages.map((page) => (
          <Button
            key={page.href}
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs focus-visible:ring-foreground/25"
            onClick={() => onOpenSettings(page.href)}
          >
            {pages.length === 1
              ? intl.formatMessage({ id: 'ask.settings.open', defaultMessage: 'Open in settings' })
              : intl.formatMessage(
                  { id: 'ask.settings.openArea', defaultMessage: '{area} settings' },
                  { area: page.area }
                )}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function WorkspaceSettingsProposalCard({ action }: { action: CopilotProposedAction }) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const options = assistantPendingActionQueries.detail(action.id as AssistantPendingActionId)
  const detail = useQuery(options)
  const [error, setError] = useState<string | null>(null)
  const onError = (failure: unknown) => {
    const code =
      failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : ''
    const messages: Record<string, { id: string; defaultMessage: string }> = {
      WEBSITE_BRANDING_UNAVAILABLE: {
        id: 'ask.settings.websiteUnavailable',
        defaultMessage: 'Choose another website or upload a logo in Portal settings.',
      },
      SETTINGS_NAME_MANAGED: {
        id: 'ask.settings.nameManaged',
        defaultMessage: 'Open General settings to change this workspace name.',
      },
      SETTINGS_PERMISSION_REQUIRED: {
        id: 'ask.settings.permissionRequired',
        defaultMessage: 'Ask a workspace owner to make this change.',
      },
      SETTINGS_CHANGED: {
        id: 'ask.settings.changed',
        defaultMessage: 'These settings changed. Ask Copilot again.',
      },
      SETTINGS_UNDO_CONFLICT: {
        id: 'ask.settings.undoConflict',
        defaultMessage: 'These settings changed since Apply. Undo is unavailable.',
      },
      INVALID_SETTINGS_PROPOSAL: {
        id: 'ask.settings.invalid',
        defaultMessage: 'Choose matching Messenger and Support settings.',
      },
      INVALID_SETTINGS_UNDO: {
        id: 'ask.settings.undoUnavailable',
        defaultMessage: 'This change cannot be undone.',
      },
      SETTINGS_UNDO_UNAVAILABLE: {
        id: 'ask.settings.undoUnavailable',
        defaultMessage: 'This change cannot be undone.',
      },
    }
    setError(
      intl.formatMessage(
        messages[code] ?? {
          id: 'ask.settings.failed',
          defaultMessage: 'The changes could not be saved. Try again.',
        }
      )
    )
    void queryClient.invalidateQueries({ queryKey: options.queryKey })
  }
  const onSuccess = async (result: { result: unknown }) => {
    setError(null)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: options.queryKey }),
      refreshSettingsProposalQueries(queryClient, result.result),
    ])
    await router.invalidate()
  }
  const apply = useMutation({
    mutationFn: (selectedChangeIds: string[]) =>
      applyWorkspaceSettingsProposalFn({ data: { pendingActionId: action.id, selectedChangeIds } }),
    onError,
    onSuccess,
  })
  const undo = useMutation({
    mutationFn: () => undoWorkspaceSettingsProposalFn({ data: { pendingActionId: action.id } }),
    onError,
    onSuccess,
  })
  const rawReceipt = detail.data?.result
  const receipt =
    rawReceipt && typeof rawReceipt === 'object' && !Array.isArray(rawReceipt) ? rawReceipt : null
  const proposal = settingsProposalSchema.safeParse(
    detail.data?.status === 'executed' && receipt?.kind === 'settings'
      ? { kind: 'settings', version: 1, changes: receipt.changes }
      : detail.data?.args
  )
  if (!proposal.success)
    return (
      <p className="text-sm text-muted-foreground">
        {intl.formatMessage({
          id: detail.isPending ? 'ask.settings.loading' : 'ask.settings.unavailable',
          defaultMessage: detail.isPending ? 'Checking changes…' : 'These changes are unavailable.',
        })}
      </p>
    )
  const status =
    detail.data?.status === 'proposed'
      ? 'proposed'
      : detail.data?.status === 'executed'
        ? receipt?.undoneAt
          ? 'undone'
          : 'executed'
        : 'unavailable'
  return (
    <SettingsChangeCard
      changes={proposal.data.changes}
      status={status}
      busy={apply.isPending || undo.isPending}
      error={error}
      onApply={(ids) => apply.mutate(ids)}
      onUndo={() => undo.mutate()}
      onOpenSettings={(href) => void router.navigate({ href })}
    />
  )
}
