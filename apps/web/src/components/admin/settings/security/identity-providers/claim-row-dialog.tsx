/**
 * Add/Edit mapping dialog. Edits a local draft; Cancel discards. The card
 * Save is the only writer.
 *
 * Every profile field is titled "Edit <field> mapping" and described by its
 * helper. Avatar's body checks the claim against the last test sign-in and
 * lists that test's claims to choose from (see `AvatarClaimPicker`); the
 * other fields use the claim path field.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  OIDC_PROFILE_DEFAULTS,
  type IdentityProviderClaimMapping,
  type ProfileField,
} from '@/lib/shared/oidc-claim-mapping'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { AvatarClaimPicker, checkAvatarClaim, testSignInClaims } from './avatar-claim-picker'
import { ClaimPathInput } from './claim-path-input'
import { RoleMappingRulesBody } from './claim-mapping-editor'
import {
  PEOPLE_TYPE_LABEL,
  PROFILE_FIELD_SPECS,
  isCustomProfilePath,
  type AddClaimTarget,
  type PeopleDefinition,
  type RoleMapping,
} from './provider-shared'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'

export type ClaimRowDialogTarget =
  | { type: 'profile'; field: ProfileField }
  | { type: 'role' }
  | { type: 'people'; attributeKey: string; baselineIndex?: number }

export type ClaimRowDialogCommit =
  | { type: 'profile'; field: ProfileField; path: string | null }
  | { type: 'role'; mapping: RoleMapping }
  | { type: 'people'; attributeKey: string; claimPath: string; baselineIndex?: number }

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
  draft,
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
  /** The editor's unsaved mapping. The Avatar preview replays the test under
   *  it, so it reads the same sources sign-in will. */
  draft?: IdentityProviderClaimMapping | null
  providerKind?: string | null
  autoCreateUsers?: boolean
  onOpenChange: (open: boolean) => void
  onCommit: (commit: ClaimRowDialogCommit) => void
}) {
  const [target, setTarget] = useState<ClaimRowDialogTarget | null>(lockedTarget ?? null)
  const [path, setPath] = useState(initialPath ?? '')
  const [role, setRole] = useState<RoleMapping>(initialRole ?? { claimPath: 'groups', rules: [] })
  const descriptionId = useId()

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

  const profileField = resolvedTarget?.type === 'profile' ? resolvedTarget.field : undefined
  const isAvatar = profileField === 'image'
  // Account ID, email and name get identity suggestions; username takes any
  // scalar claim, like an attribute.
  const identityField =
    profileField === 'id' || profileField === 'email' || profileField === 'name'
      ? profileField
      : undefined
  const avatarClaims = useMemo(
    () => (isAvatar ? testSignInClaims(draft, capture) : null),
    [isAvatar, draft, capture]
  )
  const avatarCheck = isAvatar ? checkAvatarClaim(draft, capture, path) : null

  const helper = mode === 'edit' && profileField ? PROFILE_FIELD_SPECS[profileField].helper : null

  const title =
    mode === 'add'
      ? 'Add mapping'
      : profileField
        ? `Edit ${PROFILE_FIELD_SPECS[profileField].label} mapping`
        : resolvedTarget?.type === 'role'
          ? 'Edit role rules'
          : `Edit ${peopleDef?.label ?? 'attribute'} mapping`

  const canSubmit = (() => {
    if (!resolvedTarget) return false
    if (resolvedTarget.type === 'profile') {
      // A value that is not an http(s) URL would never become an avatar.
      if (avatarCheck?.kind === 'not_url') return false
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
      // A standard claim stays display-only and is not written. An explicit
      // `sub` or `preferred_username` is written: it changes what sign-in reads.
      const trimmed = path.trim()
      onCommit({
        type: 'profile',
        field: resolvedTarget.field,
        path: isCustomProfilePath(resolvedTarget.field, trimmed) ? trimmed : null,
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
      {/* The shared content clears aria-describedby, so the helper is linked here. */}
      <DialogContent className="max-w-lg" aria-describedby={helper ? descriptionId : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {helper && <DialogDescription id={descriptionId}>{helper}</DialogDescription>}
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
                    Role rules are already mapped. Define an attribute under Users to map another
                    claim.
                  </p>
                  <Link to="/admin/settings/people" className={INLINE_LINK}>
                    Open Users settings
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
          ) : avatarCheck ? (
            <AvatarClaimPicker
              value={path}
              onChange={setPath}
              check={avatarCheck}
              claims={avatarClaims}
              registrationId={registrationId}
              canTest={canTest}
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
                suggestionsFor={identityField ? 'identity' : 'attribute'}
                providerKind={providerKind}
                identityField={identityField}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {mode === 'edit' && profileField && (
            <Button type="button" variant="outline" className="mr-auto" onClick={resetProfile}>
              {profileField === 'username'
                ? 'Use standard claims'
                : `Use ${OIDC_PROFILE_DEFAULTS[profileField]}`}
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
