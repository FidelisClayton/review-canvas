import { useEffect, useRef } from "react";
import { useCourse } from "./ctx";
import { EmptyGoalNode, FileFrame, GapNode, StartSheet } from "./CoursePage";
import { base, dir, framesOf, type CourseGoal } from "./model";
import "./diff.css";

interface DiffColumnProps {
  goal: CourseGoal | null;
  /** Index into `idx.goals`; -1 is the start sheet. */
  g: number;
  stop: number;
  onGoal: (g: number) => void;
  onStop: (s: number) => void;
  onGoalBadge: (goalId: string, hunkId: string) => void;
  onMap: () => void;
  /** A file row was clicked: the index of that file's first stop. */
  onFileClick: (si: number) => void;
}

export function DiffColumn({ goal, g, stop, onGoal, onStop, onGoalBadge, onMap, onFileClick }: DiffColumnProps) {
  const c = useCourse();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    // Scroll only the nav: scrollIntoView would also move the diff viewport.
    const n = nav.current;
    const row = n?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!n || !row) return;
    if (row.offsetTop < n.scrollTop) n.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > n.scrollTop + n.clientHeight) n.scrollTop = row.offsetTop + row.offsetHeight - n.clientHeight;
  }, [stop, g]);
  if (g < 0 || !goal) return <StartSheet onGoal={onGoal} onMap={onMap} />;
  const frames = framesOf(goal, c.view);
  return (
    <div className={`diffcol${frames.length ? " hasnav" : ""}`}>
      {frames.length > 0 && (
        <nav ref={nav} aria-label="Files in this goal">
          {frames.map((fr) => {
            const path = c.view.files.get(fr.fileId)!.path;
            const nums = fr.stops.map((s) => s.si + 1);
            const cur = fr.stops.some((s) => s.si === stop);
            return (
              <button key={fr.fileId} className="frow" aria-current={cur ? "true" : undefined} onClick={() => onFileClick(fr.stops[0]!.si)}>
                <span className="path">
                  <span className="dir">{dir(path)}</span>
                  <b>{base(path)}</b>
                </span>
                <span className="nums">{nums.join(", ")}</span>
              </button>
            );
          })}
        </nav>
      )}
      <div className="frames">
        {!goal.stops.length && <EmptyGoalNode unclaimed={goal.unclaimed} />}
        {frames.map((fr, fi) => (
          <FileFrame key={fr.fileId} frame={fr} fi={fi} goal={goal} g={g} stop={stop} onStop={onStop} onGoalBadge={onGoalBadge} />
        ))}
        {goal.gap && <GapNode gap={goal.gap} />}
      </div>
    </div>
  );
}
