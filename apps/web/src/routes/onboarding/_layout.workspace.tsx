import { createFileRoute, redirect } from '@tanstack/react-router'
import { ensureOnboardingHomeReadyFn } from '@/lib/server/functions/onboarding'
import { getCloudIdentityFn } from '@/lib/server/functions/cloud-identity'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { pickOnboardingStep } from './-onboarding-step'
import { WorkspaceStep } from './-workspace-step'

export const Route = createFileRoute('/onboarding/_layout/workspace')({
  loader: async ({ context }) => {
    const { session } = context
    if (!session?.user) throw redirect({ to: '/onboarding/account' })
    const state = await checkOnboardingState()
    // Setup is somebody else's. The wizard answers that itself: routing out to
    // a sign-in route bounces off the root gate and comes straight back here.
    if (state.setupClaimedByOther) throw redirect({ to: '/onboarding/no-access' })
    const target = pickOnboardingStep({ session: { userId: session.user.id }, state })
    // Back navigation remains available until the starting point is resolved;
    // this lets admins correct either field without creating a duplicate artifact.
    // A caller who still has to claim this workspace is routed HERE, so honour
    // that before the stamp: redirecting to our own path would only loop.
    if (target !== '/onboarding/workspace') {
      if (target === '/admin') await ensureOnboardingHomeReadyFn()
      throw redirect({ to: target })
    }
    const isCloudProvisioned = state.setupOpenToClaim === false
    return {
      isCloudProvisioned,
      cloudIdentity: isCloudProvisioned ? await getCloudIdentityFn() : null,
      existingWorkspaceName: context.settings?.name ?? '',
    }
  },
  component: WorkspaceStepRoute,
})

function WorkspaceStepRoute() {
  const data = Route.useLoaderData()
  const { managedFieldPaths } = Route.useRouteContext()
  return <WorkspaceStep {...data} managedFieldPaths={managedFieldPaths ?? []} />
}
