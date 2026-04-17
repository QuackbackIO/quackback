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
  tabs?: { feedback?: boolean; changelog?: boolean; help?: boolean }
  imageUploadsInWidget?: boolean
  hmacRequired?: boolean
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
