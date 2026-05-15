import { ArrowPathIcon } from '@heroicons/react/24/solid'

/**
 * Tiny inline saving indicator used by debounced-save settings pages.
 * Renders nothing when `visible` is false.
 */
export function InlineSpinner({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
}
