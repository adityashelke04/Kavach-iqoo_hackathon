import type { DetectionResult } from '../detector/types.ts'
import { Findings, VerdictBanner } from '../ui/components/index.tsx'
import { copy } from '../ui/copy.ts'

/**
 * Verdict — SPEC.md §10.6. The most important screen in the product.
 *
 * Order is deliberate (§10.1): the judgment, then the proof, then the
 * explanation. A highlighted phrase in the user's own message convinces where
 * a paragraph does not.
 *
 * The banner scrolls away normally — it is not pinned. A sticky red bar over a
 * scrolling message is oppressive and fights "calm under alarm".
 */
export function Verdict({
  result,
  text,
  onAgain,
}: {
  result: DetectionResult
  text: string
  onAgain: () => void
}) {
  return (
    <div className="screen">
      <VerdictBanner verdict={result.verdict} />

      <div className="screen__body">
        <Findings result={result} text={text} />
      </div>

      <div className="screen__footer">
        <button className="btn btn--primary" onClick={onAgain}>
          {copy.cta_again}
        </button>
      </div>
    </div>
  )
}
