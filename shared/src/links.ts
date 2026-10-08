import { isTestPath } from "./classify.js";
import type { Hunk, Link, PrFile } from "./types.js";

// A link is only drawn when the code shows it: a symbol defined in one hunk and used in the
// changed lines of a hunk in another file, the way that language refers across files. Names that
// merely look alike (an attribute called `reason` in Ruby and a prop called `reason` in React)
// are not evidence.

type Kind = "method" | "type" | "const";
type Family = "ruby" | "ts" | "tsp";

interface Def {
  symbol: string;
  kind: Kind;
}

const FAMILY: Record<string, Family> = { rb: "ruby", erb: "ruby", ts: "ts", tsx: "ts", tsp: "tsp" };
const familyOf = (f: PrFile): Family | undefined => FAMILY[f.lang];

const RUBY_DEFS: [RegExp, Kind][] = [
  [/\bdef\s+(?:self\.)?([a-z_][A-Za-z0-9_]*[?!=]?)/g, "method"],
  [/\b(?:class|module)\s+((?:[A-Z]\w*::)*[A-Z]\w*)/g, "type"],
  [/\bscope\s+:([a-z_]\w*)/g, "method"],
  [/^\s*([A-Z][A-Z0-9_]{2,})\s*=/g, "const"],
];

const TS_DEFS: [RegExp, Kind][] = [
  [/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g, "method"],
];

const TSP_DEFS: [RegExp, Kind][] = [[/\b(?:model|enum|union|scalar|interface)\s+([A-Z][\w]*)/g, "type"]];

const DEFS: Record<Family, [RegExp, Kind][]> = { ruby: RUBY_DEFS, ts: TS_DEFS, tsp: TSP_DEFS };

/** Words too common to be evidence of a relationship on their own. */
const STOP = new Set(
  (
    "perform call show index create update destroy edit render params value props children className options result " +
    "errors status response request current context config items label title description message event state values " +
    "record attributes initialize default handler handlers columns column header content layout submit change " +
    "present? blank? empty? valid? save! update! create! destroy! reload to_param as_json serializable_hash"
  ).split(" "),
);

const isType = (s: string) => /^[A-Z][a-z]/.test(s.replace(/^.*::/, ""));

function definitions(file: PrFile, hunk: Hunk): Def[] {
  const family = familyOf(file);
  if (!family || isTestPath(file.path)) return [];
  const out: Def[] = [];
  // The hunk header's section names the enclosing class or function, often the only place the
  // definition shows when a hunk adds a method to an existing class.
  const texts = [hunk.section, ...hunk.lines.filter((l) => l.kind !== "del").map((l) => l.text)];
  for (const text of texts) {
    for (const [re, kind] of DEFS[family]) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const full = m[1]!;
        const k: Kind = family === "ts" && isType(full) ? "type" : kind;
        out.push({ symbol: full, kind: k });
        // `Case::Rotation` is usually referred to as `Rotation` inside its namespace.
        if (full.includes("::")) out.push({ symbol: full.split("::").at(-1)!, kind: k });
      }
    }
  }
  return out.filter((d) => usable(d));
}

function usable(d: Def): boolean {
  const bare = d.symbol.replace(/[?!=]$/, "");
  if (STOP.has(d.symbol) || STOP.has(bare)) return false;
  if (d.kind === "type") return bare.replace(/^.*::/, "").length >= 6;
  return bare.length >= 6 || /[?!]$/.test(d.symbol);
}

interface Refs {
  /** Identifiers anywhere in changed lines. */
  plain: Set<string>;
  /** Ruby method names called with a receiver or named as a symbol: `x.foo`, `x&.foo`, `:foo`. */
  sent: Set<string>;
}

const isRoutes = (path: string) => /^config\/routes/.test(path);
const camel = (snake: string) => snake.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase());

/**
 * Rails routes name controllers indirectly: `resources :order_syncs`, `resource :profile`
 * (served by ProfilesController), `to: "order_syncs#update"`, `controller: "order_syncs"`.
 */
