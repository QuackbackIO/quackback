/**
 * Add/Edit mapping dialog. Edits a local draft; Cancel discards. The card
 * Save is the only writer.
 */
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { ClaimPathInput } from './claim-path-input'
import { RoleMappingRulesBody } from './claim-mapping-editor'
import {
  OIDC_PROFILE_DEFAULTS,
  PEOPLE_TYPE_LABEL,
  PROFILE_DIALOG_HELPERS,
  PROFILE_ROW_LABELS,
  type AddClaimTarget,
  type PeopleDefinition,
  type RoleMapping,
} from './provider-shared'

export type ClaimRowDialogTarget =
  | { type: 'profile'; field: 'id' | 'email' | 'name' }
  | { type: 'role' }
  | { type: 'people'; attributeKey: string; baselineIndex?: number }

export type ClaimRowDialogCommit =
  | { type: 'profile'; field: 'id' | 'email' | 'name'; path: string | null }
  | { type: 'role'; mapping: RoleMapping }
  | { type: 'people'; attributeKey: string; claimPath: string; baselineIndex?: number }

const PROFILE_FALLBACK_NOTE: Record<'id' | 'email' | 'name', string> = {
  id: 'Leave blank for the standard behaviour: sub, then a userinfo id fallback for older providers. Setting sub explicitly turns that fallback off.',
  email: '',
  name: '',
}

