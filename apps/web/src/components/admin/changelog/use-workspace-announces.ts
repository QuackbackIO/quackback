import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

/**
 * Whether the widget announces new updates above its launcher (Settings >
 * Widget), so an entry's own "Announce above the launcher" choice matters.
 * Read from the workspace's public widget config, which every admin page has.
 */
export function useWorkspaceAnnouncesOnLauncher(): boolean {
  const widget = useWorkspaceSettings()?.publicWidgetConfig
  return !!widget?.enabled && widget.changelog?.announceOnLauncher === true
}
