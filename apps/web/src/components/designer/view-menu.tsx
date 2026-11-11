import type { ReactNode } from 'react'
import { ChevronDownIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * Zoom and "View" in the top bar, beside the device switch: how the page is
 * shown while editing (light or dark, signed out or in, language) and the
 * keyboard shortcuts. None of it changes the design.
 */
export function ViewMenu({ zoom, children }: { zoom: ReactNode; children: ReactNode }) {
  return (
    <>
      {zoom}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 px-2 text-muted-foreground data-popup-open:text-foreground"
            data-view-menu=""
          >
            View
            <ChevronDownIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-80" aria-label="View">
          {children}
        </PopoverContent>
      </Popover>
    </>
  )
}
