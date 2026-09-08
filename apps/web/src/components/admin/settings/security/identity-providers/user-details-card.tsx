/**
 * User details — what Quackback reads from this provider about a person.
 *
 * Most providers need nothing here: standard OpenID Connect claims identify
 * the account (`sub`), and set its email and name. So the resting state is a
 * sentence, not a table: "Uses standard profile fields", with Customize. The
 * table appears when something is custom, or when the admin opens the editor.
 *
 * The editor edits a local draft; Save diffs closed operations against the
 * stored JSON so unrelated sections survive. Removing a draft row is
 * reversible (Undo toast). Saving an Account ID change, or role rules that
 * grant admin, still asks first — those are the two edits that change who
 * gets into what.
 */
import { useMemo, useRef, useState } from 'react'
import { PlusIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { IdentitySource } from '@/lib/shared/oidc-claim-mapping'
import type { AttributeDefinition } from '@/lib/shared/plan-claim-attribute-writes'
import { diffClaimMappingOperations, mappingSaveRisks } from '@/lib/shared/sso-claim-mapping-edit'
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
  userDetailsAreStandard,
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
  const [editing, setEditing] = useState(false)
  const definitions = useDefinitions()

  return (
    <div id="mapping" className="scroll-mt-6">
      <SettingsCard
        title="User details"
        contentClassName="space-y-4"
        action={
          editing ? undefined : (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              Customize
            </Button>
          )
        }
      >
        {editing ? (
          <UserDetailsEditor
            provider={provider}
            definitions={definitions}
            onDone={() => setEditing(false)}
          />
        ) : (
          <UserDetailsSummary provider={provider} definitions={definitions} />
        )}
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

function UserDetailsSummary({
  provider,
  definitions,
}: {
  provider: IdentityProvider
  definitions: MappingDefinition[]
}) {
  const mapping = provider.claimMapping
  const issue = identityMappingIssue(mapping)

  if (userDetailsAreStandard(mapping)) {
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium">Uses standard profile fields</p>
        <p className="text-muted-foreground">No role rules or custom attributes.</p>
      </div>
    )
  }

  const model = buildClaimsTableModel({ mapping, definitions })
  const customProfile = hasCustomProfileClaims(mapping)

  return (
    <div className="space-y-4 text-sm">
      {issue && <p className="font-medium text-amber-700 dark:text-amber-400">{issue}</p>}
      {!customProfile && <p className="font-medium">Uses standard profile fields</p>}
      <ClaimsTable
        profileRows={customProfile ? model.profile : []}
        additionalRows={model.additional}
        peopleFlags={{
          overrideExisting: mapping?.attributes?.overrideExisting === true,
          syncOnSignIn: mapping?.attributes?.syncOnSignIn === true,
        }}
        onPeopleFlagsChange={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
        editable={false}
      />
      {mapping?.role && !provider.autoCreateUsers && (
        <p className="text-muted-foreground">
          Role rules are not applied while account creation is off.
        </p>
      )}
      {hasCustomSources(mapping) && (
        <p data-testid="compatibility-sources">
          <span className="font-medium">Compatibility:</span> identity is read from{' '}
          {draftSources(mapping)
            .map((s) => SOURCE_LABELS[s])
            .join(', then ')}
          .
        </p>
      )}
    </div>
  )
}

function UserDetailsEditor({
  provider,
  definitions,
  onDone,
}: {
  provider: IdentityProvider
  definitions: MappingDefinition[]
  onDone: () => void
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
  const [mapping, setMapping] = useState<RoleMapping | null>(provider.claimMapping?.role ?? null)
  const [attributes, setAttributes] = useState<AttributeMapping | null>(
    provider.claimMapping?.attributes ?? null
  )
  const [profileClaims, setProfileClaims] = useState<{
    id?: string
    email?: string
    name?: string
  }>(() => ({ ...(provider.claimMapping?.profile?.claims ?? {}) }))
  const [sources, setSources] = useState<IdentitySource[]>(() =>
    draftSources(provider.claimMapping)
  )
  const pendingTest = useRef(false)
  // The missing-email policy is owned by Sign-in & access; carried through
  // untouched so this editor's Save cannot flip it.
  const allowMissingEmail = provider.claimMapping?.profile?.allowMissingEmail === true

  const profile = normalizeProfileClaims({
    ...withAllowMissingEmail({ claims: profileClaims, sources }, allowMissingEmail),
    claims: profileClaims,
    sources,
  })
  const draftMapping = mergeClaimMapping(provider.claimMapping, {
    role: mapping ?? undefined,
    profile,
    attributes: attributes ?? undefined,
  })
  const proposed = mergeClaimMapping(provider.claimMapping, {
    role: normalizeRoleMapping(mapping),
    profile,
    attributes: normalizeAttributeMapping(attributes),
  })
  const operations = diffClaimMappingOperations(provider.claimMapping, proposed)
  const risks = mappingSaveRisks(provider.claimMapping, proposed)
  const dirty = operations.length > 0
  // Admin rules that already existed and did not change are acknowledged
  // silently; only new or altered admin rules get a confirmation.
  const adminRulesChanged =
    risks.hasAdminRules &&
    JSON.stringify(adminRulesOf(provider.claimMapping?.role)) !==
      JSON.stringify(adminRulesOf(proposed?.role))
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
      'User details saved.'
    )
    if (!saved) return
    onDone()
    if (thenTest) openTest()
  }

  const requestSave = (thenTest = false) => {
    if (!dirty) {
      onDone()
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
      setProfileClaims((prev) => {
        const next = { ...prev }
        if (commit.path == null) delete next[commit.field]
        else next[commit.field] = commit.path
        return next
      })
      return
    }
    if (commit.type === 'role') {
      setMapping(commit.mapping)
      return
    }
    setAttributes((prev) => {
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
      setMapping(null)
      label = 'role rules'
    } else if (row.kind === 'people') {
      setAttributes((prev) => {
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
          setMapping(before.mapping)
          setAttributes(before.attributes)
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

  return (
    <div className="space-y-5">
      <ClaimsTable
        profileRows={tableModel.profile}
        additionalRows={tableModel.additional}
        peopleFlags={{
          overrideExisting: attributes?.overrideExisting === true,
          syncOnSignIn: attributes?.syncOnSignIn === true,
        }}
        onPeopleFlagsChange={(flags) =>
          setAttributes((prev) => ({
            map: prev?.map ?? [],
            ...(flags.overrideExisting ? { overrideExisting: true } : {}),
            ...(flags.syncOnSignIn ? { syncOnSignIn: true } : {}),
          }))
        }
        onEdit={openEdit}
        onRemove={removeRow}
        editable
        disabled={saving}
      />

      <p className="text-sm text-muted-foreground">
        Email and name are set when an account is created.
      </p>

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
            onClick={() => setProfileClaims({})}
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
        <IdentitySourcesEditor sources={sources} onChange={setSources} disabled={saving} />
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

      <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-5">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => requestSave(false)} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

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
                Matching people become admins even when their email is outside this provider&apos;s
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
