import { useOptionalIntl } from '@/components/ui/use-optional-intl'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'

/** The alpha-hex tint convention for a tag's color (fill + border + text). */
export function tagTintStyle(color: string) {
  return { backgroundColor: `${color}20`, borderColor: `${color}40`, color }
}

/** A colored tag pill. Pass `onRemove` to show an inline remove control. */
export function TagChip({
  name,
  color,
  onRemove,
  className,
}: {
  name: string
  color: string
  onRemove?: () => void
  className?: string
}) {
  const intl = useOptionalIntl()
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        className
      )}
      style={tagTintStyle(color)}
    >
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={intl.formatMessage(
            { id: 'admin.shell.tagChip.remove', defaultMessage: 'Remove {name}' },
            { name }
          )}
          className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
        >
          <XMarkIcon className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  )
}
