import { copy } from '../ui/copy.ts'
import {
  ShieldLogo,
  IconMessageSquare,
  IconMic,
  IconChevronRight,
  IconLock,
} from '../ui/icons.tsx'

/**
 * Home — SPEC.md §10.6.
 *
 * Two actions and one claim. An earlier version carried a four-card "defense
 * architecture" grid below the fold, which restated the privacy line in
 * different words and pushed both real actions out of comfortable thumb reach
 * on a 412px screen. What the product does on this screen is let someone start;
 * the architecture story is earned on the verdict screen, under "How we
 * checked", where there is something concrete to attach it to.
 */
export function Home({
  onCheck,
  onListen,
}: {
  onCheck: () => void
  onListen: () => void
}) {
  return (
    <main className="screen screen--bare">
      <div className="screen__body">
        <header className="brand">
          <ShieldLogo size={48} />
          <h1 className="brand__name">{copy.app_name}</h1>
          <p className="brand__tagline">{copy.app_tagline}</p>
        </header>

        <nav className="home-actions" aria-label="What would you like to do?">
          <button type="button" className="choice" onClick={onCheck}>
            <span className="choice__icon" aria-hidden="true">
              <IconMessageSquare size={24} strokeWidth={2} />
            </span>
            <span className="choice__body">
              <span className="choice__title">{copy.home_check_title}</span>
              <span className="choice__sub">{copy.home_check_sub}</span>
            </span>
            <IconChevronRight size={20} className="choice__go" aria-hidden="true" />
          </button>

          <button type="button" className="choice" onClick={onListen}>
            <span className="choice__icon choice__icon--safe" aria-hidden="true">
              <IconMic size={24} strokeWidth={2} />
            </span>
            <span className="choice__body">
              <span className="choice__title">{copy.home_listen_title}</span>
              <span className="choice__sub">{copy.home_listen_sub}</span>
            </span>
            <IconChevronRight size={20} className="choice__go" aria-hidden="true" />
          </button>
        </nav>

        <div className="privacy-line">
          <span className="privacy-line__icon" aria-hidden="true">
            <IconLock size={18} />
          </span>
          <p className="privacy-line__text">{copy.home_privacy}</p>
        </div>
      </div>
    </main>
  )
}
