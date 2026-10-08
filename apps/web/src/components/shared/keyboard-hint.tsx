import { Fragment, useSyncExternalStore } from 'react'
import { cn } from '@/lib/shared/utils'

/** The key name `Mod` stands for in a hint: Cmd on Apple platforms, Ctrl elsewhere. */
function modifierKeyLabel(): 'Cmd' | 'Ctrl' {
  const platform = `${navigator.platform} ${navigator.userAgent}`
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? 'Cmd' : 'Ctrl'
}

const subscribe = () => () => {}

interface KeyboardHintProps {
  /** Key names to show. `Mod` is the platform's command key (Cmd or Ctrl). */
  keys: string[]
  action: string
  className?: string
}

export function KeyboardHint({ keys, action, className }: KeyboardHintProps) {
  // The server cannot know the platform, so it renders Ctrl and a Mac re-renders with Cmd.
  const modifier = useSyncExternalStore(subscribe, modifierKeyLabel, () => 'Ctrl')
  return (
    <p className={cn('hidden sm:block text-xs text-muted-foreground', className)}>
      {keys.map((key, idx) => (
        <Fragment key={idx}>
          {idx > 0 && <span className="mx-1">+</span>}
          <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded border">
            {key === 'Mod' ? modifier : key}
          </kbd>
        </Fragment>
      ))}
      <span className="ml-2">{action}</span>
    </p>
  )
}
