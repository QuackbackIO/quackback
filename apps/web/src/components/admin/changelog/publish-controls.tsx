'use client'

import { useState } from 'react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/shared/utils'

export type PublishState =
  | { type: 'draft' }
  | { type: 'scheduled'; publishAt: Date }
  | { type: 'published' }

interface PublishControlsProps {
  value: PublishState
  onChange: (state: PublishState) => void
  className?: string
}

export function PublishControls({ value, onChange, className }: PublishControlsProps) {
  // Local state for the scheduled date/time input
  const [scheduledDateTime, setScheduledDateTime] = useState<string>(() => {
    if (value.type === 'scheduled') {
      return formatDateTimeLocal(value.publishAt)
    }
    // Default to tomorrow at 9am
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    return formatDateTimeLocal(tomorrow)
  })

  const handleTypeChange = (type: string) => {
    if (type === 'draft') {
      onChange({ type: 'draft' })
    } else if (type === 'scheduled') {
      onChange({ type: 'scheduled', publishAt: new Date(scheduledDateTime) })
    } else if (type === 'published') {
      onChange({ type: 'published' })
    }
  }

  const handleDateTimeChange = (dateTime: string) => {
    setScheduledDateTime(dateTime)
    if (value.type === 'scheduled') {
      onChange({ type: 'scheduled', publishAt: new Date(dateTime) })
    }
  }

  return (
    <div className={cn('space-y-3', className)}>
      <Label className="text-xs text-muted-foreground">Publish Status</Label>
      <RadioGroup value={value.type} onValueChange={handleTypeChange} className="flex gap-4">
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="draft" id="publish-draft" />
          <Label htmlFor="publish-draft" className="text-sm font-normal cursor-pointer">
            Draft
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="scheduled" id="publish-scheduled" />
          <Label htmlFor="publish-scheduled" className="text-sm font-normal cursor-pointer">
            Schedule
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="published" id="publish-now" />
          <Label htmlFor="publish-now" className="text-sm font-normal cursor-pointer">
            Publish Now
          </Label>
        </div>
      </RadioGroup>

      {value.type === 'scheduled' && (
        <div className="pl-6">
          <Input
            type="datetime-local"
            value={scheduledDateTime}
            onChange={(e) => handleDateTimeChange(e.target.value)}
            min={formatDateTimeLocal(new Date())}
            className="w-auto text-sm"
          />
        </div>
      )}
    </div>
  )
}

function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}
