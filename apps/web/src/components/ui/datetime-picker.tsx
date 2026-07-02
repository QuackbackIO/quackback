'use client'

import * as React from 'react'
import { format, isSameDay, parseISO, startOfDay } from 'date-fns'
import { CalendarIcon, ClockIcon, XMarkIcon } from '@heroicons/react/24/outline'

import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface DateTimePickerProps {
  value?: Date
  onChange: (date: Date | undefined) => void
  /** Minimum selectable date */
  minDate?: Date
  /** Maximum selectable date */
  maxDate?: Date
  /** Placeholder text when no date selected */
  placeholder?: string
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Date-only mode: calendar without time input */
  dateOnly?: boolean
  /** Called when the inline clear control is clicked (shown when value is set) */
  onClear?: () => void
  /** Additional class names for trigger button */
  className?: string
}

function clampToBounds(date: Date, minDate?: Date, maxDate?: Date): Date {
  let result = new Date(date)
  if (minDate && result < minDate) {
    result = new Date(minDate)
  }
  if (maxDate && result > maxDate) {
    result = new Date(maxDate)
  }
  return result
}

/**
 * Date and time picker with calendar and time input.
 */
export function DateTimePicker({
  value,
  onChange,
  minDate,
  maxDate,
  placeholder,
  disabled = false,
  dateOnly = false,
  onClear,
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)

  const defaultPlaceholder = dateOnly ? 'Pick a date' : 'Pick date & time'
  const resolvedPlaceholder = placeholder ?? defaultPlaceholder
  const displayFormat = dateOnly ? 'MMM d, yyyy' : 'MMM d, yyyy · HH:mm'

  const applyBounds = React.useCallback(
    (date: Date) => clampToBounds(date, minDate, maxDate),
    [minDate, maxDate]
  )

  // Format time as HH:mm:ss for the input
  const timeValue = value
    ? `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:00`
    : '09:00:00'

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return

    if (dateOnly) {
      onChange(applyBounds(parseISO(`${format(date, 'yyyy-MM-dd')}T12:00:00.000Z`)))
      setOpen(false)
      return
    }

    const newDate = new Date(date)
    // Preserve existing time or default to 9:00
    if (value) {
      newDate.setHours(value.getHours(), value.getMinutes(), 0, 0)
    } else {
      newDate.setHours(9, 0, 0, 0)
    }
    onChange(applyBounds(newDate))
  }

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [hours, minutes] = e.target.value.split(':').map(Number)
    if (!isNaN(hours) && !isNaN(minutes)) {
      const base = value ? new Date(value) : maxDate ? new Date(maxDate) : new Date()
      base.setHours(hours, minutes, 0, 0)
      onChange(applyBounds(base))
    }
  }

  const isDateDisabled = (date: Date) => {
    if (minDate && date < startOfDay(minDate)) return true
    if (maxDate && date > startOfDay(maxDate)) return true
    return false
  }

  const timeMax = maxDate && value && isSameDay(value, maxDate) ? maxDate : undefined
  const showClear = value !== undefined && onClear !== undefined

  const triggerContent = (
    <>
      <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {value ? format(value, displayFormat) : resolvedPlaceholder}
      </span>
    </>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {showClear ? (
        <div
          className={cn(
            'inline-flex max-w-full items-stretch overflow-hidden rounded-md border border-border/50 bg-transparent',
            disabled && 'pointer-events-none opacity-50',
            className
          )}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                'inline-flex min-w-0 flex-1 items-center px-2 text-left text-xs font-normal transition-colors hover:bg-muted/40',
                !value && 'text-muted-foreground'
              )}
            >
              {triggerContent}
            </button>
          </PopoverTrigger>
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onClear()
            }}
            className="inline-flex shrink-0 items-center justify-center border-l border-border/50 px-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-label="Clear date"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className={cn(
              'max-w-full justify-start text-left font-normal',
              !value && 'text-muted-foreground',
              className
            )}
          >
            {triggerContent}
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={value}
          onSelect={handleDateSelect}
          disabled={isDateDisabled}
          initialFocus
        />
        {!dateOnly && (
          <div className="border-t border-border/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <ClockIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Time</span>
              <Input
                type="time"
                step="60"
                value={timeValue}
                max={
                  timeMax
                    ? `${String(timeMax.getHours()).padStart(2, '0')}:${String(timeMax.getMinutes()).padStart(2, '0')}`
                    : undefined
                }
                onChange={handleTimeChange}
                className="ml-auto h-8 w-24 bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
              />
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
