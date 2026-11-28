import type { MessageDescriptor } from 'react-intl'
import { planRefusalFacts, type PlanRefusalFacts } from '@/lib/shared/describe-upgrade'

type Copy = (
  message: MessageDescriptor & { defaultMessage: string },
  values?: Record<string, string>
) => string

/** Each plan feature's name, as the refusal page's headline names it. */
const FEATURE_NAMES: Record<
  NonNullable<PlanRefusalFacts['entitlement']>,
  MessageDescriptor & { defaultMessage: string }
> = {
  customDomain: { id: 'common.errorPage.feature.customDomain', defaultMessage: 'Custom domains' },
  sso: { id: 'common.errorPage.feature.sso', defaultMessage: 'Single sign-on' },
  aiAssistant: { id: 'common.errorPage.feature.aiAssistant', defaultMessage: 'The AI assistant' },
  aiInsights: { id: 'common.errorPage.feature.aiInsights', defaultMessage: 'AI insights' },
  aiDrafts: { id: 'common.errorPage.feature.aiDrafts', defaultMessage: 'AI drafts' },
  aiArticleTranslation: {
    id: 'common.errorPage.feature.aiArticleTranslation',
    defaultMessage: 'AI article translation',
  },
  workflows: { id: 'common.errorPage.feature.workflows', defaultMessage: 'Workflows' },
  apiAccess: { id: 'common.errorPage.feature.apiAccess', defaultMessage: 'API access' },
  mcpServer: { id: 'common.errorPage.feature.mcpServer', defaultMessage: 'The MCP server' },
  webhooks: { id: 'common.errorPage.feature.webhooks', defaultMessage: 'Webhooks' },
  auditLog: { id: 'common.errorPage.feature.auditLog', defaultMessage: 'The audit log' },
  hideBranding: { id: 'common.errorPage.feature.hideBranding', defaultMessage: 'Branding removal' },
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
  const form = facts.plural ? 'plural' : 'single'
  const feature = facts.entitlement ? copy(FEATURE_NAMES[facts.entitlement]) : null

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
