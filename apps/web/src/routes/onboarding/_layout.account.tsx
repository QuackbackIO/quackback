import { createFileRoute, redirect } from '@tanstack/react-router'
import { checkOnboardingState, getPublicAuthConfig } from '@/lib/server/functions/admin'
import { getWorkspaceClaimFn } from '@/lib/server/functions/onboarding'
import { accountAuthConfig } from './-account-auth-config'
import { pickOnboardingStep } from './-onboarding-step'
import { AccountStep } from './-account-step'

export const Route = createFileRoute('/onboarding/_layout/account')({
  loader: async ({ context }) => {
    const { session, settings } = context

    if (session?.user) {
      const state = await checkOnboardingState()
      throw redirect({ to: pickOnboardingStep({ session: { userId: session.user.id }, state }) })
    }

    // Two facts decide what this screen can honestly offer, and both come
    // from the workspace's own state: whether an admin already owns setup,
    // and which sign-in methods the workspace actually accepts. An
    // env-baked SSO provider still short-circuits both — it is the only
    // legitimate path to admin in that mode, so the first user must land
    // through it rather than create an account that would shadow the
    // intended owner.
    const [{ ssoEnabled }, claim] = await Promise.all([
      getPublicAuthConfig(),
      getWorkspaceClaimFn(),
    ])

    return {
      ssoEnabled,
      claim,
      workspaceName: settings?.name ?? undefined,
      authConfig: accountAuthConfig(settings, context.registeredAuthProviders),
    }
  },
  component: AccountStepRoute,
})

function AccountStepRoute() {
  const { ssoEnabled, claim, authConfig, workspaceName } = Route.useLoaderData()
  return (
    <AccountStep
      ssoEnabled={ssoEnabled}
      claim={claim}
      authConfig={authConfig}
      workspaceName={workspaceName}
    />
  )
}
