import type { MessageDescriptor } from 'react-intl'
import { planRefusalFacts } from '@/lib/shared/describe-upgrade'

type Copy = (
  message: MessageDescriptor & { defaultMessage: string },
  values?: Record<string, string>
) => string

type Descriptor = MessageDescriptor & { defaultMessage: string }

/**
 * Each plan feature's name as the refusal page's headline words it, keyed by
 * the English name the server's sentence uses, with whether that name takes a
 * plural verb. A test keeps these in step with the plan catalogue's
 * ENTITLEMENTS, which this page does not import (its data would ride every page).
 */
export const PLAN_FEATURE_NAMES: Record<string, { name: Descriptor; plural: boolean }> = {
  'Custom domains': {
    name: { id: 'common.errorPage.feature.customDomain', defaultMessage: 'Custom domains' },
    plural: true,
  },
  'Single sign-on': {
    name: { id: 'common.errorPage.feature.sso', defaultMessage: 'Single sign-on' },
    plural: false,
  },
  'The AI assistant': {
    name: { id: 'common.errorPage.feature.aiAssistant', defaultMessage: 'The AI assistant' },
    plural: false,
  },
  'AI insights': {
    name: { id: 'common.errorPage.feature.aiInsights', defaultMessage: 'AI insights' },
    plural: true,
  },
  'AI drafts': {
    name: { id: 'common.errorPage.feature.aiDrafts', defaultMessage: 'AI drafts' },
    plural: true,
  },
  'AI article translation': {
    name: {
      id: 'common.errorPage.feature.aiArticleTranslation',
      defaultMessage: 'AI article translation',
    },
    plural: false,
  },
  Workflows: {
    name: { id: 'common.errorPage.feature.workflows', defaultMessage: 'Workflows' },
    plural: true,
  },
  'API access': {
    name: { id: 'common.errorPage.feature.apiAccess', defaultMessage: 'API access' },
    plural: false,
  },
  'The MCP server': {
    name: { id: 'common.errorPage.feature.mcpServer', defaultMessage: 'The MCP server' },
    plural: false,
  },
  Webhooks: {
    name: { id: 'common.errorPage.feature.webhooks', defaultMessage: 'Webhooks' },
    plural: true,
  },
  'The audit log': {
    name: { id: 'common.errorPage.feature.auditLog', defaultMessage: 'The audit log' },
    plural: false,
  },
  'Branding removal': {
    name: { id: 'common.errorPage.feature.hideBranding', defaultMessage: 'Branding removal' },
    plural: false,
  },
}

const HEADLINE = {
  availableFrom: {
    id: 'common.errorPage.plan.availableFrom',
    defaultMessage:
      '{feature} {form, select, plural {are} other {is}} available from the {plan} plan',
  },
  notIncluded: {
    id: 'common.errorPage.plan.notIncluded',
    defaultMessage: '{feature} {form, select, plural {are} other {is}} not included in your plan',
  },
  featureFrom: {
    id: 'common.errorPage.plan.featureFrom',
    defaultMessage: 'This feature is available from the {plan} plan',
  },
  generic: { id: 'common.errorPage.plan.headline', defaultMessage: 'This is a plan feature' },
} as const

const BODY = {
  upgrade: {
    id: 'common.errorPage.plan.upgradeBody',
    defaultMessage: 'Upgrade to {plan} to enable {form, select, plural {them} other {it}}.',
  },
  contact: {
    id: 'common.errorPage.plan.contactBody',
    defaultMessage: 'Contact us to add {form, select, plural {them} other {it}} to your plan.',
  },
} as const

export interface PlanRefusalCopy {
  headline: string
  body: string
  /** The plan that includes the feature, when the refusal names one. */
  requiredPlanName: string | null
}

/**
 * The plan refusal page's words in the page's language. The server's sentence
 * is English, so only what it names (the feature and the plan) is read from
 * it; a feature this page cannot name is called "this feature".
 */
export function planRefusalCopy(error: unknown, copy: Copy): PlanRefusalCopy {
  const facts = planRefusalFacts(error)
  const plan = facts.requiredPlanName
  const known =
    facts.feature && Object.hasOwn(PLAN_FEATURE_NAMES, facts.feature)
      ? PLAN_FEATURE_NAMES[facts.feature]
      : undefined
  const form = known?.plural ? 'plural' : 'single'
  const feature = known ? copy(known.name) : null

  if (plan) {
    return {
      headline: feature
        ? copy(HEADLINE.availableFrom, { feature, form, plan })
        : copy(HEADLINE.featureFrom, { plan }),
      body: copy(BODY.upgrade, { plan, form }),
      requiredPlanName: plan,
    }
  }
  return {
    headline: feature ? copy(HEADLINE.notIncluded, { feature, form }) : copy(HEADLINE.generic),
    body: copy(BODY.contact, { form }),
    requiredPlanName: null,
  }
}
