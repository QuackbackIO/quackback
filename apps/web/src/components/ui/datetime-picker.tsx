'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { CalendarIcon, ClockIcon } from '@heroicons/react/24/outline'

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
  /** Placeholder text when no date selected */
  placeholder?: string
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Additional class names for trigger button */
  className?: string
}

/**
 * Date and time picker with calendar and time input.
 */
export function DateTimePicker({
  value,
  onChange,
  minDate,
  placeholder = 'Pick date & time',
  disabled = false,
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)

  // Format time as HH:mm:ss for the input
  const timeValue = value
    ? `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:00`
    : '09:00:00'

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      const newDate = new Date(date)
      // Preserve existing time or default to 9:00
      if (value) {
        newDate.setHours(value.getHours(), value.getMinutes(), 0, 0)
      } else {
        newDate.setHours(9, 0, 0, 0)
      }
      onChange(newDate)
    }
  }

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [hours, minutes] = e.target.value.split(':').map(Number)
    if (!isNaN(hours) && !isNaN(minutes)) {
      const newDate = value ? new Date(value) : new Date()
      newDate.setHours(hours, minutes, 0, 0)
      onChange(newDate)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            'justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value, 'MMM d, yyyy · HH:mm') : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={value}
          onSelect={handleDateSelect}
          disabled={(date) => (minDate ? date < minDate : false)}
          initialFocus
        />
        <div className="border-t border-border/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <ClockIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Time</span>
            <Input
              type="time"
              step="60"
              value={timeValue}
              onChange={handleTimeChange}
              className="ml-auto h-8 w-24 bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
