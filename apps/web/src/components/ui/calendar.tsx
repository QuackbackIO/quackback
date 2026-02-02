'use client'

import * as React from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { DayFlag, DayPicker, SelectionState, UI } from 'react-day-picker'

import { cn } from '@/lib/shared/utils'
import { buttonVariants } from '@/components/ui/button'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-2', className)}
      classNames={{
        [UI.Months]: 'relative flex flex-col sm:flex-row space-y-3 sm:space-x-3 sm:space-y-0',
        [UI.Month]: 'space-y-3',
        [UI.MonthCaption]: 'flex justify-center pt-1 relative items-center h-7',
        [UI.Nav]: 'absolute inset-x-0 top-0 flex justify-between z-10',
        [UI.CaptionLabel]: 'text-sm font-medium',
        [UI.PreviousMonthButton]: cn(
          buttonVariants({ variant: 'outline' }),
          'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100'
        ),
        [UI.NextMonthButton]: cn(
          buttonVariants({ variant: 'outline' }),
          'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100'
        ),
        [UI.MonthGrid]: 'w-full border-collapse',
        [UI.Weekdays]: 'flex',
        [UI.Weekday]: 'text-muted-foreground rounded-md w-8 font-normal text-xs',
        [UI.Week]: 'flex w-full mt-1',
        [UI.Day]:
          'h-8 w-8 text-center rounded-md text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20',
        [UI.DayButton]: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-8 w-8 p-0 font-normal text-xs aria-selected:opacity-100'
        ),
        [SelectionState.range_end]: 'day-range-end',
        [SelectionState.selected]:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        [SelectionState.range_middle]:
          'aria-selected:bg-accent aria-selected:text-accent-foreground',
        [DayFlag.today]: 'bg-accent text-accent-foreground',
        [DayFlag.outside]:
          'day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
        [DayFlag.disabled]: 'text-muted-foreground opacity-50',
        [DayFlag.hidden]: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === 'left') {
            return <ChevronLeftIcon className="h-4 w-4" />
          }
          return <ChevronRightIcon className="h-4 w-4" />
        },
      }}
      {...props}
    />
  )
}
Calendar.displayName = 'Calendar'

export { Calendar }
