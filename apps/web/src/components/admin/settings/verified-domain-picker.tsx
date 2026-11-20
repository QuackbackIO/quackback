/**
 * The pieces a dialog uses to build on the workspace's Verified domains: Add
 * custom domain puts a section's name in front of one, Add sending address an
 * email address's local part. Kept apart from both dialogs so each page loads
 * only these, not the other dialog.
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Up to this many choices (the free field's included) show as tiles; more, as a select. */
export const MAX_DOMAIN_TILES = 4

/**
 * The workspace's Verified domains: undefined while they load, null when they
 * cannot be read (or are not asked for), so the free field shows as before.
 */
export function useVerifiedDomains(
  load: (() => Promise<readonly string[]>) | undefined
): readonly string[] | null | undefined {
  const [domains, setDomains] = useState<readonly string[] | null | undefined>(
    load ? undefined : null
  )
  useEffect(() => {
    if (!load) return
    let live = true
    load().then(
      (names) => live && setDomains(names),
      () => live && setDomains(null)
    )
    return () => {
      live = false
    }
  }, [load])
  return domains
}

/**
 * A field with a fixed ending after what is typed: a section's name before
 * `.acme.com`, or an address's local part before `@acme.com`.
 */
export function SuffixField({
  id,
  value,
  suffix,
  label,
  placeholder,
  disabled,
  invalid,
  onChange,
  autoFocus,
}: {
  id: string
  value: string
  /** The fixed ending, shown after the field: `.acme.com` or `@acme.com`. */
  suffix: string
  /** The field's accessible name. */
  label: string
  placeholder?: string
  disabled?: boolean
  /** The field's invalid state, pointing at the suffix it names and any error under it. */
  invalid?: (describedBy?: string) => Record<string, unknown>
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const suffixId = `${id}-suffix`
  return (
    <div className="flex h-9 min-w-0 items-center border border-input bg-transparent shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] dark:bg-input/30 [border-radius:calc(var(--radius)*0.8)]">
      <Input
        id={id}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 border-0 focus-visible:ring-0"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        disabled={disabled}
        autoFocus={autoFocus}
        {...(invalid ? invalid(suffixId) : { 'aria-describedby': suffixId })}
      />
      <span
        id={suffixId}
        className="max-w-[60%] shrink-0 truncate pe-3 text-sm text-muted-foreground"
      >
        {suffix}
      </span>
    </div>
  )
}

/**
 * No Verified domain to build on yet. Add domain for a viewer who may add one
 * (it closes the dialog and goes to Settings > Domains), else a short note
 * when there is one to give.
 */
export function NoVerifiedDomains({
  onAddDomain,
  note,
}: {
  onAddDomain?: () => void
  note?: string
}) {
  return (
    <div
      data-slot="no-verified-domains"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-dashed px-3.5 py-3"
    >
      <div className="space-y-0.5 text-[13px] text-muted-foreground">
        <p>No Verified domains yet.</p>
        {!onAddDomain && note && <p>{note}</p>}
      </div>
      {onAddDomain && (
        <Button type="button" size="sm" variant="outline" onClick={onAddDomain}>
          Add domain
        </Button>
      )}
    </div>
  )
}
