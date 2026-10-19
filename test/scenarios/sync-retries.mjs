import { createServer } from "node:http";
import { once } from "node:events";

// This synthetic fixture's committed implementation may differ between base and head.
const RETRY_POLICY = "deduplicate";
const input = JSON.parse(process.env.REVIEW_CANVAS_SCENARIO_INPUT);
const record = { id: input.recordId, attempts: input.attempts, status: "pending" };
const events = [];
const jobs = [];
const emit = (id, kind, title, value) => console.log(`REVIEW_CANVAS_EVENT ${JSON.stringify({ id, kind, title, value, sourceRefs: [] })}`);
const before = structuredClone(record);
emit("request-input", "input", "Declared synthetic request", input);
const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/retry") { response.writeHead(404).end(); return; }
  record.attempts += 1;
  record.status = "queued";
  events.push({ id: "synthetic-event-1", type: "sync.retry_requested", recordId: record.id, attempt: record.attempts });
  jobs.push({ id: "synthetic-job-1", type: "SyncRecord", recordId: record.id });
  if (RETRY_POLICY === "duplicate") jobs.push({ id: "synthetic-job-2", type: "SyncRecord", recordId: record.id });
  response.writeHead(RETRY_POLICY === "deduplicate" ? 202 : 200, { "content-type": "application/json" });
  response.end(JSON.stringify({ recordId: record.id, status: record.status, queuedJobs: jobs.length }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/retry`, { method: "POST" });
  const body = await response.json();
  emit("http-response", "response", "Actual HTTP response", { status: response.status, body });
  emit("record-change", "record", "Seeded record before and after request", { before, after: record });
  emit("retry-event", "event", "Events emitted by request", events);
  emit("queued-jobs", "job", "Jobs queued by request", jobs);
  emit("scenario-output", "output", "Actual retry result", { record, eventCount: events.length, jobCount: jobs.length });
  const passed = response.status === 202 && record.attempts === input.attempts + 1 && events.length === 1 && jobs.length === 1;
  emit("retry-assertion", "assertion", "Request schedules one retry", { outcome: passed ? "passed" : "failed", expected: { status: 202, events: 1, jobs: 1 }, actual: { status: response.status, events: events.length, jobs: jobs.length } });
  if (!passed) process.exitCode = 1;
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
