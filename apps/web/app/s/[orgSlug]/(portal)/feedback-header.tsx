interface FeedbackHeaderProps {
  organizationName: string
}

export function FeedbackHeader({ organizationName }: FeedbackHeaderProps) {
  return (
    <div className="bg-card border border-border/40 rounded-lg px-5 py-4 mb-5 shadow-sm">
      <h1 className="text-xl font-bold text-foreground tracking-tight">Share your feedback</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Help us improve {organizationName} by sharing ideas, suggestions, or reporting issues.
      </p>
    </div>
  )
}
