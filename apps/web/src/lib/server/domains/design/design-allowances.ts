/**
 * What Quackback AI may bring into this workspace's design: Home blocks for
 * the pages it has, and CSS the check passes on a plan with custom CSS.
 */
export async function designAllowances() {
  const [
    { getWorkspaceSettings },
    { portalPageGates },
    { homeBlockTypes },
    { lintDesignCss },
    { assertTierFeature },
    { config },
  ] = await Promise.all([
    import('@/lib/server/domains/settings/settings.service'),
    import('@/lib/shared/design/paths'),
    import('@/lib/shared/design/home'),
    import('@/lib/server/domains/design/css-lint'),
    import('@/lib/server/domains/settings/tier-enforce'),
    import('@/lib/server/config'),
  ])
  const settings = await getWorkspaceSettings()
  const cssOnPlan = await assertTierFeature('customCss', 'Custom CSS').then(
    () => true,
    () => false
  )
  const writesCss = !!config.portalDesignAiCss
  const gates = portalPageGates(settings, true)
  return {
    /** The workspace's name, which its portal shows. */
    name: settings?.name ?? null,
    /** Whether the workspace has a logo mark. */
    hasMark: !!settings?.settings?.logoKey,
    /** The pages the portal has, which Home's blocks follow. */
    gates,
    blockTypes: homeBlockTypes(gates),
    writesCss,
    checkCss: (css: string) => {
      if (!writesCss) return 'Quackback AI does not write CSS'
      if (!cssOnPlan) return 'custom CSS is not on this plan'
      const [error] = lintDesignCss(css).errors
      return error ? `${error.line ? `line ${error.line}, ` : ''}${error.message}` : null
    },
  }
}
