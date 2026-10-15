import { LAYERS, LAYER_INFO, type LayerId, type PrFile } from "@review-canvas/shared";
import type { ReactNode, RefObject } from "react";
import { useCourse } from "./ctx";
import { base, dir, framesOf, goalLabel, UNCLAIMED_TITLE, type CourseGoal, type Frame } from "./model";
import { RouteLayer } from "./RouteLayer";
import { StopView } from "./StopView";

interface CoursePageProps {
  worldRef: RefObject<HTMLElement | null>;
  goal: CourseGoal | null;
  /** Index into `idx.goals`; -1 is the start sheet. */
  g: number;
  stop: number;
  far: boolean;
  onGoal: (g: number, hunkId?: string) => void;
  onStop: (s: number) => void;
  onGoalBadge: (goalId: string, hunkId: string) => void;
  onMap: () => void;
  /** A frame was clicked while zoomed out. */
  onFarClick: (frame: HTMLElement, firstStop: number | null) => void;
}

const Delta = ({ f }: { f: PrFile }) => (
  <span className="delta">
    <span className="a">+{f.additions}</span>
    <span className="d">−{f.deletions}</span>
  </span>
);

function Bands({ byBand }: { byBand: Record<LayerId, ReactNode[]> }) {
  return (
    <>
      {LAYERS.filter((l) => byBand[l].length).map((l) => (
        <section className="band" data-layer={l} key={l}>
          <div className="bandlab">
            <b>{LAYER_INFO[l].name}</b>
            <small>{LAYER_INFO[l].sub}</small>
          </div>
          <div className="brow">{byBand[l]}</div>
        </section>
      ))}
    </>
  );
}

const emptyBands = () => Object.fromEntries(LAYERS.map((l) => [l, [] as ReactNode[]])) as Record<LayerId, ReactNode[]>;

export function CoursePage(p: CoursePageProps) {
  const c = useCourse();
  if (p.g < 0 || !p.goal) return <StartSheet onGoal={p.onGoal} onMap={p.onMap} />;
  const goal = p.goal;
  const frames = framesOf(goal, c.view);
  const inGoal = new Set(frames.map((f) => f.fileId));
  const byBand = emptyBands();
  frames.forEach((fr, fi) => byBand[c.view.files.get(fr.fileId)!.layer].push(<FileFrame key={fr.fileId} {...p} frame={fr} fi={fi} goal={goal} />));
  if (goal.gap) {
    const last = frames[frames.length - 1];
    const layer = last ? c.view.files.get(last.fileId)!.layer : "other";
    byBand[layer].push(
      <div className="node gapnode" key="gap">
        <b>Missing test</b>
        {goal.gap}
      </div>,
    );
  }
  if (!goal.stops.length)
    byBand.other.unshift(
      <div className="node gapnode" key="none">
        <b>{goal.unclaimed ? "No changes outside the goals" : "No changed code serves this goal"}</b>
        {goal.unclaimed ? "Every changed chunk serves a goal." : "Nothing in this PR shows the goal was met."}
      </div>,
    );
  // Files other goals use, faded: a click goes to the first goal that uses them.
  for (const f of c.review.analysis.files) {
    const gs = c.idx.ofFile.get(f.id);
    if (gs && !inGoal.has(f.id) && f.noise !== "tests") byBand[f.layer].push(<Tile key={f.id} file={f} gs={gs} onGoal={p.onGoal} />);
  }
  return (
    <div
      onClick={(e) => {
        // Zoomed out, a click on a frame zooms back in on it.
        const node = (e.target as HTMLElement).closest<HTMLElement>(".node");
        if (p.far && node && !(e.target as HTMLElement).closest("[data-goto],.fbtn")) p.onFarClick(node, node.dataset.first === undefined ? null : Number(node.dataset.first));
      }}
    >
      <Bands byBand={byBand} />
      <RouteLayer worldRef={p.worldRef} stop={p.stop} scope={`${p.g}`} />
    </div>
  );
}

