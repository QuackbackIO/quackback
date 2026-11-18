import { useIntl } from 'react-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The compose box's "Posting to" board picker. It shows only once the visitor
 * starts writing, so the Home view loads it behind a lazy boundary
 * (widget-home-animated.tsx): the select and its positioning code stay out of
 * the widget's first load on every host page.
 */
export function WidgetBoardSelect({
  boards,
  value,
  onValueChange,
}: {
  boards: { id: string; name: string }[]
  value: string
  onValueChange: (id: string) => void
}) {
  const intl = useIntl()
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="xs"
        className="border-0 font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
      >
        <SelectValue
          placeholder={intl.formatMessage({
            id: 'widget.home.posting.selectBoard',
            defaultMessage: 'Select a board',
          })}
        />
      </SelectTrigger>
      <SelectContent align="start">
        {boards.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
