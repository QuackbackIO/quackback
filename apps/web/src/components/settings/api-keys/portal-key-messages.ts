/**
 * The words of a teammate's own API keys page, in its own message area
 * (portal.settings.apiKeys.*), for the dialogs, the scope picker and the scope
 * summaries it shares with the admin pages.
 */
import { defineMessages, type IntlShape } from 'react-intl'
import type { KeyDialogMessages } from '@/components/admin/settings/api-keys/key-messages'
import type { DomainAccessWords } from '@/components/domain-access-picker'
import {
  ACCESS_DOMAINS,
  domainAccessLevels,
  type AccessDomainId,
  type ApiKeyScope,
} from '@/lib/shared/api-key-scopes'

export const PORTAL_KEY_MESSAGES: KeyDialogMessages = defineMessages({
  rotateTitle: { id: 'portal.settings.apiKeys.rotate.title', defaultMessage: 'Rotate API key' },
  rotateDescription: {
    id: 'portal.settings.apiKeys.rotate.description',
    defaultMessage: 'Generate a new secret for the API key {name}.',
  },
  rotateWarningTitle: {
    id: 'portal.settings.apiKeys.rotate.warningTitle',
    defaultMessage: 'The old key will stop working immediately',
  },
  rotateWarningDescription: {
    id: 'portal.settings.apiKeys.rotate.warningDescription',
    defaultMessage:
      'Any applications using the current key will lose access until you update them with the new key. The key name and settings will be preserved.',
  },
  rotateConfirm: { id: 'portal.settings.apiKeys.rotate.confirm', defaultMessage: 'Rotate key' },
  rotatePending: { id: 'portal.settings.apiKeys.rotate.pending', defaultMessage: 'Rotating...' },
  revokeTitle: { id: 'portal.settings.apiKeys.revoke.title', defaultMessage: 'Revoke API key' },
  revokeDescription: {
    id: 'portal.settings.apiKeys.revoke.description',
    defaultMessage: 'Are you sure you want to revoke the API key {name}?',
  },
  revokeWarningTitle: {
    id: 'portal.settings.apiKeys.revoke.warningTitle',
    defaultMessage: 'This action cannot be undone',
  },
  revokeWarningDescription: {
    id: 'portal.settings.apiKeys.revoke.warningDescription',
    defaultMessage:
      'Any applications using this key will immediately lose access to the API. You will need to create a new key and update your integrations.',
  },
  revokeConfirm: { id: 'portal.settings.apiKeys.revoke.confirm', defaultMessage: 'Revoke key' },
  revokePending: { id: 'portal.settings.apiKeys.revoke.pending', defaultMessage: 'Revoking...' },
  revealTitle: { id: 'portal.settings.apiKeys.reveal.title', defaultMessage: 'API key created' },
  revealDescription: {
    id: 'portal.settings.apiKeys.reveal.description',
    defaultMessage: 'Your API key {name} is ready.',
  },
  revealSecretLabel: {
    id: 'portal.settings.apiKeys.reveal.secretLabel',
    defaultMessage: 'API key',
  },
  revealConfirm: {
    id: 'portal.settings.apiKeys.reveal.confirm',
    defaultMessage: "I've saved my key",
  },
  revealCopyTitle: {
    id: 'portal.settings.apiKeys.reveal.copyTitle',
    defaultMessage: 'Copy this now',
  },
  revealCopyDescription: {
    id: 'portal.settings.apiKeys.reveal.copyDescription',
    defaultMessage:
      "This is the only time you'll see it. Store it securely and never share it publicly.",
  },
  revealCopy: { id: 'portal.settings.apiKeys.reveal.copy', defaultMessage: 'Copy to clipboard' },
  revealUsage: { id: 'portal.settings.apiKeys.reveal.usage', defaultMessage: 'Usage' },
  renameTitle: { id: 'portal.settings.apiKeys.renameTitle', defaultMessage: 'Rename key' },
  name: { id: 'portal.settings.apiKeys.name', defaultMessage: 'Name' },
  cancel: { id: 'portal.settings.apiKeys.cancel', defaultMessage: 'Cancel' },
  save: { id: 'portal.settings.apiKeys.save', defaultMessage: 'Save' },
  refusalNotFound: {
    id: 'portal.settings.apiKeys.refusal.notFound',
    defaultMessage: 'This key no longer exists or has expired.',
  },
  refusalGrantCeiling: {
    id: 'portal.settings.apiKeys.refusal.grantCeiling',
    defaultMessage: 'You can only manage keys whose role you could give.',
  },
  refusalPolicyOff: {
    id: 'portal.settings.apiKeys.policyOff',
    defaultMessage: 'Your admin has turned off new personal keys.',
  },
  refusalInvalid: {
    id: 'portal.settings.apiKeys.refusal.invalid',
    defaultMessage: 'Check the name and access, then try again.',
  },
  failed: {
    id: 'portal.settings.apiKeys.saveFailed',
    defaultMessage: 'The change could not be saved.',
  },
})

