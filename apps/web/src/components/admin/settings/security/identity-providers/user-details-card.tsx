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
 * reversible (Undo toast). Saving an Account ID change still asks first: it
 * changes which account a sign-in reaches. Role rules are the Roles card's;
 * Save here carries them through untouched.
 */
import { useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'
import { settingsQueries } from '@/lib/client/queries/settings'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import {
  PROFILE_FIELDS,
  profileSyncEnabled,
  type IdentitySource,
  type ProfileField,
} from '@/lib/shared/oidc-claim-mapping'
import type { AttributeDefinition } from '@/lib/shared/plan-claim-attribute-writes'
import {
  adminTierRoleIds,
  diffClaimMappingOperations,
  mappingSaveRisks,
  sourcesAreDefault,
  type ClaimMappingOperation,
} from '@/lib/shared/sso-claim-mapping-edit'
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
  isCustomProfilePath,
  mergeClaimMapping,
  normalizeAttributeMapping,
  normalizeProfileClaims,
  withAllowMissingEmail,
  type AttributeMapping,
  type ClaimsTableRow,
  type PeopleDefinition,
} from './provider-shared'
import { grantableRoles, verifiedDomainNames } from './role-outcome'
import { useRolesDraft } from './roles-draft-context'

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
        {/* Keyed so a draft never carries from one provider to another. */}
        <ProfileEditor
          key={provider.id}
          provider={provider}
          providerLabel={label}
          definitions={definitions}
        />
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
  attributes: AttributeMapping | null
  profileClaims: Partial<Record<ProfileField, string>>
  sources: IdentitySource[]
  profileSync: boolean
}