function routeRefs(text: string, plain: Set<string>, sent: Set<string>) {
  const controller = (name: string) => {
    const base = camel(name.split("/").at(-1)!);
    plain.add(`${base}Controller`);
    plain.add(`${base}sController`);
  };
  for (const m of text.matchAll(/\bresources?\s+:([a-z_]+)/g)) controller(m[1]!);
  for (const m of text.matchAll(/\bcontroller:?\s+["':]([a-z_/]+)/g)) controller(m[1]!);
  for (const m of text.matchAll(/\bto:\s*["']([a-z_/]+)#([a-z_]+)["']/g)) {
    controller(m[1]!);
    sent.add(m[2]!);
  }
  for (const m of text.matchAll(/\baction:\s*:([a-z_]+)/g)) sent.add(m[1]!);
}

function references(file: PrFile, hunk: Hunk): Refs {
  const plain = new Set<string>();
  const sent = new Set<string>();
  for (const line of hunk.lines) {
    if (line.kind === "ctx") continue;
    for (const m of line.text.matchAll(/(&?\.|::|:)?([A-Za-z_$][\w$]*(?:::[A-Z]\w*)*[?!]?)/g)) {
      const word = m[2]!;
      plain.add(word);
      if (word.includes("::")) plain.add(word.split("::").at(-1)!);
      if (m[1] && m[1] !== "::") sent.add(word);
    }
    if (isRoutes(file.path)) routeRefs(line.text, plain, sent);
  }
  return { plain, sent };
}

function matches(def: Def, defFamily: Family, refFamily: Family, refs: Refs): boolean {
  if (def.kind === "type" || def.kind === "const") {
    // Types may cross languages (a TypeSpec model and the zod type generated from it), but only
    // when the name is distinctive.
    if (defFamily !== refFamily && def.symbol.replace(/^.*::/, "").length < 8) return false;
    return refs.plain.has(def.symbol);
  }
  if (defFamily !== refFamily) return false;
  return defFamily === "ruby" ? refs.sent.has(def.symbol) : refs.plain.has(def.symbol);
}

function labelFor(kind: Kind, symbols: string[], from: PrFile): string {
  if (isTestPath(from.path)) return "tests";
  if (isRoutes(from.path)) return "routes to";
  const list = [...new Set(symbols.map((x) => x.split("::").at(-1)!))].slice(0, 2).join(", ");
  return kind === "method" ? `calls ${list}` : `uses ${list}`;
}

const MAX_OUT_PER_HUNK = 3;

/** Static links between hunks of different files. Deterministic for a given analysis. */
export function staticLinks(files: PrFile[]): Link[] {
  const defsByHunk = new Map<string, { file: PrFile; family: Family; defs: Def[] }>();
  const definers = new Map<string, Set<string>>(); // symbol -> files defining it

  for (const file of files) {
    const family = familyOf(file);
    if (!family) continue;
    for (const hunk of file.hunks) {
      const defs = definitions(file, hunk);
      if (!defs.length) continue;
      defsByHunk.set(hunk.id, { file, family, defs });
      for (const d of defs) {
        const set = definers.get(d.symbol) ?? new Set<string>();
        set.add(file.id);
        definers.set(d.symbol, set);
      }
    }
  }

  type Candidate = Link & { fromFile: string; toFile: string; weight: number };
  const candidates: Candidate[] = [];
  for (const file of files) {
    const family = familyOf(file);
    if (!family) continue;
    const fromTest = isTestPath(file.path);
    for (const hunk of file.hunks) {
      const refs = references(file, hunk);
      const found: Candidate[] = [];
      for (const [targetId, target] of defsByHunk) {
        if (target.file.id === file.id) continue;
        // A test points at the code it exercises, not at generated clients.
        if (fromTest && target.file.noise === "api") continue;
        const methods: string[] = [];
        const types: string[] = [];
        for (const d of target.defs) {
          // A symbol defined in many files says nothing about which one this hunk means.
          if ((definers.get(d.symbol)?.size ?? 0) > 2) continue;
          if (!matches(d, target.family, family, refs)) continue;
          const list = d.kind === "method" ? methods : types;
          if (!list.includes(d.symbol)) list.push(d.symbol);
        }
        if (!methods.length && !types.length) continue;
        // A call names the change more precisely than the class it lives in, so calls lead.
        const byLength = (a: string, b: string) => b.length - a.length;
        const kind: Kind = methods.length ? "method" : "type";
        const symbols = methods.length ? methods.sort(byLength) : types.sort(byLength);
        // A test's own subject is the strongest evidence it can give.
        const subjectBonus = file.subjectOf === target.file.id ? 100 : 0;
        found.push({
          id: "",
          from: hunk.id,
          to: targetId,
          label: labelFor(kind, symbols, file),
          symbol: symbols[0]!,
          source: "static",
          fromFile: file.id,
          toFile: target.file.id,
          weight: subjectBonus + [...methods, ...types].reduce((n, s) => n + s.length, 0),
        });
      }
      found.sort((a, b) => b.weight - a.weight);
      candidates.push(...found.slice(0, MAX_OUT_PER_HUNK));
    }
  }

  // One link per pair of files keeps the map readable; keep the strongest hunk pair.
  const best = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = `${c.fromFile}>${c.toFile}`;
    const prev = best.get(key);
    if (!prev || c.weight > prev.weight) best.set(key, c);
  }
  return [...best.values()].map(({ fromFile: _f, toFile: _t, weight: _w, ...link }, i) => ({ ...link, id: `L${i + 1}` }));
}

/** True when `symbol` appears as a whole word in the hunk's lines. Used to check agent links. */
export function hunkMentions(hunk: Hunk, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^\\w$])${escaped}(?![\\w$])`);
  return hunk.lines.some((l) => re.test(l.text));
}
