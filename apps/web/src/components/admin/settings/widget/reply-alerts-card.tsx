import { useState, useTransition } from 'react'
import { Radio } from '@base-ui/react/radio'
import { useRouter } from '@tanstack/react-router'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { RadioGroup } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { useUpdateWidgetConfig } from '@/lib/client/mutations/settings'

type ReplyAlerts = 'badge' | 'preview' | 'full'

/** Each tile's picture: a mini reply card (none, short, tall) above a mini
 *  launcher with its badge. Few nodes, as the page renders on the server. */
const CARD_PATHS: Record<ReplyAlerts, { card: string; bars: string } | null> = {
  badge: null,
  preview: { card: 'M26 10h58v28H26z', bars: 'M31 15h46v3H31zM31 21h30v3H31zM31 29h48v5H31z' },
  full: {
    card: 'M26 2h58v40H26z',
    bars: 'M31 7h46v3H31zM31 13h46v3H31zM31 19h46v3H31zM31 25h30v3H31zM31 33h48v5H31z',
  },
}

function Picture({ kind }: { kind: ReplyAlerts }) {
  const paths = CARD_PATHS[kind]
  return (
    <svg viewBox="0 0 96 64" aria-hidden="true" className="w-full rounded-md bg-muted">
      {paths && <path d={paths.card} className="fill-background stroke-border" />}
      {paths && <path d={paths.bars} className="fill-muted-foreground/50" />}
      <circle cx="76" cy="50" r="8" className="fill-primary" />
      <circle cx="82" cy="44" r="3.5" className="fill-destructive" />
    </svg>
  )
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
        {OPTIONS.map((option) => (
          <Radio.Root
            key={option.value}
            value={option.value}
            className="flex cursor-pointer flex-col gap-1.5 rounded-xl border p-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring data-checked:border-primary data-checked:bg-primary/10 data-disabled:opacity-50"
          >
            <Picture kind={option.value} />
            {option.title}
          </Radio.Root>
        ))}
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
