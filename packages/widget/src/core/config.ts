/** Server config shape returned from `/api/widget/config.json`. */
export interface ServerConfig {
  /**
   * Theme colors configured in the admin dashboard. Opaque to this package —
   * sdk.ts picks out the primary/foreground fields it needs and pushes them
   * to the launcher via `setColors`.
   */
  theme?: {
    lightPrimary?: string
    lightPrimaryForeground?: string
    darkPrimary?: string
    darkPrimaryForeground?: string
    themeMode?: 'light' | 'dark' | 'user'
  }
  tabs?: {
    feedback?: boolean
    changelog?: boolean
    help?: boolean
    chat?: boolean
    tickets?: boolean
  }
  imageUploadsInWidget?: boolean
  hmacRequired?: boolean
  /** Host-page pageview tracking; the SDK starts the tracker only when true. */
  visitorAnalytics?: boolean
  /** Durable device id (layer-2 identity); minted only when true. */
  visitorDeviceTracking?: boolean
  /** Proactive greeting shown beside the closed launcher; empty/unset hides it. */
  launcherGreeting?: string
  /** Text label on the launcher button; empty/unset keeps the icon-only circle. */
  launcherLabel?: string
  /** Launcher corner from the workspace's widget settings. Overrides the init
   *  `placement` when set — the admin setting is the operator-facing control. */
  position?: 'left' | 'right'
}

export async function fetchServerConfig(instanceUrl: string): Promise<ServerConfig> {
  try {
    const res = await fetch(`${instanceUrl}/api/widget/config.json`)
    if (!res.ok) return {}
    return (await res.json()) as ServerConfig
  } catch {
    return {}
  }
}
