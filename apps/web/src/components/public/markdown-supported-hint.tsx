import { useIntl } from 'react-intl'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/shared/utils'

interface Props {
  className?: string
}

export function MarkdownSupportedHint({ className }: Props) {
  const intl = useIntl()
  const label = intl.formatMessage({
    id: 'comments.markdownHint.label',
    defaultMessage: 'Markdown supported',
  })
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors',
              className
            )}
          >
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <ul className="space-y-0.5 font-mono">
            <li>**bold** *italic*</li>
            <li>## heading</li>
            <li>- list item</li>
            <li>`code` ```fenced```</li>
            <li>[link](url)</li>
            <li>{'> quote'}</li>
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
