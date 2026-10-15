import { useState } from "react";
import type { Review, ReviewState, Verdict } from "@review-canvas/shared";
import { Icon } from "./icons";
import { needsMark, totals, type CourseIndex } from "./course/model";

const base = (p: string) => p.split("/").pop() ?? p;

export function TopBar({ review, drafts, mode, onMode, onReview, onCourse, courseOpen, layout, onLayout }: { review: Review; drafts: number; mode: "guided" | "map"; onMode: (m: "guided" | "map") => void; layout?: "canvas" | "diff"; onLayout?: (l: "canvas" | "diff") => void; onReview: () => void; onCourse: () => void; courseOpen: boolean }) {
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
      <div className="modes" role="group" aria-label="View">
        <button aria-pressed={mode === "guided"} onClick={() => onMode("guided")} disabled={!review.course.goals.length} title={review.course.goals.length ? undefined : "No agent has planned goals for this PR"}>
          Guided <kbd>G</kbd>
        </button>
        <button aria-pressed={mode === "map"} onClick={() => onMode("map")}>
          Map <kbd>M</kbd>
        </button>
      </div>
      {mode === "guided" && onLayout && (
        <div className="modes" role="group" aria-label="Layout">
          <button aria-pressed={layout !== "diff"} onClick={() => onLayout("canvas")}>
            Canvas <kbd>L</kbd>
          </button>
          <button aria-pressed={layout === "diff"} onClick={() => onLayout("diff")}>
            Diff <kbd>L</kbd>
          </button>
        </div>
      )}
      {review.defaultCourse && (
        <span className="synthetic" title="No agent has planned goals for this PR yet, so only the Map view is available.">
          No course
        </span>
      )}
      <button className="btn primary" onClick={onReview}>
        <span className="lbl">Review</span>
        <span className="count">{drafts}</span>
      </button>
    </header>
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
  idx: CourseIndex;
  state: ReviewState;
  onClose: () => void;
  onVerdict: (v: Verdict) => void;
  onSummary: (s: string) => void;
  onGoDraft: (hunkId: string, lineIndex: number) => void;
  onSubmit: () => Promise<void>;
}

export function ReviewDrawer(p: ReviewDrawerProps) {
  const [confirming, setConfirming] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pr } = p.review.analysis;
  const t = totals(p.idx, p.state);
  const open = p.idx.goals.filter((g) => needsMark(g) && !p.state.reviewed[g.id]);
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
        {t.goalsTotal === 0 ? (
          <div className="left">
            <b>No goals on this review.</b> {t.stopsRead} of {t.stopsTotal} stops read.
          </div>
        ) : open.length ? (
          <div className="left">
            <b>
              {t.goalsDone} of {t.goalsTotal} goals marked reviewed
            </b>
            , {t.stopsRead} of {t.stopsTotal} stops read. Not marked: {open.map((g) => g.title).join("; ")}. You can still post, but they stay unreviewed.
          </div>
        ) : (
          <div className="left done">
            <b>Course complete.</b> Every goal is marked reviewed; {t.stopsRead} of {t.stopsTotal} stops read.
          </div>
        )}
        <h3>Draft comments ({n})</h3>
        {n ? (
          <ul className="dlist">
            {p.state.drafts.map((d) => (
              <li key={d.id}>
                <button onClick={() => p.onGoDraft(d.hunkId, d.lineIndex)}>
                  <span className="loc">
                    {base(d.path)}:{d.line}
                  </span>
                  <p>{d.body}</p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No drafts yet. Click a line of code to start one.</p>
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
