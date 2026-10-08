import { useState } from "react";
import { FILTER_RULES, type Filters, type Review, type ReviewState, type ReviewView, type Verdict } from "@review-canvas/shared";
import { fmtSplit } from "./canvas/Frames";
import { Icon } from "./icons";
import { Pins } from "./pins";

const base = (p: string) => p.split("/").pop() ?? p;
const dir = (p: string) => p.slice(0, p.length - base(p).length);

export function TopBar({ review, drafts, onReview, onCourse, courseOpen }: { review: Review; drafts: number; onReview: () => void; onCourse: () => void; courseOpen: boolean }) {
  const { pr } = review.analysis;
  return (
    <header className="top">
      <button className="btn quiet course-toggle" onClick={onCourse} aria-controls="course" aria-expanded={courseOpen}>
        <Icon name="course" />
        Course
      </button>
      <a className="brand" href="/">
        <svg viewBox="0 0 26 26" aria-hidden="true">
          <path d="M3 21.5 8.5 12 14 21.5Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="19" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M11 14.5 15.6 10.6" stroke="currentColor" strokeWidth="2.2" />
        </svg>
        Review Canvas
      </a>
      <div className="pr">
        <span className="repo">
          {pr.owner}/{pr.repo}
        </span>
        <h1>
          <a href={pr.url} target="_blank" rel="noreferrer">
            {pr.title} <span className="num">#{pr.number}</span>
          </a>
        </h1>
      </div>
      <div className="meta">
        <span>
          {pr.author} wants to merge into <b>{pr.baseRef}</b>
        </span>
        <span>{pr.changedFiles} files</span>
        <span>
          <span className="a">+{pr.additions}</span> <span className="d">−{pr.deletions}</span>
        </span>
      </div>
      {review.defaultCourse && (
        <span className="synthetic" title="No agent has planned this course yet. Files are in layer order.">
          Default order
        </span>
      )}
      <button className="btn primary" onClick={onReview}>
        <span className="lbl">Review</span>
        <span className="count">{drafts}</span>
      </button>
    </header>
  );
}

function Circle({ ctl, sub, cur }: { ctl: string; sub: boolean; cur: boolean }) {
  return (
    <svg viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="12" fill={cur ? "#7b2cbf" : "#fff"} stroke="#7b2cbf" strokeWidth={sub ? 1.8 : 2.4} />
      {!sub && (
        <text x="15" y="20.5" textAnchor="middle" className="row-num" fontSize={ctl.length > 1 ? 15 : 17} fill={cur ? "#fff" : "#7b2cbf"}>
          {ctl}
        </text>
      )}
    </svg>
  );
}

interface CoursePanelProps {
  review: Review;
  view: ReviewView;
  state: ReviewState;
  current: string | null;
  filters: Filters;
  open: boolean;
  onFilter: (id: keyof Filters, on: boolean) => void;
  onSelect: (id: string) => void;
  onStart: () => void;
  onFinish: () => void;
  onOob: () => void;
}

