import type { ComponentType } from 'react'
import { LockClosedIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface MethodRowProps {
  icon: ComponentType<{ className?: string }>
  label: string
  description: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  /** When set, the row is non-toggleable. Renders a lock icon next to
   *  the label with this string as the tooltip. Used for the
   *  always-on Magic-link row on the team tab. */
  lockedReason?: string
  /** Optional badge text to the right of the label (e.g. "Active",
   *  "Managed"). When `badgeTooltip` is set, the badge wraps the lock
   *  icon and shows the tooltip on hover. */
  badge?: string
  /** Tooltip shown on the badge. Used by portal-auth's "Managed" hint. */
  badgeTooltip?: string
}

/**
 * Sign-in method row used by both the Team and Portal auth tabs.
 * Same shape: icon + label + description on the left, switch on the
 * right, with optional locked / badge / tooltip variants for the
 * surface-specific cases (admin's locked-on magic-link, portal's
 * managed-by-config-file badge, etc.).
 */
export function MethodRow({
  icon: Icon,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  lockedReason,
  badge,
  badgeTooltip,
}: MethodRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-start gap-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <Label className="font-medium">{label}</Label>
            {lockedReason && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <LockClosedIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{lockedReason}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {badge &&
              (badgeTooltip ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 inline-flex items-center gap-1"
                      >
                        <LockClosedIcon className="h-3 w-3" />
                        {badge}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{badgeTooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {badge}
                </Badge>
              ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}
