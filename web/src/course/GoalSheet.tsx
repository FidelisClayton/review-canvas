import { isRead, type ReviewState, type ReviewView } from "@review-canvas/shared";
import { goalLabel, needsMark, stopLabel, totals, type CourseGoal, type CourseIndex } from "./model";

interface GoalSheetProps {
  open: boolean;
  idx: CourseIndex;
  view: ReviewView;
  state: ReviewState;
  guided: boolean;
  /** -1 is the start sheet. */
  g: number;
  s: number;
  onGoal: (g: number) => void;
  onStop: (s: number) => void;
  onOob: () => void;
}

const Triangle = () => (
  <svg viewBox="-16 -16 32 32">
    <path d="M0-12L11 8H-11Z" fill="none" stroke="#7b2cbf" strokeWidth="2.4" />
  </svg>
);

function Sym({ goal, gi, current }: { goal: CourseGoal; gi: number; current: boolean }) {
  if (goal.unclaimed)
    return (
      <svg viewBox="-16 -16 32 32">
        <rect x="-11" y="-11" width="22" height="22" fill="none" stroke="#1e1b22" strokeWidth="2" strokeDasharray="4 3" />
      </svg>
    );
  return (
    <svg viewBox="-16 -16 32 32">
      <circle r="13" fill="#fff" stroke="#7b2cbf" strokeWidth={current ? 4 : 2.4} />
      <text y="7" textAnchor="middle" className="row-num" fontSize="19" fill="#7b2cbf">
        {gi + 1}
      </text>
    </svg>
  );
}

export function GoalSheet({ open, idx, view, state, guided, g, s, onGoal, onStop, onOob }: GoalSheetProps) {
  const t = totals(idx, state);
  const sources = [...new Set(idx.goals.filter((x) => !x.unclaimed).map((x) => x.src))].filter(Boolean);
  return (
    <aside className={`course${open ? " open" : ""}`} id="course" aria-label="Course">
      <div className="course-head">
        <h2>
          Course{" "}
          <span>
            {t.goalsDone}/{t.goalsTotal}
          </span>
        </h2>
        <p>
          {idx.realCount} goal{idx.realCount === 1 ? "" : "s"} and the unclaimed changes · {t.stopsRead} of {t.stopsTotal} stops read
        </p>
      </div>
      <ul className="glist">
        <li className={guided && g === -1 ? "cur" : ""}>
          <button className="grow" onClick={() => onGoal(-1)}>
            <span className="sym">
              <Triangle />
            </span>
            <span className="gname">
              <b>Start</b>
              <small>The PR in one sentence and its goals</small>
            </span>
            <span />
          </button>
        </li>
        {idx.goals.map((goal, gi) => {
          const cur = guided && g === gi;
          const tests = goal.stops.filter((x) => x.test).length;
          const read = goal.stops.filter((x) => isRead(state, x)).length;
          const marked = !!state.reviewed[goal.id];
          return (
            <li key={goal.id} className={cur ? "cur" : ""}>
              <button className="grow" onClick={() => onGoal(gi)} aria-current={cur ? "step" : undefined}>
                <span className="sym">
                  <Sym goal={goal} gi={gi} current={cur} />
                </span>
                <span className="gname">
                  <b>{goal.title}</b>
                  <small>
                    {goal.unclaimed ? (
                      goal.stops.length ? `${goal.stops.length} chunk${goal.stops.length === 1 ? "" : "s"} nobody asked for · ${read}/${goal.stops.length} read` : "No changes outside the goals"
                    ) : (
                      <>
                        <span className="src">{goal.src}</span> · {goal.stops.length - tests} code · {tests} tests · {read}/{goal.stops.length} read
                        {goal.gap && (
                          <>
                            {" · "}
                            <span className="warn">test gap</span>
                          </>
                        )}
                      </>
                    )}
                  </small>
                </span>
                {needsMark(goal) ? <span className={`ans${marked ? " yes" : ""}`}>{marked ? "✓" : ""}</span> : <span />}
              </button>
              {cur && (
                <ol className="stops">
                  {goal.stops.map((stop, si) => {
                    const l = stopLabel(stop, view);
                    return (
                      <li key={si}>
                        {stop.test && (si === 0 || !goal.stops[si - 1]!.test) && <div className="sec">Tests</div>}
                        <button className={si === s ? "on" : ""} onClick={() => onStop(si)}>
                          <span className="n">{si + 1}</span>
                          <span className="f">
                            <b>{l.title}</b>
                            <small>{l.sub}</small>
                          </span>
                          <span className={`r${isRead(state, stop) ? " done" : ""}`} />
                        </button>
                      </li>
                    );
                  })}
                  {goal.gap && (
                    <li className="gap">
                      <i />
                      <span>{goal.gap}</span>
                    </li>
                  )}
                </ol>
              )}
            </li>
          );
        })}
        {view.oob.length > 0 && (
          <li>
            <button className="grow oob" onClick={onOob}>
              <span className="sym">
                <svg viewBox="-16 -16 32 32">
                  <rect x="-11" y="-11" width="22" height="22" fill="#fff" stroke="#7b2cbf" strokeWidth="1.6" strokeDasharray="3 3" />
                </svg>
              </span>
              <span className="gname">
                <b>Out of bounds: {view.oob.length} file{view.oob.length === 1 ? "" : "s"}</b>
                <small>Generated output and API clients, never stops</small>
              </span>
              <span />
            </button>
          </li>
        )}
      </ul>
      <div className="course-foot">{sources.length ? `Goals from ${sources.join(", ")}.` : "No goals yet."}</div>
    </aside>
  );
}
