import { copy } from '../copy.ts'
import type { Verdict } from '../../detector/types.ts'
import type { Prediction } from '../../predict/types.ts'

/**
 * What usually happens next — SPEC.md §10.6, decision D17.
 *
 * A component: it renders a `Prediction` and knows nothing about how one is
 * chosen (§10.3). The caller decides whether there is anything to show.
 *
 * The list is ordered because the order is the content — the third line is
 * where the money moves, and a person who reads all three before the second one
 * arrives is inoculated against the rest of the call. Those are step ordinals,
 * not a measure of the message: §4 is about numbers that rate the message, and
 * "1, 2, 3" here counts the sender's moves, exactly as the report's "do this
 * now" list counts the reader's (D16).
 *
 * Nothing in this component is ever shown on a `safe` verdict — the caller
 * enforces that, and `test:predict` proves no legitimate message can even
 * produce a `Prediction` to pass in.
 */
export function NextLines({
  prediction,
  verdict,
}: {
  prediction: Prediction
  verdict: Verdict
}) {
  return (
    <section className="panel next-lines">
      <h2 className="panel__title">
        {verdict === 'caution' ? copy.next_lines_title_caution : copy.next_lines_title}
      </h2>
      <p className="next-lines__lead">{copy.next_lines_lead}</p>

      <ol className="next-lines__steps">
        {prediction.steps.map((step) => (
          <li className="next-lines__step" key={step}>
            {step}
          </li>
        ))}
      </ol>

      <p className="next-lines__ending">{prediction.ending}</p>
    </section>
  )
}
