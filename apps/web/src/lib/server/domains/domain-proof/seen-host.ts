/**
 * The header `/api/health` names the host it was asked on with, as this
 * server reads it (`requestWorkspaceHost`, the reading section routing uses).
 * The custom domain check (`reachability-probe.ts`) compares it with the
 * hostname it asked for: a proxy that answers on the hostname but hands this
 * server another Host passes a plain GET, yet no section is ever served there.
 */
export const SEEN_HOST_HEADER = 'x-quackback-host'
