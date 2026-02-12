import { ShieldCheckIcon } from '@heroicons/react/24/outline'

export function TelemetryInfo() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
        <ShieldCheckIcon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No personal data is collected</p>
          <p className="mt-1">
            Telemetry only includes anonymous aggregate data to help us understand how Quackback is
            used and where to focus improvements.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">What we collect:</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>Quackback version and runtime (Bun/Node)</li>
          <li>OS and architecture</li>
          <li>Deploy method (Railway, Docker, etc.)</li>
          <li>Feature flags (which features are enabled)</li>
          <li>Scale brackets (e.g. &quot;1-10 users&quot;, not exact counts)</li>
          <li>Random instance ID (not tied to any identity)</li>
        </ul>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Opt out:</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>Toggle above</li>
          <li>
            Set{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">TELEMETRY_ENABLED=false</code> in
            your environment
          </li>
          <li>
            Set <code className="text-xs bg-muted px-1 py-0.5 rounded">DO_NOT_TRACK=1</code>{' '}
            (standard convention)
          </li>
        </ul>
      </div>
    </div>
  )
}
