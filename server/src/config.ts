import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Everything the app writes lives under one directory, overridable for tests. */
export const home = () => process.env.REVIEW_CANVAS_HOME ?? join(homedir(), ".local", "share", "review-canvas");
export const reviewsDir = () => join(home(), "reviews");
const configPath = () => join(home(), "config.json");

export interface Config {
  port: number;
  /** The URL the reviewer opens, e.g. the Tailscale HTTPS address. Falls back to localhost. */
  publicUrl: string | null;
}

const DEFAULTS: Config = { port: 4790, publicUrl: null };

export function readConfig(): Config {
  try {
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(configPath(), "utf8")) as Partial<Config>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(config: Config) {
  mkdirSync(home(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

export const port = () => Number(process.env.REVIEW_CANVAS_PORT ?? readConfig().port);
export const baseUrl = () => (readConfig().publicUrl ?? `http://localhost:${port()}`).replace(/\/$/, "");
export const reviewUrl = (id: string) => `${baseUrl()}/r/${encodeURIComponent(id)}`;

/** The built web app, next to the server package in this repo. */
export const webDist = () => join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");
