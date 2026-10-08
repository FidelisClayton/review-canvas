import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildView, FILTER_RULES, type Draft, type Filters, type Review, type ReviewState, type Verdict } from "@review-canvas/shared";
import { fetchReview, saveState, submitReview } from "./api";
import { Canvas, type CanvasHandle } from "./canvas/Canvas";
import { CoursePanel, KeysBar, Legend, ReviewDrawer, TopBar } from "./panels";
import { Pins } from "./pins";

const FILTERS_KEY = "review-canvas.filters";
const defaultFilters = (): Filters => Object.fromEntries(FILTER_RULES.map((r) => [r.id, r.defaultOn])) as Filters;

function useFilters(): [Filters, (id: keyof Filters, on: boolean) => void] {
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      return { ...defaultFilters(), ...(JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}") as Partial<Filters>) };
    } catch {
      return defaultFilters();
    }
  });
  const set = useCallback((id: keyof Filters, on: boolean) => {
    setFilters((f) => {
      const next = { ...f, [id]: on };
      try {
        localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
      } catch {
        /* private mode: the filter still applies for this visit */
      }
      return next;
    });
  }, []);
  return [filters, set];
}

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
  return <LoadedReview review={data.review} initial={data.state} />;
}

function LoadedReview({ review, initial }: { review: Review; initial: ReviewState }) {
  const [state, setState] = useState(initial);
  const [filters, setFilter] = useFilters();
  const view = useMemo(() => buildView(review, filters), [review, filters]);
  const [current, setCurrent] = useState<string | null>(() => view.order.find((id) => !initial.punched[id]) ?? view.order[0] ?? null);
  const currentSince = useRef(Date.now());
  const canvas = useRef<CanvasHandle>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [courseOpen, setCourseOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; pins?: string } | null>(null);
  const toastTimer = useRef(0);
  const say = useCallback((text: string, pins?: string) => {
    setToast(pins ? { text, pins } : { text });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

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

  // A filter that hides the current file moves you to the next visible one.
  useEffect(() => {
    if (current && !view.order.includes(current)) setCurrent(view.order.find((id) => !state.punched[id]) ?? view.order[0] ?? null);
  }, [view, current, state.punched]);

  const live = useRef({ view, state, current });
  live.current = { view, state, current };

  const select = useCallback((id: string, fly = true) => {
    setCurrent((prev) => {
      if (prev !== id) currentSince.current = Date.now();
      return id;
    });
    setCourseOpen(false);
    if (fly) canvas.current?.goFile(id);
  }, []);

  const punch = useCallback(
    (id: string) => {
      const { view, state, current } = live.current;
      if (state.punched[id]) {
        setState((s) => {
          const { [id]: _removed, ...rest } = s.punched;
          return { ...s, punched: rest };
        });
        return;
      }
      const splitMs = id === current ? Date.now() - currentSince.current : null;
      setState((s) => ({ ...s, punched: { ...s.punched, [id]: { at: new Date().toISOString(), splitMs } } }));
      const f = view.files.get(id)!;
      say(`Punched ${view.ctl[id]}${view.sub[id] ? ` ${view.sub[id]}` : ""} · ${f.path.split("/").pop()}`, view.ctl[id]);
      if (id === current) {
        const next = view.order.find((o, i) => i > view.order.indexOf(id) && !state.punched[o]);
        if (next) setTimeout(() => select(next), 260);
        else setTimeout(() => canvas.current?.goFinish(), 260);
      }
    },
    [say, select],
  );

  const addDraft = useCallback((hunkId: string, lineIndex: number, body: string) => {
    const f = live.current.view.hunkFile.get(hunkId)!;
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
    setState((s) => ({ ...s, drafts: [...s.drafts, draft] }));
  }, []);
  const deleteDraft = useCallback((id: string) => setState((s) => ({ ...s, drafts: s.drafts.filter((d) => d.id !== id) })), []);
  const openReview = useCallback(() => setReviewOpen(true), []);
  const tuckLegend = useCallback(() => setLegendOpen(false), []);

  const submit = async () => {
    const res = await submitReview(review.analysis.id, state.verdict, state.summary);
    setState((s) => ({ ...s, submitted: res.submitted }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea,input")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { view, current } = live.current;
      const i = current ? view.order.indexOf(current) : -1;
      switch (e.key.toLowerCase()) {
        case "n":
        case "j":
          if (i < view.order.length - 1) select(view.order[i + 1]!);
          else canvas.current?.goFinish();
          break;
        case "p":
        case "k":
          if (i > 0) select(view.order[i - 1]!);
          break;
        case "x":
          if (current) punch(current);
          break;
        case "f":
          canvas.current?.fitAll();
          setLegendOpen(false);
          break;
        case "0":
          canvas.current?.zoomTo(1);
          break;
        case "=":
        case "+":
          canvas.current?.zoomBy(1.25);
          break;
        case "-":
          canvas.current?.zoomBy(1 / 1.25);
          break;
        case "escape":
          setReviewOpen(false);
          setCourseOpen(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [punch, select]);

  return (
    <div className="app">
      <TopBar review={review} drafts={state.drafts.length} onReview={() => setReviewOpen((o) => !o)} onCourse={() => setCourseOpen((o) => !o)} courseOpen={courseOpen} />
      <CoursePanel
        review={review}
        view={view}
        state={state}
        current={current}
        filters={filters}
        open={courseOpen}
        onFilter={(id, on) => {
          const rule = FILTER_RULES.find((r) => r.id === id)!;
          const n = review.analysis.files.filter((f) => f.noise === id).length;
          setFilter(id, on);
          say(on ? `Ignoring ${rule.plural}: ${n} file${n === 1 ? "" : "s"} moved out of bounds` : `${n} ${rule.plural} back on the course`);
        }}
        onSelect={select}
        onStart={() => {
          setCourseOpen(false);
          canvas.current?.goFile("__start");
        }}
        onFinish={() => {
          setCourseOpen(false);
          setReviewOpen(true);
        }}
        onOob={() => {
          setCourseOpen(false);
          canvas.current?.goOob();
        }}
      />
      <div className="stage">
        <Canvas
          ref={canvas}
          review={review}
          view={view}
          state={state}
          current={current}
          onSelect={select}
          onPunch={punch}
          onAddDraft={addDraft}
          onDeleteDraft={deleteDraft}
          onFinish={openReview}
          onInteract={tuckLegend}
        />
        <Legend open={legendOpen} onToggle={setLegendOpen} />
        <KeysBar />
        <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
          {toast?.pins && <Pins ctl={toast.pins} color="#e7d8f6" />}
          {toast?.text}
        </div>
        <ReviewDrawer
          open={reviewOpen}
          review={review}
          view={view}
          state={state}
          onClose={() => setReviewOpen(false)}
          onVerdict={(v: Verdict) => setState((s) => ({ ...s, verdict: v }))}
          onSummary={(summary) => setState((s) => ({ ...s, summary }))}
          onGoDraft={(hunkId) => {
            setReviewOpen(false);
            canvas.current?.goHunk(hunkId);
          }}
          onSubmit={submit}
        />
      </div>
    </div>
  );
}
