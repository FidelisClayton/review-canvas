import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildView, type Draft, type Review, type ReviewState, type Verdict } from "@review-canvas/shared";
import { fetchReview, saveState, submitReview } from "./api";
import { ChunkDrawer } from "./course/ChunkDrawer";
import { CoursePage } from "./course/CoursePage";
import { CourseContext, type ComposerState, type CourseCtx } from "./course/ctx";
import { FileDrawer } from "./course/FileDrawer";
import { GoalBar } from "./course/GoalBar";
import { GoalSheet } from "./course/GoalSheet";
import { keyAction, type KeyAction } from "./course/keys";
import { MapView } from "./course/MapView";
import { buildIndex, chunklessFiles, findStopFor, needsMark } from "./course/model";
import { step } from "./course/nav";
import { posIn } from "./course/RouteLayer";
import { useReadObserver } from "./course/useReadObserver";
import { useZoom } from "./course/useZoom";
import { ReviewDrawer, TopBar } from "./panels";

type Mode = "guided" | "map";
type DrawerTarget = { kind: "chunk"; hunkId: string; symbols: string[] } | { kind: "file"; fileId: string };

export function ReviewScreen({ id }: { id: string }) {
  const [data, setData] = useState<{ review: Review; state: ReviewState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchReview(id).then(setData, (e: Error) => setError(e.message));
  }, [id]);
  if (error)
    return (
      <div className="screen-msg">
        <h1>Can't open this review</h1>
        <p>{error}</p>
        <a href="/">All reviews</a>
      </div>
    );
  if (!data) return <div className="screen-msg">Loading the review…</div>;
  // An old file-based course cannot be shown as goals: ask for a republish before anything else.
  if (data.review.outdated)
    return (
      <div className="screen-msg">
        <h1>Republish this review</h1>
        <p>
          This review was published in the old file-by-file format. Ask your agent to plan it again with the <code>review-canvas</code> skill, which now writes goals and the chunks that prove them.
        </p>
        <a href="/">All reviews</a>
      </div>
    );
  return <LoadedReview review={data.review} initial={data.state} />;
}

