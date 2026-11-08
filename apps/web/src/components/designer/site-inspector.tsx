import type { Update } from '@/components/admin/settings/appearance/section-controls'
import { WordsSection } from '@/components/admin/settings/appearance/words-section'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { PropertiesPanel, type Crumb } from './properties/properties-panel'
import { ReachNote } from './properties/scope-line'
import { WORDS } from './properties/words'

/** The words every page uses, on the properties frame. Their looks are in Theme. */
export function SiteInspector({
  crumbs,
  design,
  update,
}: {
  crumbs: readonly Crumb[]
  design: PortalDesign
  update: Update
}) {
  return (
    <PropertiesPanel
      crumbs={crumbs}
      title={WORDS.words}
      className="pb-24"
      data-words-panel=""
      scope={<ReachNote phrase="the words on every page" />}
    >
      <div className="px-4 py-3">
        <WordsSection design={design} update={update} />
      </div>
    </PropertiesPanel>
  )
}
