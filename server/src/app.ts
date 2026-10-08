import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { stateInputSchema, submitInputSchema, type ReviewPayload } from "@review-canvas/shared";
import { webDist } from "./config.js";
import { GhError, submitReview } from "./github.js";
import { listReviews, loadReview, loadState, saveState } from "./store.js";

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });

  app.get("/api/health", async () => ({ ok: true, app: "review-canvas" }));

  app.get("/api/reviews", async () => ({ reviews: listReviews() }));

  app.get<{ Params: { id: string } }>("/api/reviews/:id", async (req, reply) => {
    const { id } = req.params;
    if (!SAFE_ID.test(id)) return reply.code(400).send({ error: "Invalid review id." });
    const review = loadReview(id);
    if (!review) return reply.code(404).send({ error: `No review called ${id}. Run the review-canvas skill on the PR first.` });
    const payload: ReviewPayload = { review, state: loadState(id) };
    return payload;
  });

  app.put<{ Params: { id: string } }>("/api/reviews/:id/state", async (req, reply) => {
    const { id } = req.params;
    if (!SAFE_ID.test(id) || !loadReview(id)) return reply.code(404).send({ error: "No such review." });
    const parsed = stateInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid state.", issues: parsed.error.issues });
    const current = loadState(id);
    // `submitted` is written only by the submit route below.
    saveState(id, { ...parsed.data, submitted: current.submitted });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/reviews/:id/submit", async (req, reply) => {
    const { id } = req.params;
    const review = SAFE_ID.test(id) ? loadReview(id) : null;
    if (!review) return reply.code(404).send({ error: "No such review." });
    const parsed = submitInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid submit request." });
    const state = loadState(id);
    if (state.submitted) return reply.code(409).send({ error: "This review was already posted.", url: state.submitted.url });
    try {
      const { url } = await submitReview(review.analysis.pr, parsed.data.event, parsed.data.body, state.drafts);
      const submitted = { at: new Date().toISOString(), url, event: parsed.data.event };
      saveState(id, { ...state, verdict: parsed.data.event, summary: parsed.data.body, submitted });
      return { url, submitted };
    } catch (e) {
      const message = e instanceof GhError ? e.message : "GitHub rejected the review.";
      return reply.code(502).send({ error: message });
    }
  });

  const dist = webDist();
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    const index = readFileSync(join(dist, "index.html"), "utf8");
    // The web app routes on the client: /r/<id> and / both serve index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found." });
      return reply.type("text/html").send(index);
    });
  }
  return app;
}
