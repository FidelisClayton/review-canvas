export type KeyAction =
  | "next-stop"
  | "prev-stop"
  | "next-goal"
  | "prev-goal"
  | "toggle-reviewed"
  | "toggle-overview"
  | "map-view"
  | "guided-view"
  | "toggle-layout"
  | "close-drawer"
  | "close-review"
  | "close-composer"
  | "clear-focus";

export interface KeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  target?: EventTarget | { closest?: (selector: string) => unknown } | null;
}

export interface KeyContext {
  /** A chunk or file drawer is open. */
  drawer: boolean;
  /** The review drawer is open. */
  review: boolean;
  composer: boolean;
}

/** `+`, `-` and `0` belong to the zoom hook, so they map to nothing here. */
export function keyAction(e: KeyEventLike, ctx: KeyContext): KeyAction | null {
  if ((e.target as { closest?: (s: string) => unknown } | null | undefined)?.closest?.("textarea,input,[contenteditable]")) return null;
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case "escape":
      return ctx.drawer ? "close-drawer" : ctx.review ? "close-review" : ctx.composer ? "close-composer" : "clear-focus";
    case "j":
      return "next-stop";
    case "k":
      return "prev-stop";
    case "]":
      return "next-goal";
    case "[":
      return "prev-goal";
    case "x":
      return e.repeat ? null : "toggle-reviewed"; // holding X must not flip the mark on and off
    case "f":
      return "toggle-overview";
    case "m":
      return "map-view";
    case "g":
      return "guided-view";
    case "l":
      return "toggle-layout";
    default:
      return null;
  }
}
