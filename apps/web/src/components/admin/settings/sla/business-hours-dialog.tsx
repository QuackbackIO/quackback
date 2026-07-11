/**
 * Business hours create/edit Dialog. Holds the week-grid editor (per-weekday
 * `[start,end]` ranges) and a holiday list. Reused for both create and edit
 * via the optional `row` prop.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { BusinessHoursId } from '@quackback/ids'
import type { BusinessHours } from '@/lib/shared/db-types'
import { createBusinessHoursFn, updateBusinessHoursFn } from '@/lib/server/functions/sla'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TrashIcon, PlusIcon } from '@heroicons/react/24/outline'

interface Range {
  start: string
  end: string
}
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type Schedule = Record<DayKey, Range[]>
interface Holiday {
  date: string
  label?: string
}

const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const EMPTY_SCHEDULE: Schedule = {
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
  sat: [],
  sun: [],
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  row?: BusinessHours
}

export function BusinessHoursDialog({ open, onOpenChange, row }: Props) {
  const qc = useQueryClient()
  const isEdit = Boolean(row)

  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('UTC')
  const [schedule, setSchedule] = useState<Schedule>(EMPTY_SCHEDULE)
  const [holidays, setHolidays] = useState<Holiday[]>([])

  useEffect(() => {
    if (!open) return
    if (row) {
      setName(row.name)
      setTimezone(row.timezone)
      const sRaw = row.schedule as Partial<Schedule> | null
      setSchedule({
        mon: sRaw?.mon ?? [],
        tue: sRaw?.tue ?? [],
        wed: sRaw?.wed ?? [],
        thu: sRaw?.thu ?? [],
        fri: sRaw?.fri ?? [],
        sat: sRaw?.sat ?? [],
        sun: sRaw?.sun ?? [],
      })
      setHolidays(((row.holidays as Holiday[] | null) ?? []).map((h) => ({ ...h })))
    } else {
      setName('')
      setTimezone('UTC')
      setSchedule(JSON.parse(JSON.stringify(EMPTY_SCHEDULE)))
      setHolidays([])
    }
  }, [open, row])

  const updateRange = (day: DayKey, idx: number, patch: Partial<Range>) => {
    setSchedule((prev) => ({
      ...prev,
      [day]: prev[day].map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }))
  }
  const addRange = (day: DayKey) => {
    setSchedule((prev) => ({
      ...prev,
      [day]: [...prev[day], { start: '09:00', end: '17:00' }],
    }))
  }
  const removeRange = (day: DayKey, idx: number) => {
    setSchedule((prev) => ({
      ...prev,
      [day]: prev[day].filter((_, i) => i !== idx),
    }))
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Name is required'
    if (!timezone.trim()) return 'Timezone is required'
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/
    for (const { key, label } of DAYS) {
      for (const r of schedule[key]) {
        if (!timeRe.test(r.start) || !timeRe.test(r.end)) {
          return `${label}: invalid time format (use HH:MM)`
        }
        if (r.start >= r.end) return `${label}: range start must be before end`
      }
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    for (const h of holidays) {
      if (!dateRe.test(h.date)) return 'Holiday date must be YYYY-MM-DD'
    }
    return null
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createBusinessHoursFn({
        data: {
          name: name.trim(),
          timezone: timezone.trim(),
          schedule,
          holidays: holidays.length > 0 ? holidays : undefined,
        },
      }),
    onSuccess: () => {
      toast.success('Calendar created')
      qc.invalidateQueries({ queryKey: ['business-hours'] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      updateBusinessHoursFn({
        data: {
          id: row!.id as BusinessHoursId,
          name: name.trim(),
          timezone: timezone.trim(),
          schedule,
          holidays,
        },
      }),
    onSuccess: () => {
      toast.success('Calendar updated')
      qc.invalidateQueries({ queryKey: ['business-hours'] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSave = () => {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    if (isEdit) updateMutation.mutate()
    else createMutation.mutate()
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit calendar' : 'New business-hours calendar'}</DialogTitle>
          <DialogDescription>
            Define working hours per weekday. SLA policies use this to compute due times.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="bh-name">Name</Label>
              <Input
                id="bh-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. EU office hours"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bh-tz">Timezone (IANA)</Label>
              <Input
                id="bh-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. Europe/Stockholm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Schedule</Label>
            <div className="rounded border border-border/50 divide-y divide-border/50">
              {DAYS.map(({ key, label }) => (
                <div key={key} className="flex items-start gap-3 px-3 py-2">
                  <span className="text-xs font-semibold w-10 mt-1.5">{label}</span>
                  <div className="flex-1 space-y-1">
                    {schedule[key].length === 0 && (
                      <p className="text-xs text-muted-foreground py-1">Closed</p>
                    )}
                    {schedule[key].map((r, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          type="time"
                          step={60}
                          value={r.start}
                          onChange={(e) => updateRange(key, idx, { start: e.target.value })}
                          className="h-8 w-28 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">–</span>
                        <Input
                          type="time"
                          step={60}
                          value={r.end}
                          onChange={(e) => updateRange(key, idx, { end: e.target.value })}
                          className="h-8 w-28 text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => removeRange(key, idx)}
                          aria-label="Remove range"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => addRange(key)}
                  >
                    <PlusIcon className="h-3.5 w-3.5 mr-1" />
                    Range
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Holidays</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setHolidays((prev) => [...prev, { date: '', label: '' }])}
              >
                <PlusIcon className="h-3.5 w-3.5 mr-1" />
                Add holiday
              </Button>
            </div>
            {holidays.length === 0 ? (
              <p className="text-xs text-muted-foreground">No holidays.</p>
            ) : (
              <div className="space-y-1">
                {holidays.map((h, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={h.date}
                      onChange={(e) =>
                        setHolidays((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, date: e.target.value } : x))
                        )
                      }
                      className="h-8 w-40 text-xs"
                    />
                    <Input
                      value={h.label ?? ''}
                      onChange={(e) =>
                        setHolidays((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x))
                        )
                      }
                      placeholder="Label (optional)"
                      className="h-8 flex-1 text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setHolidays((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label="Remove holiday"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
