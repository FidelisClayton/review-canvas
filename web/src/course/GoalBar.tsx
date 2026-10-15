import { isRead, type PrFile, type ReviewState } from "@review-canvas/shared";
import { base, dir, needsMark, type CourseGoal } from "./model";

interface GoalBarProps {
  goal: CourseGoal;
  /** Index among the real goals; the unclaimed stop has none. */
  gi: number;
  realCount: number;
  state: ReviewState;
  /** On-course files with no chunk to show, listed on the unclaimed stop. */
  chunkless: PrFile[];
  onToggleReviewed: () => void;
  onOpenFile: (fileId: string) => void;
}

export function GoalBar({ goal, gi, realCount, state, chunkless, onToggleReviewed, onOpenFile }: GoalBarProps) {
  const read = goal.stops.filter((s) => isRead(state, s)).length;
  const reviewed = !!state.reviewed[goal.id];
  const empty = goal.stops.length === 0;
  return (
    <div className="goalbar">
      <div className="gb-top">
        <div className="gb-title">
          <span className="k">{goal.unclaimed ? "Last stop" : `Goal ${gi + 1} of ${realCount} · ${goal.src}`}</span>
          <h2>{goal.title}</h2>
          {goal.unclaimed ? (
            <p className="quote">{empty ? "Every changed chunk serves a goal." : "Changed code that no goal cites. Unasked-for changes are where surprises hide."}</p>
          ) : (
            goal.quote && (
              <p className="quote">
                <b>{goal.src} says</b>
                {goal.quote}
              </p>
            )
          )}
          {goal.gap && <p className="gapline">{goal.gap}</p>}
          {goal.unclaimed && chunkless.length > 0 && (
            <ul className="chunkless">
              {chunkless.map((f) => (
                <li key={f.id}>
                  <span className="fname">
                    <span className="dir">{dir(f.path)}</span>
                    <b>{base(f.path)}</b>
                  </span>
                  <span className="why">{f.status === "renamed" ? "renamed, no lines changed" : "no diff to show"}</span>
                  <button className="fbtn" onClick={() => onOpenFile(f.id)}>
                    Open file
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {needsMark(goal) && (
          <div className="ask">
            <button className={`btn mark${reviewed ? " on" : ""}`} aria-pressed={reviewed} onClick={onToggleReviewed}>
              {reviewed ? "Reviewed" : "Mark reviewed"} <kbd>X</kbd>
            </button>
            <small>{empty ? "No stops" : read === goal.stops.length ? `All ${goal.stops.length} stops read` : `${goal.stops.length - read} of ${goal.stops.length} stops unread`}</small>
          </div>
        )}
      </div>
    </div>
  );
}
