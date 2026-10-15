import { useState } from "react";
import { useCourse } from "./ctx";
import { COLLAPSE_OVER, linkGroups, type LinkEntry } from "./linkGroups";
import { base } from "./model";
import "./links.css";

export interface LinkGroupsProps {
  hunkId: string;
  /** Opens the linked chunk in the side drawer, highlighting `symbols`. */
  onOpenChunk: (hunkId: string, symbols: string[]) => void;
}

function Chip({ e, onOpen }: { e: LinkEntry; onOpen: (e: LinkEntry) => void }) {
  return (
    <button className="chip" title="Open in the side drawer" onClick={() => onOpen(e)}>
      <b>{base(e.path)}</b>
      {e.symbol && <span>{e.symbol}</span>}
    </button>
  );
}

function Group({ label, entries, onOpen }: { label: string; entries: LinkEntry[]; onOpen: (e: LinkEntry) => void }) {
  const [listed, setListed] = useState(false);
  if (!entries.length) return null;
  const many = entries.length > COLLAPSE_OVER;
  return (
    <div className="links">
      <span className="lk">{label}</span>
      {many ? (
        <button className="chip count" aria-expanded={listed} onClick={() => setListed(!listed)}>
          <b>{`${label} ${entries.length}`}</b>
        </button>
      ) : (
        entries.map((e, i) => <Chip key={i} e={e} onOpen={onOpen} />)
      )}
      {many && listed && (
        <div className="linklist">
          {entries.map((e, i) => (
            <Chip
              key={i}
              e={e}
              onOpen={(x) => {
                setListed(false);
                onOpen(x);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LinkGroups({ hunkId, onOpenChunk }: LinkGroupsProps) {
  const { view } = useCourse();
  const g = linkGroups(view, hunkId);
  const open = (e: LinkEntry) => onOpenChunk(e.hunkId, e.symbols);
  return (
    <>
      <Group label="Uses" entries={g.uses} onOpen={open} />
      <Group label="Used by" entries={g.usedBy} onOpen={open} />
      <Group label="Tested by" entries={g.tests} onOpen={open} />
    </>
  );
}