const scope = defineMessages({
  feedback: { id: 'portal.settings.apiKeys.scope.feedback', defaultMessage: 'Feedback' },
  feedbackDescription: {
    id: 'portal.settings.apiKeys.scope.feedbackDescription',
    defaultMessage: 'Posts, comments, boards, and roadmaps',
  },
  changelog: { id: 'portal.settings.apiKeys.scope.changelog', defaultMessage: 'Changelog' },
  changelogDescription: {
    id: 'portal.settings.apiKeys.scope.changelogDescription',
    defaultMessage: 'Changelog entries and releases',
  },
  article: { id: 'portal.settings.apiKeys.scope.article', defaultMessage: 'Help Center' },
  articleDescription: {
    id: 'portal.settings.apiKeys.scope.articleDescription',
    defaultMessage: 'Categories and articles',
  },
  chat: { id: 'portal.settings.apiKeys.scope.chat', defaultMessage: 'Conversations' },
  chatDescription: {
    id: 'portal.settings.apiKeys.scope.chatDescription',
    defaultMessage: 'Support inbox conversations and messages',
  },
  settings: { id: 'portal.settings.apiKeys.scope.settings', defaultMessage: 'Settings' },
  settingsDescription: {
    id: 'portal.settings.apiKeys.scope.settingsDescription',
    defaultMessage: 'Branding, Messenger, modules, and office hours',
  },
  read: { id: 'portal.settings.apiKeys.scope.read', defaultMessage: 'Read' },
  readWrite: { id: 'portal.settings.apiKeys.scope.readWrite', defaultMessage: 'Read and write' },
  write: { id: 'portal.settings.apiKeys.scope.write', defaultMessage: 'Write' },
  chipName: {
    id: 'portal.settings.apiKeys.scope.chipName',
    defaultMessage: '{domain}: {level}',
  },
  highImpact: { id: 'portal.settings.apiKeys.scope.highImpact', defaultMessage: 'High impact' },
  summaryRead: {
    id: 'portal.settings.apiKeys.summary.read',
    defaultMessage: '{domain} (read)',
  },
  summaryReadWrite: {
    id: 'portal.settings.apiKeys.summary.readWrite',
    defaultMessage: '{domain} (read and write)',
  },
  summaryWrite: {
    id: 'portal.settings.apiKeys.summary.write',
    defaultMessage: '{domain} (write)',
  },
  summaryLegacy: {
    id: 'portal.settings.apiKeys.summary.legacy',
    defaultMessage: 'Full access (legacy)',
  },
  summaryAll: { id: 'portal.settings.apiKeys.summary.all', defaultMessage: 'All scopes' },
  summaryNone: { id: 'portal.settings.apiKeys.summary.none', defaultMessage: 'No API scopes' },
})

const LABELS: Record<AccessDomainId, keyof typeof scope> = {
  feedback: 'feedback',
  changelog: 'changelog',
  article: 'article',
  chat: 'chat',
  settings: 'settings',
}

const DESCRIPTIONS: Record<AccessDomainId, keyof typeof scope> = {
  feedback: 'feedbackDescription',
  changelog: 'changelogDescription',
  article: 'articleDescription',
  chat: 'chatDescription',
  settings: 'settingsDescription',
}

/** The scope picker's words on this page. */
export function portalScopeWords(intl: IntlShape): DomainAccessWords {
  return {
    label: (domain) => intl.formatMessage(scope[LABELS[domain]]),
    description: (domain) => intl.formatMessage(scope[DESCRIPTIONS[domain]]),
    read: intl.formatMessage(scope.read),
    readWrite: intl.formatMessage(scope.readWrite),
    write: intl.formatMessage(scope.write),
    chipName: (domain, level) => intl.formatMessage(scope.chipName, { domain, level }),
    highImpact: intl.formatMessage(scope.highImpact),
  }
}

/** A key's scopes in one line, in this page's words. Null scopes are a pre-scope key. */
export function summarizeScopes(
  intl: IntlShape,
  scopes: readonly ApiKeyScope[] | null | undefined
): string {
  if (scopes == null) return intl.formatMessage(scope.summaryLegacy)
  if (scopes.length === 0) return intl.formatMessage(scope.summaryNone)
  const levels = domainAccessLevels(scopes)
  const allOn = ACCESS_DOMAINS.every(
    (d) => levels[d.domain] === (d.kind === 'write_only' ? 'write' : 'read_write')
  )
  if (allOn) return intl.formatMessage(scope.summaryAll)
  const levelMessage = {
    read: scope.summaryRead,
    read_write: scope.summaryReadWrite,
    write: scope.summaryWrite,
  } as const
  return ACCESS_DOMAINS.flatMap((d) => {
    const level = levels[d.domain]
    if (level === 'off') return []
    const domain = intl.formatMessage(scope[LABELS[d.domain]])
    return [intl.formatMessage(levelMessage[level], { domain })]
  }).join(', ')
}

/** Whether a key has passed its expiry: it no longer works and can only be revoked. */
export function isKeyExpired(key: { expiresAt: Date | string | null }): boolean {
  return key.expiresAt != null && new Date(key.expiresAt).getTime() <= Date.now()
}
