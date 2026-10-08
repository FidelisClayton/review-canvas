// A small tokenizer for diff lines: enough color to read structure, not a full grammar.

const KW: Record<string, string> = {
  rb: "class def end do if else elsif unless return self private module rescue begin ensure nil true false then yield super case when while until",
  ts: "export const let var async await return new type interface import from if else true false null undefined function class extends implements for of in while switch case break default throw try catch finally typeof keyof as readonly",
  tsp: "model op namespace import using enum union scalar extends is interface",
};
KW.tsx = KW.ts!;
KW.erb = KW.rb!;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const cache = new Map<string, RegExp>();
function pattern(lang: string): RegExp {
  let re = cache.get(lang);
  if (!re) {
    const cmt = ["ts", "tsx", "tsp"].includes(lang) ? "\\/\\/.*$" : ["rb", "yml", "sh"].includes(lang) ? "#(?!\\{).*$" : "(?!x)x";
    re = new RegExp(
      `(${cmt})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`[^\`]*\`)|(<%=?|%>)|((?<![\\w:]):[a-z_]+\\??|\\b[a-z_]+:(?=\\s))|\\b([A-Za-z_][A-Za-z0-9_]*[?!]?)\\b|\\b(\\d+)\\b`,
      "g",
    );
    cache.set(lang, re);
  }
  return re;
}

/** Returns HTML with token spans. Input is escaped; only our own spans are emitted. */
export function highlight(text: string, lang: string): string {
  if (lang === "text" || lang === "md") return esc(text);
  const kw = new Set((KW[lang] ?? "").split(" "));
  const re = pattern(lang);
  re.lastIndex = 0;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(re)) {
    const t = m[0];
    const i = m.index;
    out += esc(text.slice(last, i));
    let cls: string | null = null;
    if (m[1]) cls = "t-c";
    else if (m[2]) cls = "t-s";
    else if (m[3]) cls = "t-k";
    else if (m[4]) cls = lang === "yml" ? "t-k" : "t-y";
    else if (m[5]) cls = kw.has(t) ? "t-k" : /^[A-Z]/.test(t) ? "t-t" : null;
    else if (m[6]) cls = "t-n";
    out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
    last = i + t.length;
  }
  return out + esc(text.slice(last));
}