function LoadedReview({ review, initial }: { review: Review; initial: ReviewState }) {
  const [state, setState] = useState(initial);
  const view = useMemo(() => buildView(review), [review]);
  const idx = useMemo(() => buildIndex(review, view), [review, view]);
  const hasGoals = review.course.goals.length > 0;

  const [mode, setMode] = useState<Mode>(hasGoals ? "guided" : "map");
  // Open on the first goal not yet marked reviewed once the reviewer has begun, otherwise on the start sheet.
  const [g, setG] = useState(() => {
    const begun = Object.keys(initial.reviewed).length > 0 || Object.keys(initial.read).length > 0;
    const next = idx.goals.findIndex((x) => needsMark(x) && !initial.reviewed[x.id]);
    return hasGoals && begun ? next : -1;
  });
  const [s, setS] = useState(0);
  const [focusing, setFocusing] = useState(false);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [courseOpen, setCourseOpen] = useState(false);
  const [focusOob, setFocusOob] = useState(false);
  const [reveal, setReveal] = useState<{ hunkId: string; n: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const say = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const vpRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoom = useZoom(vpRef, worldRef);

  // Guided and Map start at reading size.
  const { setZoom } = zoom;
  useEffect(() => setZoom(1), [mode, setZoom]);

  // Save after every change, debounced. `submitted` is server-owned and never sent.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => saveState(review.analysis.id, state).catch((e: Error) => say(`Not saved: ${e.message}`)), 400);
    return () => clearTimeout(t);
  }, [state, review.analysis.id, say]);

  const live = useRef({ state, g, s, mode, composer, drawer, reviewOpen, far: zoom.far, zoom: zoom.zoom });
  live.current = { state, g, s, mode, composer, drawer, reviewOpen, far: zoom.far, zoom: zoom.zoom };

  // ---- scrolling: exact offsets, because scrollIntoView lands short while a smooth scroll runs ----
  const [scrollReq, setScrollReq] = useState<{ n: number; smooth: boolean; hunkId?: string; lineIndex?: number } | null>(null);
  const requestScroll = useCallback((smooth: boolean, hunkId?: string, lineIndex?: number) =>
      setScrollReq((r) => ({ n: (r?.n ?? 0) + 1, smooth, ...(hunkId ? { hunkId } : {}), ...(lineIndex !== undefined ? { lineIndex } : {}) })),
    [],
  );
  useEffect(() => {
    if (!scrollReq) return;
    const frame = requestAnimationFrame(() => {
      const vp = vpRef.current;
      const world = worldRef.current;
      if (!vp || !world) return;
      const { g, s, mode } = live.current;
      // Read the zoom off the element: a view switch resets it in the same tick, before state catches up.
      const z = Number(world.style.zoom) || 1;
      const behavior = scrollReq.smooth ? "smooth" : "auto";
      let target: HTMLElement | null = null;
      if (scrollReq.hunkId)
        target =
          (scrollReq.lineIndex !== undefined && world.querySelector<HTMLElement>(`.ln[data-h="${scrollReq.hunkId}"][data-i="${scrollReq.lineIndex}"]`)) ||
          world.querySelector<HTMLElement>(`.stop[data-hunk="${scrollReq.hunkId}"]`);
      else if (mode === "guided" && g >= 0) {
        const st = world.querySelector<HTMLElement>(`.stop[data-si="${s}"]`);
        const node = st?.closest<HTMLElement>(".node");
        // The first stop in a file brings the file header into view too.
        target = node && node.querySelector(".stop") === st ? node : st ?? null;
      }
      if (!target) return void vp.scrollTo({ top: 0, left: 0, behavior });
      const p = posIn(target, world);
      vp.scrollTo({ top: p.y * z - 24, left: Math.max(0, p.x * z - 200), behavior });
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollReq]);

  // ---- navigation ----
  const go = useCallback(
    (gi: number, hunkId?: string) => {
      const goals = idx.goals;
      const ng = Math.max(-1, Math.min(goals.length - 1, gi));
      const si = hunkId && ng >= 0 ? goals[ng]!.stops.findIndex((x) => x.hunkId === hunkId) : -1;
      setMode("guided");
      setG(ng);
      setS(Math.max(0, si));
      setCourseOpen(false);
      requestScroll(false);
    },
    [idx, requestScroll],
  );
  const goToGoalId = useCallback(
    (goalId: string, hunkId: string) => {
      setDrawer(null);
      go(
        idx.goals.findIndex((x) => x.id === goalId),
        hunkId,
      );
    },
    [idx, go],
  );
  const goStop = useCallback(
    (si: number, opts: { scroll?: boolean; smooth?: boolean } = {}) => {
      setS(si);
      if (opts.scroll !== false) requestScroll(opts.smooth ?? false);
    },
    [requestScroll],
  );
  const switchMode = useCallback(
    (m: Mode) => {
      if (m === "guided" && !hasGoals) return;
      setMode(m);
      setFocusing(false);
      requestScroll(false);
    },
    [hasGoals, requestScroll],
  );
  const toggleReviewed = useCallback(() => {
    const { g, mode, state } = live.current;
    const goal = idx.goals[g];
    if (mode !== "guided" || !goal || !needsMark(goal)) return;
    setState((st) => {
      const { [goal.id]: was, ...rest } = st.reviewed;
      return { ...st, reviewed: was ? rest : { ...rest, [goal.id]: new Date().toISOString() } };
    });
    say(state.reviewed[goal.id] ? "Mark removed" : "Marked reviewed. ] for the next goal");
  }, [idx, say]);

  const move = useCallback(
    (dir: 1 | -1) => {
      const { g, s, mode } = live.current;
      if (mode !== "guided") return;
      setFocusing(true);
      const r = step(
        idx.goals.map((x) => x.stops.length),
        { g, s },
        dir,
      );
      if (r.edge) {
        if (dir === 1 && g >= 0) say(g === idx.goals.length - 1 ? "End of the course. Open Review to post." : "Last stop of this goal. X marks it reviewed, ] goes to the next goal.");
        return;
      }
      setG(r.pos.g);
      goStop(r.pos.s, { smooth: r.pos.g === g });
    },
    [idx, say, goStop],
  );

  const act = useCallback(
    (a: KeyAction) => {
      switch (a) {
        case "next-stop":
          return move(1);
        case "prev-stop":
          return move(-1);
        case "next-goal":
          return go(live.current.g + 1);
        case "prev-goal":
          return go(live.current.g - 1);
        case "toggle-reviewed":
          return toggleReviewed();
        case "toggle-overview":
          return zoom.toggleOverview();
        case "map-view":
          return switchMode("map");
        case "guided-view":
          return switchMode("guided");
        case "close-drawer":
          return setDrawer(null);
        case "close-review":
          return setReviewOpen(false);
        case "close-composer":
          return setComposer(null);
        case "clear-focus":
          return setFocusing(false);
      }
    },
    [move, go, toggleReviewed, switchMode, zoom],
  );
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { drawer, reviewOpen, composer } = live.current;
      const a = keyAction(e, { drawer: !!drawer, review: reviewOpen, composer: !!composer });
      if (!a) return;
      e.preventDefault();
      actRef.current(a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- reading ----
  useReadObserver({
    scrollerRef: vpRef,
    worldRef,
    far: zoom.far,
    scope: `${mode}:${g}`,
    isRead: (key) => !!live.current.state.read[key] || !!live.current.state.read[key.split("@")[0]!],
    onRead: (keys) => {
      const at = new Date().toISOString();
      setState((st) => {
        const fresh = keys.filter((k) => !st.read[k]);
        return fresh.length ? { ...st, read: { ...st.read, ...Object.fromEntries(fresh.map((k) => [k, at])) } } : st;
      });
    },
  });

  // ---- drafts ----
  const addDraft = useCallback(
    (hunkId: string, lineIndex: number, body: string) => {
      const f = view.hunkFile.get(hunkId)!;
      const line = f.hunks.find((h) => h.id === hunkId)!.lines[lineIndex]!;
      const draft: Draft = {
        id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        hunkId,
        lineIndex,
        path: f.path,
        // GitHub anchors comments to the head side, except on deleted lines.
        line: line.kind === "del" ? line.oldNo! : line.newNo!,
        side: line.kind === "del" ? "LEFT" : "RIGHT",
        body,
        createdAt: new Date().toISOString(),
      };
      setState((st) => ({ ...st, drafts: [...st.drafts, draft] }));
    },
    [view],
  );

  const ctx = useMemo<CourseCtx>(
    () => ({
      review,
      view,
      idx,
      state,
      composer,
      openComposer: (hunkId, lineIndex) => setComposer((c) => (c && c.hunkId === hunkId && c.lineIndex === lineIndex ? c : { hunkId, lineIndex, text: "" })),
      setComposerText: (text) => setComposer((c) => (c ? { ...c, text } : c)),
      closeComposer: () => setComposer(null),
      addDraft,
      deleteDraft: (id) => setState((st) => ({ ...st, drafts: st.drafts.filter((d) => d.id !== id) })),
      drawerHunk: drawer?.kind === "chunk" ? drawer.hunkId : null,
      openChunk: (hunkId, symbols) => setDrawer((d) => (d?.kind === "chunk" && d.hunkId === hunkId ? null : { kind: "chunk", hunkId, symbols })),
      openFile: (fileId) => setDrawer((d) => (d?.kind === "file" && d.fileId === fileId ? null : { kind: "file", fileId })),
    }),
    [review, view, idx, state, composer, addDraft, drawer],
  );

  const goDraft = (hunkId: string, lineIndex: number) => {
    setReviewOpen(false);
    const at = hasGoals ? findStopFor(idx, hunkId, lineIndex) : null;
    if (at) {
      setMode("guided");
      setG(at.g);
      setS(at.s);
      requestScroll(false);
    } else {
      setMode("map");
      setReveal((r) => ({ hunkId, n: (r?.n ?? 0) + 1 }));
      requestScroll(false, hunkId, lineIndex);
    }
  };

  const submit = async () => {
    const res = await submitReview(review.analysis.id, state.verdict, state.summary);
    setState((st) => ({ ...st, submitted: res.submitted }));
  };

  const goal = g >= 0 ? idx.goals[g] ?? null : null;
  const chunkless = useMemo(() => chunklessFiles(review), [review]);
  const pct = Math.round(zoom.zoom * 100);

  return (
    <CourseContext.Provider value={ctx}>
      <div className="app">
        <TopBar review={review} drafts={state.drafts.length} mode={mode} onMode={switchMode} onReview={() => setReviewOpen((o) => !o)} onCourse={() => setCourseOpen((o) => !o)} courseOpen={courseOpen} />
        <GoalSheet
          open={courseOpen}
          idx={idx}
          view={view}
          state={state}
          guided={mode === "guided"}
          g={g}
          s={s}
          onGoal={(gi) => go(gi)}
          onStop={(si) => goStop(si, { smooth: true })}
          onOob={() => {
            setCourseOpen(false);
            setMode("map");
            setFocusOob(true);
            setTimeout(() => setFocusOob(false), 800);
          }}
        />
        <div className={`stage${focusing ? " focusing" : ""}${mode === "map" ? " map" : ""}`}>
          {mode === "map" ? (
            <div className="mapbar">
              <b>Map</b>
              {hasGoals ? "Every changed file on its layer, every chunk open. The numbers on each chunk are the goals it serves; click one to review that goal." : "Every changed file on its layer, every chunk open. No agent has planned goals for this PR yet."}
            </div>
          ) : (
            goal && (
              <GoalBar
                goal={goal}
                gi={g}
                realCount={idx.realCount}
                state={state}
                chunkless={chunkless}
                onToggleReviewed={toggleReviewed}
                onOpenFile={ctx.openFile}
              />
            )
          )}
          <div
            className="viewport"
            ref={vpRef}
            onPointerDown={() => focusing && setFocusing(false)}
            onWheel={(e) => focusing && !e.ctrlKey && Math.abs(e.deltaY) > 40 && setFocusing(false)}
          >
            <div className={`world${zoom.far ? " far" : ""}`} ref={worldRef}>
              {mode === "map" ? (
                <MapView focusOob={focusOob} onGoalBadge={goToGoalId} far={zoom.far} onFarClick={zoom.zoomToElement} reveal={reveal} />
              ) : (
                <CoursePage
                  worldRef={worldRef}
                  goal={goal}
                  g={g}
                  stop={s}
                  far={zoom.far}
                  onGoal={go}
                  onStop={(si) => goStop(si, { scroll: false })}
                  onGoalBadge={goToGoalId}
                  onMap={() => switchMode("map")}
                  onFarClick={(frame, firstStop) => {
                    zoom.zoomToElement(frame);
                    if (firstStop !== null) goStop(firstStop);
                  }}
                />
              )}
            </div>
          </div>
          {drawer?.kind === "chunk" && <ChunkDrawer hunkId={drawer.hunkId} symbols={drawer.symbols} onClose={() => setDrawer(null)} onGoToGoal={goToGoalId} />}
          {drawer?.kind === "file" && <FileDrawer fileId={drawer.fileId} onClose={() => setDrawer(null)} />}
          <KeysBar mode={mode} />
          <button className="btn zoom-btn" onClick={zoom.toggleOverview}>
            {pct}% · {zoom.far ? "Back to reading" : mode === "map" ? "Zoom out" : "Whole course"}
          </button>
          <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
            {toast}
          </div>
          <ReviewDrawer
            open={reviewOpen}
            review={review}
            idx={idx}
            state={state}
            onClose={() => setReviewOpen(false)}
            onVerdict={(v: Verdict) => setState((st) => ({ ...st, verdict: v }))}
            onSummary={(summary) => setState((st) => ({ ...st, summary }))}
            onGoDraft={goDraft}
            onSubmit={submit}
          />
        </div>
      </div>
    </CourseContext.Provider>
  );
}

function KeysBar({ mode }: { mode: Mode }) {
  return (
    <div className="keys" aria-hidden="true">
      {mode === "guided" ? (
        <>
          <span>
            <kbd>J</kbd>
            <kbd>K</kbd>next / previous stop
          </span>
          <span>
            <kbd>]</kbd>
            <kbd>[</kbd>goal
          </span>
          <span>
            <kbd>X</kbd>mark reviewed
          </span>
          <span>
            <kbd>F</kbd>whole course
          </span>
          <span>
            <kbd>M</kbd>map
          </span>
        </>
      ) : (
        <>
          <span>
            <kbd>F</kbd>zoom out
          </span>
          <span>
            <kbd>G</kbd>guided
          </span>
          <span>
            <kbd>Esc</kbd>close
          </span>
        </>
      )}
    </div>
  );
}
