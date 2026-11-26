import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { RADIO_TILE_DOT, RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { useUpdateWidgetConfig } from '@/lib/client/mutations/settings'
import { cn } from '@/lib/shared/utils'

type ReplyAlerts = 'badge' | 'preview' | 'full'

/** A mini launcher in the corner of each picture. */
function Launcher({ badge = false }: { badge?: boolean }) {
  return (
    <>
      <circle cx="76" cy="50" r="8" className="fill-foreground/80" />
      {badge && <circle cx="82" cy="44" r="3.5" className="fill-red-600" />}
    </>
  )
}

/** A mini reply card above the launcher: `lines` text bars and a reply pill. */
function MiniCard({ lines, top }: { lines: number; top: number }) {
  return (
    <>
      <rect
        x="26"
        y={top}
        width="58"
        height={lines * 6 + 16}
        rx="4"
        className="fill-background stroke-border"
      />
      {Array.from({ length: lines }, (_, i) => (
        <rect
          key={i}
          x="31"
          y={top + 5 + i * 6}
          width={i === lines - 1 ? 30 : 46}
          height="3"
          rx="1.5"
          className="fill-muted-foreground/50"
        />
      ))}
      <rect
        x="31"
        y={top + lines * 6 + 7}
        width="48"
        height="5"
        rx="2.5"
        className="fill-muted-foreground/20"
      />
    </>
  )
}

const PICTURES: Record<ReplyAlerts, ReactNode> = {
  badge: <Launcher badge />,
  preview: (
    <>
      <MiniCard lines={2} top={10} />
      <Launcher badge />
    </>
  ),
  full: (
    <>
      <MiniCard lines={4} top={2} />
      <Launcher badge />
    </>
  ),
}

const OPTIONS: { value: ReplyAlerts; title: string }[] = [
  { value: 'badge', title: 'Badge only' },
  { value: 'preview', title: 'Preview' },
  { value: 'full', title: 'Full message' },
]

/**
 * How an unread reply shows to a visitor while the widget is closed, and
 * whether it flashes in the host page's tab title. Saved like the
 * neighbouring widget settings, reverting on a failed save.
 */
export function ReplyAlertsCard({
  config,
}: {
  config: { messenger?: { replyAlerts?: ReplyAlerts; titleAlerts?: boolean } }
}) {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [replyAlerts, setReplyAlerts] = useState<ReplyAlerts>(
    config.messenger?.replyAlerts ?? 'preview'
  )
  const [titleAlerts, setTitleAlerts] = useState(config.messenger?.titleAlerts === true)
  const isBusy = saving || isPending

  async function save(
    messenger: { replyAlerts: ReplyAlerts } | { titleAlerts: boolean },
    revert: () => void
  ) {
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync({ messenger })
      startTransition(() => router.invalidate())
    } catch {
      revert()
    } finally {
      setSaving(false)
    }
  }

  function chooseStyle(next: ReplyAlerts) {
    const previous = replyAlerts
    setReplyAlerts(next)
    void save({ replyAlerts: next }, () => setReplyAlerts(previous))
  }

  function toggleTitle(checked: boolean) {
    setTitleAlerts(checked)
    void save({ titleAlerts: checked }, () => setTitleAlerts(!checked))
  }

  return (
    <SettingsCard title="Reply alerts" description="How a reply shows while the widget is closed.">
      <RadioGroup
        name="reply-alerts"
        aria-label="Reply alerts"
        value={replyAlerts}
        onValueChange={(next) => chooseStyle(next as ReplyAlerts)}
        disabled={isBusy}
        className="grid-cols-3 gap-2.5"
      >
        {OPTIONS.map((option) => {
          const selected = option.value === replyAlerts
          return (
            <label
              key={option.value}
              data-slot="reply-alerts-tile"
              data-selected={selected}
              className={cn(
                'flex flex-col gap-2 rounded-xl border p-2.5 transition-colors',
                selected
                  ? 'border-primary bg-primary/10 ring-1 ring-primary'
                  : 'border-border hover:bg-muted/40',
                isBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              )}
            >
              <svg
                viewBox="0 0 96 64"
                aria-hidden="true"
                className="h-auto w-full rounded-md bg-muted/60"
              >
                {PICTURES[option.value]}
              </svg>
              <span className="flex items-center gap-2">
                <RadioGroupItem value={option.value} disabled={isBusy} className={RADIO_TILE_DOT} />
                <span className="text-sm font-medium">{option.title}</span>
              </span>
            </label>
          )
        })}
      </RadioGroup>

      <SettingRows className="mt-4">
        <SettingRow
          label="Show replies in the tab title"
          description={'"Alex replied" while the visitor is on another tab.'}
          htmlFor="widget-title-alerts"
          control={
            <Switch
              id="widget-title-alerts"
              checked={titleAlerts}
              onCheckedChange={toggleTitle}
              disabled={isBusy}
            />
          }
        />
      </SettingRows>
    </SettingsCard>
  )
}