export function CoursePanel(p: CoursePanelProps) {
  const left = p.view.order.filter((id) => !p.state.punched[id]);
  const linesLeft = left.reduce((n, id) => n + p.view.files.get(id)!.additions + p.view.files.get(id)!.deletions, 0);
  const on = FILTER_RULES.filter((r) => p.filters[r.id]);
  const oobCounts = (kind: string) => p.view.oob.filter((o) => o.kind === kind).length;
  return (
    <aside className={`course${p.open ? " open" : ""}`} id="course" aria-label="Course">
      <div className="course-head">
        <h2>
          Course{" "}
          <span>
            {p.view.order.length - left.length}/{p.view.order.length}
          </span>
        </h2>
        <p>{left.length ? `${left.length} file${left.length > 1 ? "s" : ""} to punch · ${linesLeft} lines left` : "Every file punched. Head for the finish."}</p>
        <div className="strip" style={{ gridTemplateColumns: `repeat(${Math.max(1, p.view.order.length)},1fr)` }} aria-hidden="true">
          {p.view.order.map((id) => (
            <i key={id} className={p.state.punched[id] ? "on" : id === p.current ? "cur" : ""} />
          ))}
        </div>
        <details className="noise">
          <summary>
            <Icon name="filter" />
            Ignore noise<span className="state">{on.length ? on.map((r) => (r.id === "api" ? "Generated API" : r.id === "tests" ? "Tests" : "i18n")).join(", ") : "Off"}</span>
            <Icon name="chev" className="icon chev" />
          </summary>
          {FILTER_RULES.map((r) => {
            const count = p.review.analysis.files.filter((f) => f.noise === r.id).length;
            return (
              <label className="nz" key={r.id}>
                <input type="checkbox" checked={p.filters[r.id]} onChange={(e) => p.onFilter(r.id, e.target.checked)} />
                <span>
                  <b>{r.label}</b>
                  <code>{r.patterns}</code>
                  {r.note && <small>{r.note}</small>}
                </span>
                <em>
                  {count} file{count === 1 ? "" : "s"}
                </em>
              </label>
            );
          })}
          <label className="nz locked">
            <input type="checkbox" checked disabled />
            <span>
              <b>Generated and lockfiles</b>
              <code>db/schema.rb · *.lock · *.snap · files marked “do not edit”</code>
            </span>
            <em>always</em>
          </label>
          <p>Ignored files move out of bounds and leave the course. Saved in this browser for every PR.</p>
        </details>
      </div>
      <ol className="course-list">
        <li>
          <button className="row" onClick={p.onStart}>
            <span className="sym">
              <svg viewBox="0 0 30 30">
                <path d="M5 25 15 6 25 25Z" fill="#fff" stroke="#7b2cbf" strokeWidth="2.4" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="name">
              <b>Start</b>
              <small>PR description and how the course runs</small>
            </span>
            <span />
            <span />
          </button>
        </li>
        {p.view.order.map((id) => {
          const f = p.view.files.get(id)!;
          const cur = id === p.current;
          const punch = p.state.punched[id];
          const sub = p.view.sub[id];
          return (
            <li key={id}>
              <button className={`row${sub ? " sub" : ""}${cur ? " cur" : ""}`} onClick={() => p.onSelect(id)} aria-current={cur ? "step" : undefined}>
                <span className="sym">
                  <Circle ctl={p.view.ctl[id]!} sub={!!sub} cur={cur} />
                </span>
                <span className="name">
                  <b>
                    {base(f.path)}
                    {sub && <span className="tag">{sub}</span>}
                  </b>
                  <small>{dir(f.path)}</small>
                </span>
                <span className="ct">
                  {punch ? (
                    <span className="split">{fmtSplit(punch.splitMs) || "done"}</span>
                  ) : (
                    <>
                      <span className="a">+{f.additions}</span>
                      {f.deletions ? <span className="d">−{f.deletions}</span> : null}
                    </>
                  )}
                </span>
                <span className={`box${punch ? " on" : ""}`} aria-label={punch ? "Punched" : "Not punched"}>
                  {punch && <Pins ctl={p.view.ctl[id]!} />}
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button className="row" onClick={p.onFinish}>
            <span className="sym">
              <svg viewBox="0 0 30 30">
                <circle cx="15" cy="15" r="12.5" fill="#fff" stroke="#7b2cbf" strokeWidth="2" />
                <circle cx="15" cy="15" r="7.5" fill="none" stroke="#7b2cbf" strokeWidth="2" />
              </svg>
            </span>
            <span className="name">
              <b>Finish</b>
              <small>Submit your review</small>
            </span>
            <span />
            <span />
          </button>
        </li>
        {p.view.oob.length > 0 && (
          <li>
            <button className="row oob" onClick={p.onOob}>
              <span className="sym">
                <svg viewBox="0 0 30 30">
                  <defs>
                    <pattern id="row-oob" width="5" height="10" patternUnits="userSpaceOnUse">
                      <rect width="5" height="10" fill="#fff" />
                      <path d="M1.5 0v10" stroke="#7b2cbf" strokeWidth="1.3" opacity=".6" />
                    </pattern>
                  </defs>
                  <rect x="4" y="4" width="22" height="22" fill="url(#row-oob)" stroke="#7b2cbf" strokeWidth="1.6" />
                </svg>
              </span>
              <span className="name">
                <b>Out of bounds</b>
                <small>
                  {[`${oobCounts("generated")} generated`, ...FILTER_RULES.filter((r) => oobCounts(r.id)).map((r) => `${oobCounts(r.id)} ${r.short}`)].join(" · ")}, skipped
                </small>
              </span>
              <span />
              <span />
            </button>
          </li>
        )}
      </ol>
      <div className="course-foot">
        <span>{p.review.course.route ? "Order planned by your agent." : "Default order: by layer, top to bottom."}</span>
      </div>
    </aside>
  );
}

const VERDICTS: [Verdict, string, string][] = [
  ["COMMENT", "Comment", "Feedback without a verdict."],
  ["APPROVE", "Approve", "Ready to merge as it is."],
  ["REQUEST_CHANGES", "Request changes", "Needs fixes before merging."],
];

interface ReviewDrawerProps {
  open: boolean;
  review: Review;
  view: ReviewView;
  state: ReviewState;
  onClose: () => void;
  onVerdict: (v: Verdict) => void;
  onSummary: (s: string) => void;
  onGoDraft: (hunkId: string) => void;
  onSubmit: () => Promise<void>;
}

export function ReviewDrawer(p: ReviewDrawerProps) {
  const [confirming, setConfirming] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pr } = p.review.analysis;
  const left = p.view.order.filter((id) => !p.state.punched[id]);
  const label = VERDICTS.find((v) => v[0] === p.state.verdict)![1];
  const n = p.state.drafts.length;

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      await p.onSubmit();
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <aside className={`review${p.open ? " open" : ""}`} aria-label="Your review" aria-hidden={!p.open}>
      <header>
        <h2>Your review</h2>
        <button className="btn quiet" onClick={p.onClose} aria-label="Close review">
          <Icon name="close" />
        </button>
      </header>
      <div className="scroll">
        <h3>Coverage</h3>
        {left.length ? (
          <div className="left">
            <b>
              {left.length} of {p.view.order.length} files not punched yet:
            </b>{" "}
            {left.map((id) => p.view.ctl[id] + (p.view.sub[id] ? ` ${p.view.sub[id]}` : "")).join(", ")}. You can still post, but they stay unreviewed.
          </div>
        ) : (
          <div className="left done">
            <b>Course complete.</b> Every file is punched.
          </div>
        )}
        <h3>Draft comments ({n})</h3>
        {n ? (
          <ul className="dlist">
            {p.state.drafts.map((d) => (
              <li key={d.id}>
                <button onClick={() => p.onGoDraft(d.hunkId)}>
                  <span className="loc">
                    {base(d.path)}:{d.line}
                  </span>
                  <p>{d.body}</p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No drafts yet. Hover a line in any file and press the + in its gutter to start one.</p>
        )}
        <h3>Verdict</h3>
        <div className="verdict" role="radiogroup">
          {VERDICTS.map(([v, t, s]) => (
            <label key={v}>
              <input type="radio" name="verdict" checked={p.state.verdict === v} onChange={() => p.onVerdict(v)} disabled={!!p.state.submitted} />
              <span>
                <b>{t}</b>
                <span>{s}</span>
              </span>
            </label>
          ))}
        </div>
        <h3>Summary</h3>
        <textarea value={p.state.summary} onChange={(e) => p.onSummary(e.target.value)} placeholder="Optional. Posted as the review body." disabled={!!p.state.submitted} />
      </div>
      <footer>
        {p.state.submitted ? (
          <p className="sent">
            <b>Posted.</b> Your {VERDICTS.find((v) => v[0] === p.state.submitted!.event)![1].toLowerCase()} review is on{" "}
            <a href={p.state.submitted.url} target="_blank" rel="noreferrer">
              {pr.owner}/{pr.repo}#{pr.number}
            </a>
            .
          </p>
        ) : confirming ? (
          <div className="confirm">
            <p>
              Post a <b>{label}</b> review with {n} comment{n === 1 ? "" : "s"} to <b>
                {pr.owner}/{pr.repo}#{pr.number}
              </b>{" "}
              as you? Everyone on the PR will see it.
            </p>
            {error && <p className="err">{error}</p>}
            <div className="row2">
              <button className="btn" onClick={() => setConfirming(false)} disabled={posting}>
                Keep editing
              </button>
              <button className="btn primary" onClick={post} disabled={posting}>
                {posting ? "Posting…" : "Post to GitHub"}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn primary" onClick={() => setConfirming(true)} disabled={p.state.verdict === "COMMENT" && !n && !p.state.summary.trim()}>
            <Icon name="send" />
            Post review to GitHub…
          </button>
        )}
      </footer>
    </aside>
  );
}

export function Legend({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  const swatch = (fill: string, extra?: React.ReactNode) => (
    <svg viewBox="0 0 44 18">
      <rect x="1" y="1" width="42" height="16" fill={fill} stroke="#dcd8d2" />
      {extra}
    </svg>
  );
  return (
    <details className="legend" open={open} onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}>
      <summary>
        Legend <Icon name="chev" />
      </summary>
      <table>
        <tbody>
          <tr className="grp">
            <td colSpan={2}>Course</td>
          </tr>
          <tr>
            <td>
              <svg viewBox="0 0 44 18">
                <path d="M4 16 10 4 16 16Z" fill="none" stroke="#7b2cbf" strokeWidth="2" />
                <path d="M18 10h22" stroke="#7b2cbf" strokeWidth="2.5" />
              </svg>
            </td>
            <td>Start and the review order, file to file</td>
          </tr>
          <tr>
            <td>
              <svg viewBox="0 0 44 18">
                <circle cx="12" cy="9" r="7" fill="none" stroke="#7b2cbf" strokeWidth="2" />
                <circle cx="32" cy="9" r="7.5" fill="none" stroke="#7b2cbf" strokeWidth="1.6" />
                <circle cx="32" cy="9" r="4.2" fill="none" stroke="#7b2cbf" strokeWidth="1.6" />
              </svg>
            </td>
            <td>File to review · finish</td>
          </tr>
          <tr>
            <td>
              <svg viewBox="0 0 44 18">
                <path d="M3 9h38" stroke="#1e1b22" strokeWidth="1.6" strokeDasharray="5 3.5" />
                <circle cx="3" cy="9" r="2.5" fill="#1e1b22" />
                <circle cx="41" cy="9" r="2.5" fill="#1e1b22" />
              </svg>
            </td>
            <td>Code path between hunks</td>
          </tr>
          <tr className="grp">
            <td colSpan={2}>Terrain (layers)</td>
          </tr>
          <tr>
            <td>{swatch("#fff", <path d="M4 12c8-6 14 2 22-3s12-2 15-1" stroke="#8c5a2b" fill="none" opacity=".55" />)}</td>
            <td>Data: migrations, models</td>
          </tr>
          <tr>
            <td>{swatch("url(#t-forest)")}</td>
            <td>Domain: services, events, lib</td>
          </tr>
          <tr>
            <td>{swatch("url(#t-marsh)")}</td>
            <td>Jobs, tasks and schedules</td>
          </tr>
          <tr>
            <td>{swatch("#fdf0c4")}</td>
            <td>Mail</td>
          </tr>
          <tr>
            <td>{swatch("#ffe8a3")}</td>
            <td>HTTP: contracts, routes, controllers</td>
          </tr>
          <tr>
            <td>{swatch("url(#t-thicket)")}</td>
            <td>Frontend</td>
          </tr>
          <tr>
            <td>{swatch("url(#t-rough)")}</td>
            <td>Config and docs</td>
          </tr>
          <tr>
            <td>
              <svg viewBox="0 0 44 18">
                <rect x="1" y="1" width="42" height="16" fill="url(#t-oob)" stroke="#7b2cbf" />
              </svg>
            </td>
            <td>Out of bounds: skipped files</td>
          </tr>
        </tbody>
      </table>
    </details>
  );
}

export function KeysBar() {
  return (
    <div className="keys" aria-hidden="true">
      <span>
        <kbd>N</kbd>next file
      </span>
      <span>
        <kbd>X</kbd>punch
      </span>
      <span>
        <kbd>F</kbd>whole course
      </span>
      <span>
        <kbd>Space</kbd>drag to pan
      </span>
      <span>
        <kbd>⌘</kbd>scroll to zoom
      </span>
    </div>
  );
}
