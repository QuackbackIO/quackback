import { useEffect, useMemo, useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery, queryOptions } from '@tanstack/react-query'
import { ClockIcon } from '@heroicons/react/24/solid'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import {
  isWithinOfficeHours,
  nextOpenAt,
  isValidTimeZone,
  officeHoursScheduleSchema,
  zonedParts,
  DEFAULT_OFFICE_HOURS_SCHEDULE,
  type OfficeHoursSchedule,
  type OfficeHoursInterval,
  type OfficeHoursHoliday,
} from '@/lib/shared/office-hours'
import { fetchOfficeHoursFn, updateOfficeHoursFn } from '@/lib/server/functions/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Combobox } from '@/components/ui/combobox'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** IANA zones for the timezone picker; resolved once at module load. */
const TIME_ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
})()

const officeHoursQuery = queryOptions({
  queryKey: ['settings', 'officeHours'],
  queryFn: () => fetchOfficeHoursFn(),
  staleTime: 5 * 60 * 1000,
})

export const Route = createFileRoute('/admin/settings/office-hours')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.OFFICE_HOURS_MANAGE)
    await context.queryClient.ensureQueryData(officeHoursQuery)
    return {}
  },
  component: OfficeHoursRoute,
})

/** Gate behind the same experimental flag the rest of the Support area uses. */
function OfficeHoursRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/settings" />
  }
  return <OfficeHoursPage />
}

