import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/shared/utils'

interface CopyButtonProps {
  value: string
  variant?: 'outline' | 'ghost'
  size?: 'sm' | 'icon'
  className?: string
  'aria-label'?: string
}

export function CopyButton({
  value,
  variant = 'outline',
  size = 'icon',
  className,
  'aria-label': ariaLabel = 'Copy to clipboard',
}: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => copy(value)}
      className={cn('shrink-0', className)}
      aria-label={ariaLabel}
    >
      {copied ? (
        <CheckIcon className="h-4 w-4 text-green-500" />
      ) : (
        <ClipboardDocumentIcon className="h-4 w-4" />
      )}
    </Button>
  )
}
