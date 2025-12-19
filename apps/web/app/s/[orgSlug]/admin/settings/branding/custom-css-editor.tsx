'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Check, Loader2, Info, ChevronDown } from 'lucide-react'

interface CustomCssEditorProps {
  workspaceId: string
  initialCustomCss: string | null
}

const CSS_DOCUMENTATION = `/* ========================================
   COMPONENT CSS VARIABLES
   ======================================== */

/* Portal Header */
--header-background     /* Header background color */
--header-foreground     /* Header text color */
--header-border         /* Header bottom border color */

/* Post Cards */
--post-card-background  /* Card background */
--post-card-border      /* Card border color */
--post-card-voted-color /* Upvote color when voted */

/* Navigation Tabs */
--nav-active-background  /* Active tab background */
--nav-active-foreground  /* Active tab text */
--nav-inactive-color     /* Inactive tab text */

/* Portal Submit Button */
--portal-button-background
--portal-button-foreground

/* ========================================
   BEM CLASS SELECTORS
   ======================================== */

/* Header */
.portal-header { }
.portal-header__logo { }
.portal-header__name { }
.portal-nav { }
.portal-nav__item { }
.portal-nav__item--active { }

/* Post Cards */
.post-card { }
.post-card__vote { }
.post-card__vote--voted { }
.post-card__content { }

/* Roadmap Cards */
.roadmap-card { }
.roadmap-card__vote { }
.roadmap-card__content { }

/* Submit Button */
.portal-submit-button { }

/* ========================================
   EXAMPLE: Custom Header Background
   ======================================== */
html:root {
  --header-background: oklch(0.3 0.1 260);
  --header-foreground: white;
  --header-border: oklch(0.4 0.1 260);
}

/* ========================================
   EXAMPLE: Custom Post Card Styling
   ======================================== */
.post-card {
  border-radius: 1rem;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.post-card__vote--voted {
  background: linear-gradient(135deg,
    var(--primary),
    color-mix(in oklch, var(--primary), white 20%)
  );
}`

export function CustomCssEditor({ workspaceId, initialCustomCss }: CustomCssEditorProps) {
  const [css, setCss] = useState(initialCustomCss || '')
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDocsOpen, setIsDocsOpen] = useState(false)

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setSaveSuccess(false)
    setError(null)

    try {
      const response = await fetch('/api/workspace/custom-css', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          customCss: css.trim() || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save custom CSS')
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save custom CSS')
    } finally {
      setIsSaving(false)
    }
  }, [workspaceId, css])

  return (
    <div className="space-y-4">
      {/* Documentation Panel */}
      <Collapsible open={isDocsOpen} onOpenChange={setIsDocsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between">
            <span className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              CSS Variable & Class Reference
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isDocsOpen ? 'rotate-180' : ''}`}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <pre className="text-xs font-mono bg-muted p-4 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap">
            {CSS_DOCUMENTATION}
          </pre>
        </CollapsibleContent>
      </Collapsible>

      {/* CSS Editor */}
      <Textarea
        value={css}
        onChange={(e) => setCss(e.target.value)}
        placeholder={`/* Custom CSS for your portal */

html:root {
  --header-background: oklch(0.3 0.1 260);
}

.portal-header {
  /* Additional header styling */
}`}
        className="font-mono text-sm h-64 resize-none"
        spellCheck={false}
      />

      {/* Error Message */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Save Button */}
      <Button onClick={handleSave} disabled={isSaving} className="w-full">
        {isSaving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : saveSuccess ? (
          <>
            <Check className="mr-2 h-4 w-4" />
            Saved!
          </>
        ) : (
          'Save Custom CSS'
        )}
      </Button>
    </div>
  )
}
