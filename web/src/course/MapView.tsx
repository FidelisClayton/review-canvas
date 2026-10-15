import { useEffect, useRef, useState, type ReactNode } from "react";
import { LAYERS, LAYER_INFO, onCourse, type LayerId, type PrFile, type Stop } from "@review-canvas/shared";
import { useCourse } from "./ctx";
import { base, dir } from "./model";
import { CodeRows, StopView } from "./StopView";
import "./map.css";

/** Every changed file on its layer band with every chunk open, and the Out of bounds band. */
export interface MapViewProps {
  /** True once, when the course sheet's "Out of bounds" row asks for the band to be scrolled to. */
  focusOob: boolean;
  /** A goal badge was clicked: open that goal in the Guided view at that chunk. */
  onGoalBadge: (goalId: string, hunkId: string) => void;
}

const Delta = ({ f }: { f: PrFile }) => (
  <span className="delta">
    <span className="a">+{f.additions}</span>
    <span className="d">−{f.deletions}</span>
  </span>
);

export function MapView({ focusOob, onGoalBadge }: MapViewProps) {
  const c = useCourse();
  const bandRef = useRef<HTMLElement>(null);
  // Files whose diff is shown. A file with a draft starts open, so "Go to draft" finds its line.
  const [shown, setShown] = useState(() => new Set(c.state.drafts.flatMap((d) => c.view.hunkFile.get(d.hunkId)?.id ?? [])));
  const toggle = (id: string) =>
    setShown((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  useEffect(() => {
    if (!focusOob) return;
    const frame = requestAnimationFrame(() => {
      const band = bandRef.current;
      const vp = band?.closest<HTMLElement>(".viewport");
      if (band && vp) vp.scrollTo({ top: vp.scrollTop + band.getBoundingClientRect().top - vp.getBoundingClientRect().top - 24 });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusOob]);

  const byBand = Object.fromEntries(LAYERS.map((l) => [l, [] as ReactNode[]])) as Record<LayerId, ReactNode[]>;
  for (const f of c.review.analysis.files.filter(onCourse)) {
    byBand[f.layer].push(
      <article className="node" data-file={f.id} key={f.id}>
        <header className="tb">
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
        {f.hunks.length ? (
          f.hunks.map((h) => {
            const stop: Stop = { hunkId: h.id, from: 0, to: h.lines.length - 1, test: f.noise === "tests" };
            return <StopView key={h.id} stop={stop} mode="map" onGoalBadge={onGoalBadge} />;
          })
        ) : (
          <div className="nodiff">No diff</div>
        )}
      </article>,
    );
  }

  return (
    <div className="map">
      {LAYERS.filter((l) => byBand[l].length).map((l) => (
        <section className="band" data-layer={l} key={l}>
          <div className="bandlab">
            <b>{LAYER_INFO[l].name}</b>
            <small>{LAYER_INFO[l].sub}</small>
          </div>
          <div className="brow">{byBand[l]}</div>
        </section>
      ))}
      {c.view.oob.length > 0 && (
        <section className="oobband" ref={bandRef} aria-label="Out of bounds">
          <header>
            <b>Out of bounds</b>
            <small>Generated output and API clients. Not on the course and not counted as read; lines still take draft comments.</small>
          </header>
          {c.view.oob.map((o) => {
            const f = c.view.files.get(o.fileId)!;
            const open = shown.has(f.id);
            // Not a StopView: these chunks carry no data-key, so the read rule never sees them.
            return (
              <article className="node oobfile" data-file={f.id} key={o.id}>
                <header className="tb">
                  <span className="fname">
                    <span className="dir">{dir(f.path)}</span>
                    <b>{base(f.path)}</b>
                  </span>
                  <span className="why">{o.reason}</span>
                  <Delta f={f} />
                  {f.hunks.length > 0 && (
                    <button className="fbtn" aria-expanded={open} onClick={() => toggle(f.id)}>
                      {open ? "Hide diff" : "Show diff"}
                    </button>
                  )}
                </header>
                {open &&
                  f.hunks.map((h) => (
                    <div className="stop" data-hunk={h.id} key={h.id}>
                      <div className="hh">
                        <code className="rg">{h.range}</code>
                      </div>
                      <CodeRows hunkId={h.id} from={0} to={h.lines.length - 1} mode="map" />
                    </div>
                  ))}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
