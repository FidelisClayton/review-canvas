import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);

/**
 * The JSON an agent writes after reading the brief. A stop is a hunk id ("f3.h1") or one test
 * cropped out of a test hunk ("f3.h1@keeps retrying", a substring of the test name).
 */
export const courseInputSchema = z.object({
  sentence: text(300).default(""),
  goals: z
    .array(
      z.object({
        title: text(120).min(1),
        src: text(40),
        quote: text(600),
        stops: z.array(z.string()).default([]),
        gap: text(300).optional(),
      }),
    )
    .default([]),
  /** Hunk ids the agent knows no goal asked for. Chunks nobody cites are appended anyway. */
  unclaimed: z.array(z.string()).default([]),
  hunks: z
    .record(
      z.string(),
      z.object({
        summary: text(90),
        lines: z
          .array(z.object({ side: z.enum(["LEFT", "RIGHT"]), line: z.number().int().min(1), text: text(200) }))
          .max(3)
          .default([]),
      }),
    )
    .default({}),
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
  read: z.record(z.string(), z.string()).default({}),
  reviewed: z.record(z.string(), z.string()).default({}),
  drafts: z.array(draftSchema).max(500),
  verdict: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  summary: z.string().max(20000),
});
export type StateInput = z.infer<typeof stateInputSchema>;

export const submitInputSchema = z.object({
  event: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  body: z.string().max(20000).default(""),
});
