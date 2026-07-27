/**
 * Tiles for the IdP family. Visually distinct choices, so tiles rather than a
 * dropdown — and picking a fixed-discovery kind (Google) seeds the canonical
 * discovery URL immediately, since it has no shortcut input of its own.
 */
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { RadioGroup } from '@/components/ui/radio-group'
import { IdpLogo } from '@/components/icons/idp-provider-icons'
import { cn } from '@/lib/shared/utils'
import { getIdpShortcut, IDP_KIND_NAMES, type IdpKind } from '../idp-shortcuts'
import { IDP_KIND_OPTIONS } from './provider-shared'

export function ProviderKindPicker({
  kind,
  disabled,
  onKindChange,
  onDiscoveryUrlChange,
}: {
  kind: IdpKind
  disabled: boolean
  onKindChange: (next: IdpKind) => void
  /** Seeded when the chosen kind has a fixed discovery URL and no input. */
  onDiscoveryUrlChange: (url: string) => void
}) {
  return (
    <RadioGroup
      value={kind}
      onValueChange={(v) => {
        const next = v as IdpKind
        onKindChange(next)
        // Fixed-discovery kinds (Google) have no shortcut input — seed the
        // canonical URL now so the saved row is well-formed without a
        // render-time state write.
        const def = getIdpShortcut(next)
        if (next !== 'other' && def.fields.length === 0) {
          const url = def.build({})
          if (url) onDiscoveryUrlChange(url)
        }
      }}
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
    >
      {IDP_KIND_OPTIONS.map((k) => (
        <RadioGroupPrimitive.Item
          key={k}
          value={k}
          id={`idp-kind-${k}`}
          disabled={disabled}
          className={cn(
            'flex items-center gap-2.5 rounded-lg border border-border/50 bg-card p-3 text-left shadow-sm outline-none transition-all',
            'hover:border-border hover:bg-accent/40',
            'focus-visible:ring-2 focus-visible:ring-ring/50',
            'data-[state=checked]:border-primary data-[state=checked]:ring-2 data-[state=checked]:ring-primary/30',
            'disabled:cursor-not-allowed disabled:opacity-60'
          )}
        >
          <IdpLogo kind={k} className="h-8 w-8 shrink-0" iconClassName="h-[18px] w-[18px]" />
          <span className="truncate text-sm font-medium">{IDP_KIND_NAMES[k]}</span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroup>
  )
}
