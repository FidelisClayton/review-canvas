import type { FastifyInstance, FastifyReply } from "fastify";
import { safeIdSchema } from "@review-canvas/shared";
import { compareEvidence, getDeployment, getEvidenceIndex, getEvidenceRun, getEvidenceSource, requireReview } from "./evidence.js";
import { EvidenceError } from "./evidenceStore.js";
import { githubReadTransport, type GitHubReadTransport } from "./github.js";
import { getRevisionFile, getRevisions } from "./revisions.js";

function validId(value: string) { if (!safeIdSchema.safeParse(value).success) throw new EvidenceError("Invalid id."); }
async function respond(reply: FastifyReply, run: () => unknown) {
  try { return await run(); }
  catch (error) {
    if (error instanceof EvidenceError) return reply.code(error.statusCode).send({error: error.message});
    throw error;
  }
}
export function registerEvidenceRoutes(app: FastifyInstance, github: GitHubReadTransport = githubReadTransport) {
  type Params = {id: string; runId: string};
  type Query = {left?: string; right?: string; mode?: string; observation?: string; ref?: string; baseline?: string; path?: string};
  const review = (id: string) => { validId(id); requireReview(id); };
  app.get<{Params: Params}>("/api/reviews/:id/evidence", (req, reply) => respond(reply, () => {review(req.params.id); return getEvidenceIndex(req.params.id);}));
  app.get<{Params: Params; Querystring: Query}>("/api/reviews/:id/evidence/compare", (req, reply) => respond(reply, () => {
    review(req.params.id); const {left, right, mode} = req.query;
    if (!left || !right || (mode !== undefined && mode !== "runs" && mode !== "base-head")) throw new EvidenceError("Select valid left/right runs and comparison mode.");
    validId(left); validId(right); return compareEvidence(req.params.id, left, right, mode);
  }));
  app.get<{Params: Params; Querystring: Query}>("/api/reviews/:id/evidence/:runId/source", (req, reply) => respond(reply, () => {
    review(req.params.id); validId(req.params.runId); const {observation, ref} = req.query;
    if (observation !== undefined) validId(observation);
    if (ref === undefined || !/^\d+$/.test(ref) || !Number.isSafeInteger(Number(ref))) throw new EvidenceError("Select a stored source reference index.");
    return getEvidenceSource(req.params.id, req.params.runId, observation, Number(ref), github);
  }));
  app.get<{Params: Params}>("/api/reviews/:id/evidence/:runId", (req, reply) => respond(reply, () => {review(req.params.id); validId(req.params.runId); return getEvidenceRun(req.params.id, req.params.runId);}));
  app.get<{Params: Params; Querystring: Query}>("/api/reviews/:id/revisions", (req, reply) => respond(reply, () => {
    review(req.params.id); if (req.query.baseline !== undefined) validId(req.query.baseline);
    return getRevisions(req.params.id, req.query.baseline, github);
  }));
  app.get<{Params: Params; Querystring: Query}>("/api/reviews/:id/revisions/file", (req, reply) => respond(reply, () => {
    review(req.params.id); if (req.query.baseline !== undefined) validId(req.query.baseline);
    if (!req.query.path) throw new EvidenceError("Select a comparison path.");
    return getRevisionFile(req.params.id, req.query.baseline, req.query.path, github);
  }));
  app.get<{Params: Params}>("/api/reviews/:id/deployment", (req, reply) => respond(reply, () => {review(req.params.id); return getDeployment(req.params.id);}));
}