/** Local timezone, used to seed a fresh schedule so times read sensibly. */
function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Today rendered in `tz` as 'YYYY-MM-DD' — seeds a fresh holiday row. */
function todayInScheduleTz(tz: string): string {
  const { year, month, day } = zonedParts(isValidTimeZone(tz) ? tz : 'UTC', new Date())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/** A sensible starter when an admin first enables office hours: Mon–Fri 9–5. */
function starterIntervals(): OfficeHoursInterval[] {
  return [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' }))
}

/** Validity mirrors the server exactly by reusing the shared write-time schema. */
function isScheduleValid(schedule: OfficeHoursSchedule): boolean {
  return officeHoursScheduleSchema.safeParse(schedule).success
}

function OfficeHoursPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(officeHoursQuery)
  const [schedule, setSchedule] = useState<OfficeHoursSchedule>(
    data ?? DEFAULT_OFFICE_HOURS_SCHEDULE
  )
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (next: OfficeHoursSchedule) => updateOfficeHoursFn({ data: next }),
    onSuccess: (saved) => {
      setSchedule(saved)
      queryClient.setQueryData(officeHoursQuery.queryKey, saved)
    },
  })

  // Persist the whole schedule (arrays replace, never merge). Invalid drafts
  // (e.g. equal start/end) update local state but aren't sent.
  function save(next: OfficeHoursSchedule) {
    if (!isScheduleValid(next)) {
      setError(
        'Each window needs a start and end time that differ, and every holiday needs a valid date.'
      )
      return
    }
    setError(null)
    mutation.mutate(next)
  }

  // Discrete controls (toggle, timezone, add/remove, copy) save on change.
  function apply(next: OfficeHoursSchedule) {
    setSchedule(next)
    save(next)
  }

  const tzOptions = useMemo(() => {
    const zones = TIME_ZONES.includes(schedule.timezone)
      ? TIME_ZONES
      : [schedule.timezone, ...TIME_ZONES]
    return zones.map((tz) => ({ value: tz, label: tz.replace(/_/g, ' ') }))
  }, [schedule.timezone])

  const isBusy = mutation.isPending

  function onToggleEnabled(checked: boolean) {
    apply({
      enabled: checked,
      timezone:
        schedule.timezone && schedule.timezone !== 'UTC' ? schedule.timezone : localTimeZone(),
      intervals:
        checked && schedule.intervals.length === 0 ? starterIntervals() : schedule.intervals,
      // Holidays survive the toggle; they're simply inert while disabled.
      holidays: schedule.holidays,
    })
  }

  // Time inputs edit local state on change and persist on blur, so typing a
  // time doesn't fire a save per keystroke.
  function editInterval(index: number, patch: Partial<OfficeHoursInterval>) {
    setSchedule((s) => ({
      ...s,
      intervals: s.intervals.map((iv, i) => (i === index ? { ...iv, ...patch } : iv)),
    }))
  }

  function addInterval(day: number) {
    apply({
      ...schedule,
      intervals: [...schedule.intervals, { day, start: '09:00', end: '17:00' }],
    })
  }

  function removeInterval(index: number) {
    apply({ ...schedule, intervals: schedule.intervals.filter((_, i) => i !== index) })
  }

  function copyDayToAll(day: number) {
    const source = schedule.intervals.filter((iv) => iv.day === day)
    const cloned: OfficeHoursInterval[] = []
    for (let d = 0; d <= 6; d++) {
      for (const iv of source) cloned.push({ day: d, start: iv.start, end: iv.end })
    }
    apply({ ...schedule, intervals: cloned })
  }

  // Holidays mirror the interval editors: add/remove/the recurring toggle save
  // on change, the date + name inputs edit local state and persist on blur.
  function editHoliday(index: number, patch: Partial<OfficeHoursHoliday>) {
    setSchedule((s) => ({
      ...s,
      holidays: (s.holidays ?? []).map((h, i) => (i === index ? { ...h, ...patch } : h)),
    }))
  }

  function addHoliday() {
    apply({
      ...schedule,
      holidays: [
        ...(schedule.holidays ?? []),
        // Seed a valid date (today in the schedule timezone) so the save lands.
        { date: todayInScheduleTz(schedule.timezone), recurringAnnual: false },
      ],
    })
  }

  function toggleHolidayRecurring(index: number, recurringAnnual: boolean) {
    apply({
      ...schedule,
      holidays: (schedule.holidays ?? []).map((h, i) =>
        i === index ? { ...h, recurringAnnual } : h
      ),
    })
  }

  function removeHoliday(index: number) {
    apply({ ...schedule, holidays: (schedule.holidays ?? []).filter((_, i) => i !== index) })
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ClockIcon}
        title="Office Hours"
        description="One weekly schedule for your team's availability. Customers only see it once a human is involved; the assistant handles things first."
      />

      <SettingsCard
        title="Availability"
        description="Off means you're available 24/7. Turn it on to define the hours your team is around."
      >
        <div className="space-y-5">
          <div className="flex items-center justify-between py-1">
            <div className="pr-4">
              <Label htmlFor="office-hours-enabled" className="text-sm font-medium cursor-pointer">
                Set office hours
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                When enabled, consumers see when you&apos;ll be back outside these windows.
              </p>
            </div>
            <Switch
              id="office-hours-enabled"
              checked={schedule.enabled}
              onCheckedChange={onToggleEnabled}
              disabled={isBusy}
            />
          </div>

          {schedule.enabled && (
            <>
              <OfficeHoursPreview schedule={schedule} />

              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Combobox
                  value={schedule.timezone}
                  onValueChange={(tz) => apply({ ...schedule, timezone: tz })}
                  options={tzOptions}
                  ariaLabel="Timezone"
                  searchPlaceholder="Search timezones…"
                  className="w-full max-w-sm"
                  disabled={isBusy}
                />
                <p className="text-xs text-muted-foreground">
                  All the times below are interpreted in this timezone.
                </p>
              </div>

              <div className="space-y-4">
                {DAY_LABELS.map((label, day) => {
                  const rows = schedule.intervals
                    .map((iv, index) => ({ iv, index }))
                    .filter((r) => r.iv.day === day)
                  return (
                    <div
                      key={day}
                      className="space-y-2 border-b border-border/40 pb-4 last:border-0"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{label}</span>
                        <div className="flex items-center gap-1">
                          {rows.length > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => copyDayToAll(day)}
                              className="text-xs text-muted-foreground"
                            >
                              Copy to all days
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => addInterval(day)}
                          >
                            <PlusIcon className="h-4 w-4" /> Add hours
                          </Button>
                        </div>
                      </div>

                      {rows.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Closed</p>
                      ) : (
                        rows.map(({ iv, index }) => (
                          <div key={index} className="flex items-center gap-3">
                            <Input
                              type="time"
                              value={iv.start}
                              onChange={(e) => editInterval(index, { start: e.target.value })}
                              onBlur={() => save(schedule)}
                              disabled={isBusy}
                              className="w-32"
                              aria-label={`${label} start`}
                            />
                            <span className="text-xs text-muted-foreground">to</span>
                            <Input
                              type="time"
                              value={iv.end}
                              onChange={(e) => editInterval(index, { end: e.target.value })}
                              onBlur={() => save(schedule)}
                              disabled={isBusy}
                              className="w-32"
                              aria-label={`${label} end`}
                            />
                            <button
                              type="button"
                              onClick={() => removeInterval(index)}
                              disabled={isBusy}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
                              aria-label={`Remove ${label} window`}
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )
                })}
              </div>

              <p className="text-xs text-muted-foreground">
                A window whose end is earlier than its start runs overnight into the next day (for
                example 22:00 to 06:00).
              </p>

              <div className="space-y-3 border-t border-border/40 pt-4">
                <div className="space-y-1">
                  <Label>Holidays</Label>
                  <p className="text-xs text-muted-foreground">
                    Days you&apos;re closed on top of the weekly windows — SLA clocks pause and
                    reply expectations don&apos;t fire. Dates are read in the schedule timezone.
                  </p>
                </div>

                {(schedule.holidays ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">None</p>
                ) : (
                  <div className="space-y-2">
                    {(schedule.holidays ?? []).map((h, index) => (
                      <div key={index} className="flex items-center gap-3">
                        <Input
                          type="date"
                          value={h.date}
                          onChange={(e) => editHoliday(index, { date: e.target.value })}
                          onBlur={() => save(schedule)}
                          disabled={isBusy}
                          className="w-40"
                          aria-label={`Holiday ${index + 1} date`}
                        />
                        <Input
                          type="text"
                          value={h.name ?? ''}
                          onChange={(e) =>
                            editHoliday(index, { name: e.target.value || undefined })
                          }
                          onBlur={() => save(schedule)}
                          disabled={isBusy}
                          placeholder="Name (optional)"
                          className="flex-1"
                          aria-label={`Holiday ${index + 1} name`}
                        />
                        <label className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
                          <Checkbox
                            checked={h.recurringAnnual ?? false}
                            onCheckedChange={(checked) =>
                              toggleHolidayRecurring(index, checked === true)
                            }
                            disabled={isBusy}
                            aria-label={`Holiday ${index + 1} repeats every year`}
                          />
                          Every year
                        </label>
                        <button
                          type="button"
                          onClick={() => removeHoliday(index)}
                          disabled={isBusy}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
                          aria-label={`Remove holiday ${index + 1}`}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={addHoliday}
                  >
                    <PlusIcon className="h-4 w-4" /> Add holiday
                  </Button>
                </div>
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </>
          )}
        </div>
      </SettingsCard>
    </div>
  )
}

/** "Open now" / "Opens <when>" line, computed with the shared resolver. */
function OfficeHoursPreview({ schedule }: { schedule: OfficeHoursSchedule }) {
  // Compute after mount only, so the SSR pass and the first client render match.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const { open, opensAt } = useMemo(() => {
    if (!now) return { open: false, opensAt: null as Date | null }
    return { open: isWithinOfficeHours(schedule, now), opensAt: nextOpenAt(schedule, now) }
  }, [schedule, now])

  if (!now) return null

  const opensLabel =
    opensAt &&
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: isValidTimeZone(schedule.timezone) ? schedule.timezone : undefined,
    }).format(opensAt)

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
      <span
        className={
          open ? 'size-2 rounded-full bg-emerald-500' : 'size-2 rounded-full bg-muted-foreground/40'
        }
        aria-hidden
      />
      {open ? (
        <span className="font-medium text-foreground">Open now</span>
      ) : opensLabel ? (
        <span className="text-muted-foreground">
          Closed &middot; opens <span className="font-medium text-foreground">{opensLabel}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">Closed</span>
      )}
    </div>
  )
}
