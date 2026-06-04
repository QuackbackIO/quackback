import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Section, SectionNavItem } from './analytics-sections'

interface AnalyticsSectionSelectProps {
  items: SectionNavItem[]
  value: Section
  onChange: (section: Section) => void
}

/** Mobile / tablet section switcher. The desktop sidebar nav is the source of
 *  truth on large screens; below `lg` this stands in for it so no section is
 *  ever unreachable. */
export function AnalyticsSectionSelect({ items, value, onChange }: AnalyticsSectionSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Section)}>
      <SelectTrigger className="h-8 w-44 text-sm" aria-label="Section">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(({ key, label, icon: Icon }) => (
          <SelectItem key={key} value={key}>
            <span className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
