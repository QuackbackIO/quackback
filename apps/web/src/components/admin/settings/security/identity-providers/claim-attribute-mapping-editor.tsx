/**
 * Claim → person-attribute mapping. A second disclosure under role mapping,
 * same chrome. Writes the `attributes` section of `claim_mapping`. Opens when
 * a mapping already exists. With no definitions and no rows, a link to People
 * settings replaces the editor; existing rows stay removable regardless.
 */
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AdjustmentsHorizontalIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'
import type { UserAttributeType } from '@/lib/shared/db-types'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { ClaimPathInput } from './claim-path-input'
import { AttributeWritesPreview } from './attribute-writes-preview'
import type { AttributeMapping } from './provider-shared'

const TYPE_LABEL: Record<UserAttributeType, string> = {
  string: 'Text',
  number: 'Number',
  boolean: 'Boolean',
  date: 'Date',
  currency: 'Currency',
}

const EMPTY: AttributeMapping = { map: [] }

export function ClaimAttributeMappingEditor({
  mapping,
  disabled,
  registrationId,
  canTest,
  capture,
  detailsChangedAt,
  onChange,
}: {
  mapping: AttributeMapping | null
  disabled: boolean
  registrationId: string
  canTest: boolean
  capture: SsoTestCapture | null
  detailsChangedAt?: string | null
  onChange: (mapping: AttributeMapping | null) => void
}) {
  const current: AttributeMapping = mapping ?? EMPTY
  const rows = current.map ?? []
  const mappingCount = rows.filter((r) => r.claimPath && r.attributeKey).length
  const hasConfig =
    mapping != null && (rows.length > 0 || mapping.overrideExisting || mapping.syncOnSignIn)

  const { data: definitions } = useUserAttributes()
  const defs = definitions ?? []
  const noDefinitions = definitions !== undefined && defs.length === 0
  // Existing rows stay visible with no definitions left, or an orphaned
  // mapping could never be removed — and it would keep forcing a userinfo
  // fetch on every sign-in.
  const showEmptyState = noDefinitions && rows.length === 0

  const [open, setOpen] = useState(hasConfig)
  useEffect(() => {
    if (hasConfig) setOpen(true)
  }, [hasConfig])

  const update = (patch: Partial<AttributeMapping>) =>
    onChange({ ...current, ...patch, map: patch.map ?? current.map ?? [] })

  const usedKeys = new Set(rows.map((r) => r.attributeKey).filter(Boolean))

  return (
    <div className="rounded-md border border-border/50 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <AdjustmentsHorizontalIcon className="size-4 text-muted-foreground" />
          Copy claims into person attributes
          {mappingCount > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              · {mappingCount} mapping{mappingCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <span className="text-muted-foreground">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border/40 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Fill person attributes from what the IdP sends, on every sign-in. Only attributes
            defined under People can be written. Keys and values you set by hand or through your CDP
            are kept unless you say otherwise.
          </p>

          {showEmptyState ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                No person attributes yet. Define one under People, then come back to map a claim to
                it.
              </p>
              <Link
                to="/admin/settings/people"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Open People settings
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {rows.map((row, index) => {
                  const def = defs.find((d) => d.key === row.attributeKey)
                  const orphan = row.attributeKey !== '' && !def
                  const available = defs.filter(
                    (d) => d.key === row.attributeKey || !usedKeys.has(d.key)
                  )
                  return (
                    <div key={index} className="flex items-start gap-2">
                      <ClaimPathInput
                        value={row.claimPath}
                        onChange={(claimPath) =>
                          update({
                            map: rows.map((r, i) => (i === index ? { ...r, claimPath } : r)),
                          })
                        }
                        registrationId={registrationId}
                        canTest={canTest}
                        placeholder="department, extension_plan, org.costCenter"
                        ariaLabel={`Claim path (mapping ${index + 1})`}
                        disabled={disabled}
                        capture={capture}
                        suggestionsFor="attribute"
                      />
                      <span className="mt-2 shrink-0 text-xs text-muted-foreground">→</span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <Select
                          value={row.attributeKey}
                          onValueChange={(attributeKey) =>
                            update({
                              map: rows.map((r, i) => (i === index ? { ...r, attributeKey } : r)),
                            })
                          }
                          disabled={disabled}
                        >
                          <SelectTrigger
                            className="w-full"
                            aria-label={`Person attribute (mapping ${index + 1})`}
                          >
                            <SelectValue placeholder="Attribute" />
                          </SelectTrigger>
                          <SelectContent>
                            {available.map((d) => (
                              <SelectItem key={d.key} value={d.key}>
                                <span className="flex flex-col text-left">
                                  <span>{d.label}</span>
                                  <span className="text-xs font-normal text-muted-foreground">
                                    {d.key} · {TYPE_LABEL[d.type] ?? d.type}
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                            {orphan && (
                              <SelectItem value={row.attributeKey}>{row.attributeKey}</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {orphan && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 text-amber-700 dark:text-amber-400"
                          >
                            attribute no longer exists
                          </Badge>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-0.5 h-9"
                        aria-label={`Remove mapping ${index + 1}`}
                        onClick={() => update({ map: rows.filter((_, i) => i !== index) })}
                        disabled={disabled}
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    </div>
                  )
                })}
                {noDefinitions ? (
                  <p className="text-xs text-muted-foreground">
                    No person attributes are defined any more, so these mappings write nothing.
                    Remove them, or{' '}
                    <Link
                      to="/admin/settings/people"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      define attributes under People
                    </Link>
                    .
                  </p>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => update({ map: [...rows, { claimPath: '', attributeKey: '' }] })}
                    disabled={disabled}
                  >
                    <PlusIcon className="size-3.5" />
                    Add mapping
                  </Button>
                )}
              </div>

              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={current.overrideExisting === true}
                  onCheckedChange={(v) => update({ overrideExisting: v === true })}
                  disabled={disabled}
                  aria-label="Overwrite values that are already set"
                  className="mt-0.5"
                />
                <span>
                  Overwrite values that are already set
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Off: a claim only fills an attribute that is empty, so values set by hand or
                    from your CDP stay. On: the IdP&apos;s value wins on every sign-in.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={current.syncOnSignIn === true}
                  onCheckedChange={(v) => update({ syncOnSignIn: v === true })}
                  disabled={disabled}
                  aria-label="Clear an attribute when its claim is missing"
                  className="mt-0.5"
                />
                <span>
                  Clear an attribute when its claim is missing
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    On: if the IdP stops sending a mapped claim, the stored value is removed at the
                    person&apos;s next sign-in. Off: a missing claim leaves the value alone.
                  </span>
                </span>
              </label>

              <AttributeWritesPreview
                capture={capture}
                registrationId={registrationId}
                detailsChangedAt={detailsChangedAt}
                attributeRows={rows}
                overrideExisting={current.overrideExisting === true}
                syncOnSignIn={current.syncOnSignIn === true}
                canTest={canTest}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
