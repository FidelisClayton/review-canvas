import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildAnalysis, type GhFile, type GhPull } from "./analysis.js";

const path = fileURLToPath(new URL("../../test/fixtures/sync-retries.json", import.meta.url));

/** The synthetic "order sync retries" pull request every test reads. */
export function fixture() {
  const { pull, files } = JSON.parse(readFileSync(path, "utf8")) as { pull: GhPull; files: GhFile[] };
  return { pull, files, analysis: buildAnalysis(pull, files, {}, new Date("2026-10-08T12:00:00Z")) };
}

export const fileByPath = (analysis: ReturnType<typeof fixture>["analysis"], suffix: string) => {
  const f = analysis.files.find((x) => x.path.endsWith(suffix));
  if (!f) throw new Error(`no file ending ${suffix}`);
  return f;
};