function FileFrame({ frame, fi, goal, g, stop, onStop, onGoalBadge }: { frame: Frame; fi: number; goal: CourseGoal } & CoursePageProps) {
  const c = useCourse();
  const f = c.view.files.get(frame.fileId)!;
  const nums = frame.stops.map((s) => s.si + 1);
  const hasCur = frame.stops.some((s) => s.si === stop);
  return (
    <article className={`node${goal.unclaimed ? " unclaimed" : ""}${hasCur ? " hasCur" : ""}`} data-fi={fi} data-first={frame.stops[0]!.si}>
      <header className="tb">
        <span className="ctl">{nums.length > 1 ? `${nums[0]}–${nums[nums.length - 1]}` : nums[0]}</span>
        <span className="fname">
          <span className="dir">{dir(f.path)}</span>
          <b>{base(f.path)}</b>
        </span>
        {f.noise === "tests" && <span className="tag">Test</span>}
        <button className="fbtn" title="Open the whole file in the side drawer" onClick={() => c.openFile(f.id)}>
          Open file
        </button>
        <Delta f={f} />
      </header>
      {f.hunks.map((h) => {
        const mine = frame.stops.filter((s) => s.stop.hunkId === h.id);
        if (mine.length)
          return mine.map(({ stop: s, si }) => <StopView key={`${h.id}:${si}`} stop={s} mode="stop" number={si + 1} current={g >= 0 && si === stop} onGoalBadge={onGoalBadge} onSelect={() => si !== stop && onStop(si)} />);
        const gs = c.idx.ofHunk.get(h.id) ?? [];
        return (
          <button key={h.id} className="fold" data-goto={gs[0] ?? ""} disabled={!gs.length} onClick={() => gs.length && onGoalBadge(c.idx.goals[gs[0]!]!.id, h.id)}>
            <code>{h.range}</code>
            <span>{gs.length ? (gs.every((x) => c.idx.goals[x]!.unclaimed) ? UNCLAIMED_TITLE : `goal ${gs.map((x) => goalLabel(c.idx.goals[x]!, x)).join(", ")}`) : "not on this course"}</span>
          </button>
        );
      })}
    </article>
  );
}

function Tile({ file, gs, onGoal }: { file: PrFile; gs: number[]; onGoal: (g: number) => void }) {
  const c = useCourse();
  return (
    <button className={`tile${gs.every((x) => c.idx.goals[x]!.unclaimed) ? " unclaimed" : ""}`} data-goto={gs[0]} title={`Review goal ${goalLabel(c.idx.goals[gs[0]!]!, gs[0]!)}`} onClick={() => onGoal(gs[0]!)}>
      <b>{base(file.path)}</b>
      <small>{dir(file.path)}</small>
      <span className="gs">
        {gs.map((x) => (
          <span key={x} className={`gn${c.idx.goals[x]!.unclaimed ? " u" : ""}`}>
            {goalLabel(c.idx.goals[x]!, x)}
          </span>
        ))}
      </span>
    </button>
  );
}

function StartSheet({ onGoal, onMap }: { onGoal: (g: number) => void; onMap: () => void }) {
  const c = useCourse();
  const { pr } = c.review.analysis;
  return (
    <div className="startsheet">
      <header>
        <svg viewBox="-16 -16 32 32" aria-hidden="true">
          <path d="M0-12L11 8H-11Z" fill="none" stroke="#7b2cbf" strokeWidth="2.4" />
        </svg>
        <h2>Start</h2>
      </header>
      <p className="lead">{c.review.course.sentence || pr.title}</p>
      <ol>
        {c.idx.goals.map((goal, gi) => (
          <li key={goal.id}>
            <span className={`gn${goal.unclaimed ? " u" : ""}`}>{goalLabel(goal, gi)}</span>
            <button className="linkish" onClick={() => onGoal(gi)}>
              {goal.title}
            </button>
            <small>
              {goal.unclaimed ? `${goal.stops.length} chunk${goal.stops.length === 1 ? "" : "s"}` : `${goal.src} · ${goal.stops.length} stop${goal.stops.length === 1 ? "" : "s"}`}
              {c.state.reviewed[goal.id] ? " · reviewed" : ""}
            </small>
          </li>
        ))}
      </ol>
      {c.view.oob.length > 0 && <p className="oob">Out of bounds, not on the course: {c.view.oob.length} generated files and API clients.</p>}
      <footer>
        <button className="btn" onClick={onMap}>
          Open the map
        </button>
        <button className="btn primary" onClick={() => onGoal(0)}>
          Start goal 1
        </button>
      </footer>
    </div>
  );
}
