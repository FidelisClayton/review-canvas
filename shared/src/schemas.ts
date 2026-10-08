import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);

/** The JSON an agent writes after reading the brief. Everything is optional except the order. */
export const courseInputSchema = z.object({
  route: text(600).default(""),
  order: z.array(z.string()).min(1),
  files: z
    .record(z.string(), z.object({ what: text(400).optional(), why: text(300).optional() }))
    .default({}),
  hunks: z.record(z.string(), text(300)).default({}),
  /** Extra relationships the agent saw. Each one is checked: the symbol must appear in both hunks. */
  links: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: text(60),
        symbol: z.string().trim().min(2).max(120),
      }),
    )
    .default([]),
});
export type CourseInput = z.infer<typeof courseInputSchema>;

const draftSchema = z.object({
  id: z.string().min(1).max(64),
  hunkId: z.string().min(1).max(64),
  lineIndex: z.number().int().min(0),
  path: z.string().min(1).max(1000),
  line: z.number().int().min(1),
  side: z.enum(["LEFT", "RIGHT"]),
  body: z.string().trim().min(1).max(20000),
  createdAt: z.string(),
});

/** What the browser saves. `submitted` is server-owned and never accepted from the client. */
export const stateInputSchema = z.object({
  punched: z.record(z.string(), z.object({ at: z.string(), splitMs: z.number().nullable() })),
  drafts: z.array(draftSchema).max(500),
  verdict: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  summary: z.string().max(20000),
});
export type StateInput = z.infer<typeof stateInputSchema>;

export const submitInputSchema = z.object({
  event: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  body: z.string().max(20000).default(""),
});
