import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '@/lib/shared/utils'

/**
 * shadcn/ui Tabs — pill/filled style (latest registry).
 *
 * Replaces the earlier underline style. Icons are first-class: drop any
 * SVG (e.g. a Heroicon) directly inside a TabsTrigger and the styles
 * below give it the right size / pointer-events behavior:
 *
 *   <TabsTrigger value="account">
 *     <UserIcon />
 *     Account
 *   </TabsTrigger>
 *
 * No `className` overrides are needed on the consumer for the active
 * pill, icon sizing, focus ring, or disabled state — they're all in
 * the primitive.
 */

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // Container background matches the SettingsCard surface so a row
        // of tabs sitting above a stack of cards reads as the same
        // material — not a separate "controls" block. The thin border
        // is the same border-border/50 SettingsCard uses.
        'bg-card text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg border border-border/50 p-[3px]',
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Layout + icon handling
        "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // Default vs active fill
        'text-foreground dark:text-muted-foreground',
        'data-[state=active]:bg-background data-[state=active]:shadow-sm',
        'dark:data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30',
        // Transitions + focus
        'transition-[color,box-shadow]',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:outline-1',
        // Disabled
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