function draftFrom(mapping: StoredMapping): Draft {
  return {
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

// Role rules are the Roles card's, so the role section is never a draft here.
const SECTIONS = ['profile', 'attributes'] as const
type Section = (typeof SECTIONS)[number]

/**
 * One section of a draft in normalized form, so a stored mapping that is
 * written unusually (an explicit standard claim, People flags with no rows) reads as untouched. A blank stored path stays distinct
 * from the standard claim: clearing it is an edit worth saving.
 */
function sectionKey(draft: Draft, section: Section): string {
  if (section === 'attributes') {
    const attributes = normalizeAttributeMapping(draft.attributes)
    return JSON.stringify(
      attributes
        ? [
            (attributes.map ?? []).map((r) => [r.claimPath.trim(), r.attributeKey]),
            attributes.overrideExisting === true,
            attributes.syncOnSignIn === true,
          ]
        : null
    )
  }
  const claims: Partial<Record<ProfileField, string>> = {}
  for (const field of PROFILE_FIELDS) {
    const path = draft.profileClaims[field]
    if (typeof path !== 'string') continue
    if (path.trim() === '') claims[field] = ''
    else if (isCustomProfilePath(field, path)) claims[field] = path.trim()
  }
  return JSON.stringify([
    claims,
    sourcesAreDefault(draft.sources) ? null : draft.sources,
    draft.profileSync,
  ])
}

/**
 * The diff reads stored claims through the parser, which already ignores a
 * blank path, so it sees nothing to reset. When the admin clears one in the
 * dialog, remove the stored blank value explicitly.
 */
function clearedBlankPaths(base: StoredMapping, draft: Draft): ClaimMappingOperation[] {
  const storedClaims = base?.profile?.claims ?? {}
  return PROFILE_FIELDS.filter((field) => {
    const before = storedClaims[field]
    if (typeof before !== 'string' || before.trim() !== '') return false
    const after = draft.profileClaims[field]
    return !(typeof after === 'string' && after.trim() === '') && !isCustomProfilePath(field, after)
  }).map((field) => ({ op: 'resetProfileClaim', field }))
}

function sectionEdited(draft: Draft, base: Draft, section: Section): boolean {
  return sectionKey(draft, section) !== sectionKey(base, section)
}

function withSection(draft: Draft, from: Draft, section: Section): Draft {
  if (section === 'attributes') return { ...draft, attributes: from.attributes }
  return {
    ...draft,
    profileClaims: from.profileClaims,
    sources: from.sources,
    profileSync: from.profileSync,
  }
}

/**
 * Bring a draft onto a newly stored mapping. Sections the admin has not
 * edited follow the stored values. An edited section is kept; if it also
 * changed underneath (to something else), that is a conflict and the draft
 * stays based on the old mapping so Save is refused instead of overwriting.
 */
function rebaseDraft(
  draft: Draft,
  base: Draft,
  stored: StoredMapping
): { draft: Draft; conflict: boolean } {
  const fresh = draftFrom(stored)
  let next = draft
  let conflict = false
  for (const section of SECTIONS) {
    if (!sectionEdited(draft, base, section)) {
      next = withSection(next, fresh, section)
    } else if (
      sectionEdited(fresh, base, section) &&
      sectionKey(fresh, section) !== sectionKey(draft, section)
    ) {
      conflict = true
    }
  }
  return { draft: next, conflict }
}

function ProfileEditor({
  provider,
  providerLabel,
  definitions,
}: {
  provider: IdentityProvider
  providerLabel: string
  definitions: MappingDefinition[]
}) {
  const { saving, saveClaimMapping } = useProviderSave(provider)
  const { openTest } = useConnectionTest(provider)
  const capture = useProviderCapture(provider)
  // Names a matched rule's custom role in the preview, or shows it missing.
  const { data: rolesData } = useQuery(settingsQueries.roles())
  // Unsaved edits on the Roles card, so the preview's Role line matches them.
  const rolesDraft = useRolesDraft()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dialog, setDialog] = useState<{
    mode: 'add' | 'edit'
    target?: ClaimRowDialogTarget
    path?: string
  } | null>(null)
  const stored = provider.claimMapping
  // `baseline` is the stored mapping the draft is based on: what it is
  // compared with, what Cancel returns to, and what Save expects to replace.
  const [baseline, setBaseline] = useState<StoredMapping>(stored)
  const [seenStored, setSeenStored] = useState<StoredMapping>(stored)
  const [draft, setDraft] = useState<Draft>(() => draftFrom(stored))
  const baseDraft = useMemo(() => draftFrom(baseline), [baseline])
  const syncId = useId()
  const pendingTest = useRef(false)

  // The stored mapping changed: a save here (the refetch lands during the
  // await), a save on another card, or another admin.
  if (seenStored !== stored) {
    setSeenStored(stored)
    const rebased = rebaseDraft(draft, baseDraft, stored)
    setDraft(rebased.draft)
    if (!rebased.conflict) setBaseline(stored)
  }
  const conflict = baseline !== stored

  const { attributes, profileClaims, sources, profileSync } = draft
  const update = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }))
  const updateAttributes = (fn: (prev: AttributeMapping | null) => AttributeMapping | null) =>
    setDraft((prev) => ({ ...prev, attributes: fn(prev.attributes) }))
  const allowMissingEmail = baseline?.profile?.allowMissingEmail === true

  const profile = draftProfile(baseline, draft)
  const draftMapping = mergeClaimMapping(baseline, {
    profile,
    attributes: attributes ?? undefined,
  })
  const proposed = mergeClaimMapping(baseline, {
    profile,
    attributes: normalizeAttributeMapping(attributes),
  })
  const operations = [
    ...diffClaimMappingOperations(baseline, proposed),
    ...clearedBlankPaths(baseline, draft),
  ]
  const risks = mappingSaveRisks(baseline, proposed)
  const dirty = SECTIONS.some((section) => sectionEdited(draft, baseDraft, section))
  const needsConfirm = dirty && risks.identifierChanged

  const revert = () => {
    setBaseline(stored)
    setDraft(draftFrom(stored))
  }

  const persist = async () => {
    const thenTest = pendingTest.current
    pendingTest.current = false
    // The draft reads as saved once the refetched stored mapping says so.
    const saved = await saveClaimMapping(
      {
        expectedClaimMapping: baseline,
        operations,
        acknowledgeIdentifierChange: risks.identifierChanged,
        // This card never edits role rules; stored ones are carried through.
        acknowledgeAdminRules: true,
      },
      'Profile saved.'
    )
    if (saved && thenTest) openTest()
  }

  const requestSave = (thenTest = false) => {
    if (!dirty) return
    if (operations.length === 0) {
      // Edited back to an equivalent of what is stored: nothing to write.
      revert()
      return
    }
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
    let label: string
    let undo: () => void
    if (row.kind === 'people') {
      const index = row.baselineIndex
      const entry = attributes?.map?.[index]
      if (!attributes || !entry) return
      const section = attributes
      updateAttributes((prev) => {
        if (!prev) return prev
        const map = (prev.map ?? []).filter((_, i) => i !== index)
        return map.length === 0 ? null : { ...prev, map }
      })
      label = `the ${row.label} mapping`
      // Put back this one row, and the section's flags if it went with it.
      undo = () =>
        updateAttributes((prev) => {
          const map = [...(prev?.map ?? [])]
          map.splice(Math.min(index, map.length), 0, entry)
          return { ...(prev ?? section), map }
        })
    } else {
      return
    }
    toast(`Removed ${label}.`, { action: { label: 'Undo', onClick: undo } })
  }

  const openEdit = (row: ClaimsTableRow) => {
    if (row.kind === 'profile') {
      setDialog({
        mode: 'edit',
        target: { type: 'profile', field: row.field },
        path: row.isDefault ? undefined : row.path,
      })
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
      attributes: attributes ?? undefined,
    },
    definitions,
  })
  const addTargets = availableAddTargets({ mapping: draftMapping, definitions })
  const customProfile = hasCustomProfileClaims({ profile: { claims: profileClaims } })
  // What each profile field takes from the last test sign-in under this draft.
  const testValues = previewProfileValues(draftMapping, capture)
  const issue = identityMappingIssue(baseline)

  return (
    <div className="space-y-5">
      {conflict && (
        <p role="status" className="text-sm font-medium text-warning">
          This provider&apos;s profile settings changed elsewhere. Review before saving.
        </p>
      )}
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
        providerLabel={providerLabel}
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

      <Disclosure
        title="Compatibility"
        defaultOpen={hasCustomSources(provider.claimMapping)}
        summary={
          hasCustomSources({ profile: { sources } })
            ? sources.map((s) => SOURCE_LABELS[s]).join(' → ')
            : undefined
        }
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
        draft={
          rolesDraft ? mergeClaimMapping(draftMapping, { role: rolesDraft.role }) : draftMapping
        }
        definitions={definitions}
        providerPolicy={{
          autoCreateUsers: provider.autoCreateUsers,
          autoProvisionRole: rolesDraft ? rolesDraft.defaultRole : provider.autoProvisionRole,
          detailsChangedAt: provider.detailsChangedAt,
          registrationId: provider.registrationId,
        }}
        verifiedDomains={verifiedDomainNames(provider.domains)}
        roles={rolesData ? grantableRoles(rolesData.roles) : undefined}
        roleUnsaved={rolesDraft !== null}
        adminTierRoleIds={adminTierRoleIds(rolesData?.roles ?? [])}
        dirty={dirty}
        onSaveAndTest={() => requestSave(true)}
        registrationId={provider.registrationId}
        canTest
      />

      {dirty && (
        <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-5">
          <Button type="button" variant="outline" size="sm" onClick={revert} disabled={saving}>
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
        registrationId={provider.registrationId}
        canTest
        capture={capture}
        draft={draftMapping}
        providerKind={provider.kind}
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
          <p className="text-sm">
            Changing the Account ID can stop existing accounts matching and create new ones instead.
            Existing accounts are not migrated, and the connection must be tested again.
          </p>
        }
        onConfirm={() => {
          setConfirmOpen(false)
          void persist()
        }}
      />
    </div>
  )
}
