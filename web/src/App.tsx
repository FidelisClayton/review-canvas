import { useEffect, useState } from "react";
import { fetchReviews, type ReviewSummary } from "./api";
import { IconSprite } from "./icons";
import { ReviewScreen } from "./ReviewScreen";

export function App() {
  const match = /^\/r\/([^/]+)/.exec(location.pathname);
  return (
    <>
      <IconSprite />
      {match ? <ReviewScreen id={decodeURIComponent(match[1]!)} /> : <ReviewList />}
    </>
  );
}

function ReviewList() {
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchReviews().then((r) => setReviews(r.reviews), (e: Error) => setError(e.message));
  }, []);
  return (
    <div className="screen-msg list">
      <h1>Review Canvas</h1>
      <p>
        Ask your agent to review a pull request with the <code>review-canvas</code> skill, or run <code>review-canvas open &lt;pr-url&gt;</code>. Each review gets its own link.
      </p>
      {error && <p className="err">{error}</p>}
      {reviews && reviews.length === 0 && <p>No reviews yet.</p>}
      {reviews && reviews.length > 0 && (
        <ul className="review-list">
          {reviews.map((r) => (
            <li key={r.id}>
              <a href={`/r/${encodeURIComponent(r.id)}`}>
                <span className="repo">
                  {r.repo}#{r.number}
                </span>
                <b>{r.title}</b>
                <small>
                  {r.author}
                  {r.publishedAt ? ` · course planned ${new Date(r.publishedAt).toLocaleString()}` : " · default order"}
                </small>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