export function ClaimRowDialog({
  open,
  mode,
  lockedTarget,
  availableTargets,
  definitions,
  initialPath,
  initialRole,
  registrationId,
  canTest,
  capture,
  providerKind,
  autoCreateUsers,
  onOpenChange,
  onCommit,
}: {
  open: boolean
  mode: 'add' | 'edit'
  lockedTarget?: ClaimRowDialogTarget
  availableTargets: AddClaimTarget[]
  definitions: PeopleDefinition[]
  initialPath?: string
  initialRole?: RoleMapping | null
  registrationId: string
  canTest: boolean
  capture?: SsoTestCapture | null
  providerKind?: string | null
  autoCreateUsers?: boolean
  onOpenChange: (open: boolean) => void
  onCommit: (commit: ClaimRowDialogCommit) => void
}) {
  const [target, setTarget] = useState<ClaimRowDialogTarget | null>(lockedTarget ?? null)
  const [path, setPath] = useState(initialPath ?? '')
  const [role, setRole] = useState<RoleMapping>(initialRole ?? { claimPath: 'groups', rules: [] })

  const firstAvailable = (item: AddClaimTarget | undefined): ClaimRowDialogTarget | null => {
    if (!item) return null
    if (item.kind === 'role') return { type: 'role' }
    return { type: 'people', attributeKey: item.key }
  }

  useEffect(() => {
    if (!open) return
    setTarget(lockedTarget ?? firstAvailable(availableTargets[0]))
    setPath(initialPath ?? '')
    setRole(initialRole ?? { claimPath: 'groups', rules: [] })
    // Reset only when the dialog opens. Parent re-renders rebuild availableTargets.
  }, [open])

  const resolvedTarget: ClaimRowDialogTarget | null =
    lockedTarget ??
    (target?.type === 'people'
      ? target
      : target?.type === 'role'
        ? target
        : target?.type === 'profile'
          ? target
          : firstAvailable(availableTargets[0]))

  const peopleDef =
    resolvedTarget?.type === 'people'
      ? definitions.find((d) => d.key === resolvedTarget.attributeKey)
      : undefined

  const title =
    mode === 'add'
      ? 'Add mapping'
      : resolvedTarget?.type === 'profile'
        ? `Edit ${PROFILE_ROW_LABELS[resolvedTarget.field]} mapping`
        : resolvedTarget?.type === 'role'
          ? 'Edit role rules'
          : `Edit ${peopleDef?.label ?? 'attribute'} mapping`

  const canSubmit = (() => {
    if (!resolvedTarget) return false
    if (resolvedTarget.type === 'profile') {
      return mode === 'edit' || path.trim().length > 0
    }
    if (resolvedTarget.type === 'people') {
      return path.trim().length > 0 && resolvedTarget.attributeKey.trim().length > 0
    }
    return (
      role.claimPath.trim().length > 0 &&
      role.rules.every((rule) => rule.whenContains.trim().length > 0)
    )
  })()

  const apply = () => {
    if (!resolvedTarget || !canSubmit) return
    if (resolvedTarget.type === 'profile') {
      const trimmed = path.trim()
      const defaultPath = OIDC_PROFILE_DEFAULTS[resolvedTarget.field]
      // Identifier: empty Apply keeps the implicit default (userinfo `id` fallback).
      // Explicitly choosing `sub` must persist `id: 'sub'`. Email/name defaults
      // stay display-only and are not written.
      const pathToCommit =
        resolvedTarget.field === 'id'
          ? trimmed || null
          : !trimmed || trimmed === defaultPath
            ? null
            : trimmed
      onCommit({
        type: 'profile',
        field: resolvedTarget.field,
        path: pathToCommit,
      })
    } else if (resolvedTarget.type === 'role') {
      onCommit({ type: 'role', mapping: role })
    } else {
      onCommit({
        type: 'people',
        attributeKey: resolvedTarget.attributeKey,
        claimPath: path.trim(),
        baselineIndex: resolvedTarget.baselineIndex,
      })
    }
    onOpenChange(false)
  }

  const resetProfile = () => {
    if (resolvedTarget?.type !== 'profile') return
    onCommit({ type: 'profile', field: resolvedTarget.field, path: null })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* The title already names the target in edit mode; only Add needs
              the picker. */}
          {!lockedTarget && (
            <div className="space-y-1.5">
              <Label>Set from this provider</Label>
              {availableTargets.length === 0 ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    Role rules are already mapped. Define an attribute under People to map another
                    claim.
                  </p>
                  <Link
                    to="/admin/settings/people"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open People settings
                  </Link>
                </div>
              ) : (
                <Select
                  value={
                    resolvedTarget?.type === 'role'
                      ? 'role'
                      : resolvedTarget?.type === 'people'
                        ? `people:${resolvedTarget.attributeKey}`
                        : ''
                  }
                  onValueChange={(value) => {
                    if (value === 'role') {
                      setTarget({ type: 'role' })
                      return
                    }
                    const key = value.replace(/^people:/, '')
                    setTarget({ type: 'people', attributeKey: key })
                  }}
                >
                  <SelectTrigger aria-label="Set from this provider">
                    <SelectValue placeholder="Choose what to set" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTargets.map((item) =>
                      item.kind === 'role' ? (
                        <SelectItem key="role" value="role">
                          Role rules
                        </SelectItem>
                      ) : (
                        <SelectItem key={item.key} value={`people:${item.key}`}>
                          <span className="flex flex-col text-left">
                            <span>{item.label}</span>
                            <span className="text-xs font-normal text-muted-foreground">
                              {item.key}, {PEOPLE_TYPE_LABEL[item.attrType] ?? item.attrType}
                            </span>
                          </span>
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {resolvedTarget?.type === 'role' ? (
            <RoleMappingRulesBody
              mapping={role}
              disabled={false}
              registrationId={registrationId}
              canTest={canTest}
              capture={capture}
              autoCreateUsers={autoCreateUsers}
              onChange={setRole}
            />
          ) : resolvedTarget ? (
            <div className="space-y-1.5">
              <Label>Provider claim</Label>
              <ClaimPathInput
                value={path}
                onChange={setPath}
                registrationId={registrationId}
                canTest={canTest}
                placeholder={
                  resolvedTarget.type === 'profile'
                    ? OIDC_PROFILE_DEFAULTS[resolvedTarget.field]
                    : 'org.department'
                }
                ariaLabel="Provider claim"
                capture={capture}
                suggestionsFor={resolvedTarget.type === 'profile' ? 'identity' : 'attribute'}
                providerKind={providerKind}
                identityField={resolvedTarget.type === 'profile' ? resolvedTarget.field : undefined}
              />
              {resolvedTarget.type === 'profile' && (
                <p className="text-sm text-muted-foreground">
                  {PROFILE_DIALOG_HELPERS[resolvedTarget.field]}
                  {PROFILE_FALLBACK_NOTE[resolvedTarget.field]
                    ? ` ${PROFILE_FALLBACK_NOTE[resolvedTarget.field]}`
                    : ''}
                </p>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {mode === 'edit' && resolvedTarget?.type === 'profile' && (
            <Button type="button" variant="outline" className="mr-auto" onClick={resetProfile}>
              Use {OIDC_PROFILE_DEFAULTS[resolvedTarget.field]}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={apply} disabled={!canSubmit}>
            {mode === 'add' ? 'Add' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
