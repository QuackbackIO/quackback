/**
 * Profile: what Quackback takes from this provider about a person.
 *
 * The table is always open. Standard OpenID Connect claims identify the
 * account (`sub`) and set its email, name, username and avatar, so most
 * providers never change a row; only an exception is marked "Custom". Name and
 * avatar are set when an account is created, and on every sign-in when
 * profile sync is on.
 *
 * Edits change a local draft. Cancel and Save changes appear only while the
 * draft differs from what is stored; Save diffs closed operations against the
 * stored JSON so unrelated sections survive. Removing a draft row is
 * reversible (Undo toast). Saving an Account ID change, or role rules that
 * grant admin, still asks first: those are the two edits that change who gets
 * into what.
 */
import { useId, useMemo, useRef, useState } from 'react'
import { PlusIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import {
  profileSyncEnabled,
  type IdentitySource,
  type ProfileField,
} from '@/lib/shared/oidc-claim-mapping'
import type { AttributeDefinition } from '@/lib/shared/plan-claim-attribute-writes'
import { diffClaimMappingOperations, mappingSaveRisks } from '@/lib/shared/sso-claim-mapping-edit'
import { previewProfileValues } from '@/lib/shared/sso-mapping-preview'
import {
  ClaimRowDialog,
  type ClaimRowDialogCommit,
  type ClaimRowDialogTarget,
} from './claim-row-dialog'
import { ClaimsTable, IdentitySourcesEditor } from './claims-table'
import { Disclosure } from './disclosure'
import { OutcomePreviewRail } from './outcome-preview-rail'
import {
  SOURCE_LABELS,
  availableAddTargets,
  buildClaimsTableModel,
  draftSources,
  hasCustomProfileClaims,
  hasCustomSources,
  identityMappingIssue,
  mergeClaimMapping,
  normalizeAttributeMapping,
  normalizeProfileClaims,
  normalizeRoleMapping,
  withAllowMissingEmail,
  type AttributeMapping,
  type ClaimsTableRow,
  type PeopleDefinition,
  type RoleMapping,
} from './provider-shared'

/** The table needs a label per attribute; the write planner needs its typed
 *  kind. One list serves both. */
type MappingDefinition = PeopleDefinition & AttributeDefinition
import { useConnectionTest, useProviderCapture } from './use-connection-test'
import { useProviderSave } from './use-provider-save'

export function UserDetailsCard({ provider }: { provider: IdentityProvider }) {
  const definitions = useDefinitions()
  const label = provider.label.trim()

  return (
    <div id="mapping" className="scroll-mt-6">
      <SettingsCard
        title="Profile"
        description={`What Quackback takes from ${label || 'your provider'} for each person.`}
        contentClassName="space-y-4"
      >
        <ProfileEditor provider={provider} definitions={definitions} />
      </SettingsCard>
    </div>
  )
}

function useDefinitions(): MappingDefinition[] {
  const { data: attributeDefs } = useUserAttributes()
  return useMemo(
    () => (attributeDefs ?? []).map((d) => ({ key: d.key, label: d.label, type: d.type })),
    [attributeDefs]
  )
}

type StoredMapping = IdentityProvider['claimMapping']

/** The editable parts of the mapping. Everything else is carried through. */
interface Draft {
  role: RoleMapping | null
  attributes: AttributeMapping | null
  profileClaims: Partial<Record<ProfileField, string>>
  sources: IdentitySource[]
  profileSync: boolean
}

function draftFrom(mapping: StoredMapping): Draft {
  return {
    role: mapping?.role ?? null,
    attributes: mapping?.attributes ?? null,
    profileClaims: { ...(mapping?.profile?.claims ?? {}) },
    sources: draftSources(mapping),
    profileSync: profileSyncEnabled(mapping),
  }
}

/** The draft's profile section. The missing-email policy is owned by Sign-in
 *  & access, so it is carried from `base` untouched and Save cannot flip it. */
function draftProfile(base: StoredMapping, draft: Draft) {
  const allowMissingEmail = base?.profile?.allowMissingEmail === true
  return normalizeProfileClaims({
    ...withAllowMissingEmail(
      { claims: draft.profileClaims, sources: draft.sources },
      allowMissingEmail
    ),
    claims: draft.profileClaims,
    sources: draft.sources,
    syncOnSignIn: draft.profileSync,
  })
}

/** What Save would write: the draft over `base`, normalized. */
function proposedMapping(base: StoredMapping, draft: Draft) {
  return mergeClaimMapping(base, {
    role: normalizeRoleMapping(draft.role),
    profile: draftProfile(base, draft),
    attributes: normalizeAttributeMapping(draft.attributes),
  })
}

function draftIsDirty(base: StoredMapping, draft: Draft): boolean {
  return diffClaimMappingOperations(base, proposedMapping(base, draft)).length > 0
}

function ProfileEditor({
  provider,
  definitions,
}: {
  provider: IdentityProvider
  definitions: MappingDefinition[]
}) {
  const { saving, saveClaimMapping } = useProviderSave(provider)
  const { openTest } = useConnectionTest(provider)
  const capture = useProviderCapture(provider)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dialog, setDialog] = useState<{
    mode: 'add' | 'edit'
    target?: ClaimRowDialogTarget
    path?: string
    role?: RoleMapping | null
  } | null>(null)
  const stored = provider.claimMapping
  // `baseline` is what the draft is compared with and Cancel returns to: the
  // stored mapping, or what this card just saved until the refetch lands.
  const [baseline, setBaseline] = useState<StoredMapping>(stored)
  const [seenStored, setSeenStored] = useState<StoredMapping>(stored)
  const [draft, setDraft] = useState<Draft>(() => draftFrom(stored))
  const syncId = useId()
  const pendingTest = useRef(false)

  // The stored mapping changed (a save here or on another card, or a
  // refetch). A clean draft follows it; a draft with edits is kept.
  if (seenStored !== stored) {
    setSeenStored(stored)
    setBaseline(stored)
    if (!draftIsDirty(baseline, draft)) setDraft(draftFrom(stored))
  }

  const { role: mapping, attributes, profileClaims, sources, profileSync } = draft
  const update = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }))
  const updateAttributes = (fn: (prev: AttributeMapping | null) => AttributeMapping | null) =>
    setDraft((prev) => ({ ...prev, attributes: fn(prev.attributes) }))
  const allowMissingEmail = baseline?.profile?.allowMissingEmail === true

  const draftMapping = mergeClaimMapping(baseline, {
    role: mapping ?? undefined,
    profile: draftProfile(baseline, draft),
    attributes: attributes ?? undefined,
  })
  const proposed = proposedMapping(baseline, draft)
  const operations = diffClaimMappingOperations(baseline, proposed)
  const risks = mappingSaveRisks(baseline, proposed)
  const dirty = operations.length > 0
  // Admin rules that already existed and did not change are acknowledged
  // silently; only new or altered admin rules get a confirmation.
  const adminRulesChanged =
    risks.hasAdminRules &&
    JSON.stringify(adminRulesOf(baseline?.role)) !== JSON.stringify(adminRulesOf(proposed?.role))
  const needsConfirm = dirty && (risks.identifierChanged || adminRulesChanged)

  const persist = async () => {
    const thenTest = pendingTest.current
    pendingTest.current = false
    const saved = await saveClaimMapping(
      {
        operations,
        acknowledgeIdentifierChange: risks.identifierChanged,
        acknowledgeAdminRules: risks.hasAdminRules,
      },
      'Profile saved.'
    )
    if (!saved) return
    // The server applied these operations to the stored mapping, so the
    // result is `proposed`. Re-seed from it so the draft reads as saved.
    setBaseline(proposed)
    setDraft(draftFrom(proposed))
    if (thenTest) openTest()
  }

  const requestSave = (thenTest = false) => {
    if (!dirty) return
    pendingTest.current = thenTest
    if (needsConfirm) {
      setConfirmOpen(true)
      return
    }
    void persist()
  }

  const commitDialog = (commit: ClaimRowDialogCommit) => {
    if (commit.type === 'profile') {
      setDraft((prev) => {
        const next = { ...prev.profileClaims }
        if (commit.path == null) delete next[commit.field]
        else next[commit.field] = commit.path
        return { ...prev, profileClaims: next }
      })
      return
    }
    if (commit.type === 'role') {
      update({ role: commit.mapping })
      return
    }
    updateAttributes((prev) => {
      const map = [...(prev?.map ?? [])]
      if (typeof commit.baselineIndex === 'number' && map[commit.baselineIndex]) {
        map[commit.baselineIndex] = {
          ...map[commit.baselineIndex],
          claimPath: commit.claimPath,
          attributeKey: commit.attributeKey,
        }
      } else {
        map.push({ claimPath: commit.claimPath, attributeKey: commit.attributeKey })
      }
      return { ...(prev ?? { map: [] }), map }
    })
  }

  // Removing from the draft is reversible, so it gets Undo rather than a
  // confirmation. Nothing is written until Save.
  const removeRow = (row: ClaimsTableRow) => {
    const before = { mapping, attributes }
    let label: string
    if (row.kind === 'role') {
      update({ role: null })
      label = 'role rules'
    } else if (row.kind === 'people') {
      updateAttributes((prev) => {
        if (!prev) return prev
        const map = (prev.map ?? []).filter((_, i) => i !== row.baselineIndex)
        return map.length === 0 ? null : { ...prev, map }
      })
      label = `the ${row.label} mapping`
    } else {
      return
    }
    toast(`Removed ${label}.`, {
      action: {
        label: 'Undo',
        onClick: () => {
          update({ role: before.mapping, attributes: before.attributes })
        },
      },
    })
  }

  const openEdit = (row: ClaimsTableRow) => {
    if (row.kind === 'profile') {
      setDialog({
        mode: 'edit',
        target: { type: 'profile', field: row.field },
        path: row.isDefault ? undefined : row.path,
      })
    } else if (row.kind === 'role') {
      setDialog({ mode: 'edit', target: { type: 'role' }, role: mapping })
    } else if (row.kind === 'people') {
      setDialog({
        mode: 'edit',
        target: {
          type: 'people',
          attributeKey: row.attributeKey,
          baselineIndex: row.baselineIndex,
        },
        path: row.claimPath,
      })
    }
  }

  const tableModel = buildClaimsTableModel({
    mapping: {
      profile: { claims: profileClaims, allowMissingEmail, sources },
      role: mapping ?? undefined,
      attributes: attributes ?? undefined,
    },
    definitions,
  })
  const addTargets = availableAddTargets({ mapping: draftMapping, definitions })
  const customProfile = hasCustomProfileClaims({ profile: { claims: profileClaims } })
  // What each profile field takes from the last test sign-in under this draft.
  const testValues = previewProfileValues(draftMapping, capture)
  const issue = identityMappingIssue(baseline)
  const hasRoleRules = tableModel.additional.some((row) => row.kind === 'role')

  return (
    <div className="space-y-5">
      {issue && <p className="text-sm font-medium text-warning">{issue}</p>}
      <ClaimsTable
        profileRows={tableModel.profile}
        additionalRows={tableModel.additional}
        peopleFlags={{
          overrideExisting: attributes?.overrideExisting === true,
          syncOnSignIn: attributes?.syncOnSignIn === true,
        }}
        onPeopleFlagsChange={(flags) =>
          updateAttributes((prev) => ({
            map: prev?.map ?? [],
            ...(flags.overrideExisting ? { overrideExisting: true } : {}),
            ...(flags.syncOnSignIn ? { syncOnSignIn: true } : {}),
          }))
        }
        onEdit={openEdit}
        onRemove={removeRow}
        providerLabel={provider.label}
        disabled={saving}
        testValues={testValues}
      />

      <div className="flex items-start gap-2 text-sm">
        <Checkbox
          id={syncId}
          checked={profileSync}
          onCheckedChange={(v) => update({ profileSync: v === true })}
          disabled={saving}
          aria-describedby={`${syncId}-note`}
          className="mt-0.5"
        />
        <div className="space-y-1">
          <Label htmlFor={syncId} className="cursor-pointer">
            Update name and avatar on every sign-in
          </Label>
          <p id={`${syncId}-note`} className="text-muted-foreground">
            {profileSync
              ? 'Keeps profiles in step with your provider. Names or pictures someone changed in Quackback are kept.'
              : 'Name and avatar are set when an account is created.'}
          </p>
        </div>
      </div>

      {hasRoleRules && !provider.autoCreateUsers && (
        <p className="text-sm text-muted-foreground">
          Role rules are not applied while account creation is off.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setDialog({ mode: 'add' })}
          disabled={saving}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add mapping
        </Button>
        {customProfile && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => update({ profileClaims: {} })}
            disabled={saving}
          >
            Use standard profile fields
          </Button>
        )}
      </div>

      {hasCustomSources({ profile: { sources } }) && (
        <p data-testid="compatibility-sources" className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Compatibility:</span> identity is read from{' '}
          {sources.map((s) => SOURCE_LABELS[s]).join(', then ')}.
        </p>
      )}

      <Disclosure
        title="Compatibility"
        defaultOpen={hasCustomSources(provider.claimMapping)}
        testId="compatibility-section"
      >
        <IdentitySourcesEditor
          sources={sources}
          onChange={(next) => update({ sources: next })}
          disabled={saving}
        />
      </Disclosure>

      <OutcomePreviewRail
        capture={capture}
        draft={draftMapping}
        definitions={definitions}
        providerPolicy={{
          autoCreateUsers: provider.autoCreateUsers,
          autoProvisionRole: provider.autoProvisionRole,
          detailsChangedAt: provider.detailsChangedAt,
          registrationId: provider.registrationId,
        }}
        dirty={dirty}
        onSaveAndTest={() => requestSave(true)}
        registrationId={provider.registrationId}
        canTest
      />

      {dirty && (
        <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDraft(draftFrom(baseline))}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => requestSave(false)} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}

      <ClaimRowDialog
        open={dialog != null}
        mode={dialog?.mode ?? 'add'}
        lockedTarget={dialog?.mode === 'edit' ? dialog.target : undefined}
        availableTargets={addTargets}
        definitions={definitions}
        initialPath={dialog?.path}
        initialRole={dialog?.role}
        registrationId={provider.registrationId}
        canTest
        capture={capture}
        draft={draftMapping}
        providerKind={provider.kind}
        autoCreateUsers={provider.autoCreateUsers}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        onCommit={commitDialog}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open)
          if (!open) pendingTest.current = false
        }}
        title="Confirm these changes"
        confirmLabel="Save changes"
        description={
          <div className="space-y-2 text-sm">
            {risks.identifierChanged && (
              <p>
                Changing the Account ID can stop existing accounts matching and create new ones
                instead. Existing accounts are not migrated, and the connection must be tested
                again.
              </p>
            )}
            {adminRulesChanged && (
              <p>
                {risks.adminRules.length === 1
                  ? 'A rule grants admin access.'
                  : `${risks.adminRules.length} rules grant admin access.`}{' '}
                Matching users become admins even when their email is outside this provider&apos;s
                verified domains.
              </p>
            )}
          </div>
        }
        onConfirm={() => {
          setConfirmOpen(false)
          void persist()
        }}
      />
    </div>
  )
}

function adminRulesOf(role: RoleMapping | undefined | null) {
  return (role?.rules ?? []).filter((r) => r.role === 'admin').map((r) => r.whenContains)
}
