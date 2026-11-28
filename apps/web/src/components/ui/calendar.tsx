'use client'

import * as React from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { IntlContext, type MessageDescriptor } from 'react-intl'
import { DayFlag, DayPicker, SelectionState, UI } from 'react-day-picker'

import { cn } from '@/lib/shared/utils'
import { buttonVariants } from '@/components/ui/button'
import { usePageLocale } from '@/components/ui/local-date'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

const LABELS = {
  previous: { id: 'ui.calendar.previousMonth', defaultMessage: 'Go to the previous month' },
  next: { id: 'ui.calendar.nextMonth', defaultMessage: 'Go to the next month' },
} satisfies Record<string, MessageDescriptor & { defaultMessage: string }>

/**
 * Month and weekday names, and the day and button labels screen readers
 * announce, in the page's language. English keeps the picker's own wording;
 * outside an IntlProvider the button labels stay English.
 */
function useCalendarLanguage(): Pick<CalendarProps, 'formatters' | 'labels'> {
  const locale = usePageLocale()
  const intl = React.useContext(IntlContext)
  return React.useMemo(() => {
    if (locale.toLowerCase().startsWith('en')) return {}
    const caption = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    // The weekday column is two letters wide: a language whose short names
    // run longer (Arabic, Polish) uses the narrow form for every day.
    const short = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    const week = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 2, 1 + i)))
    const fits = week.every((date) => short.format(date).length <= 3)
    const weekdays = fits ? short : new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
    const weekday = (date: Date) => weekdays.format(date)
    const day = new Intl.DateTimeFormat(locale, { dateStyle: 'full' })
    const label = (message: (typeof LABELS)[keyof typeof LABELS]) =>
      intl ? intl.formatMessage(message) : message.defaultMessage
    return {
      formatters: {
        formatCaption: (month) => caption.format(month),
        formatWeekdayName: (date) => weekday(date),
      },
      labels: {
        labelPrevious: () => label(LABELS.previous),
        labelNext: () => label(LABELS.next),
        labelDayButton: (date) => day.format(date),
      },
    }
  }, [locale, intl])
}

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  const language = useCalendarLanguage()
  return (
    <DayPicker
      {...language}
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
          'h-8 w-8 text-center rounded-md text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-e-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-s-md last:[&:has([aria-selected])]:rounded-e-md focus-within:relative focus-within:z-20',
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
            return <ChevronLeftIcon className="rtl:-scale-x-100 h-4 w-4" />
          }
          return <ChevronRightIcon className="rtl:-scale-x-100 h-4 w-4" />
        },
      }}
      {...props}
    />
  )
}
Calendar.displayName = 'Calendar'

export { Calendar }
