"use client";
import { useRef, useState } from "react";

export function ColumnTitle({ title, disabled, onRename }: {
  title: string; disabled: boolean; onRename: (title: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const cancel = useRef(false);
  async function commit() {
    if (cancel.current) { cancel.current = false; return; }
    if (draft === null) return;
    const next = draft.trim();
    if (!next) { setDraft(null); setError("Column name cannot be blank."); return; }
    if (next === title) { setDraft(null); return; }
    if (await onRename(next)) { setDraft(null); setError(""); }
    else setError("Column name was not saved.");
  }
  return <div className="column-name">
    <input aria-label={`Rename ${title}`} value={draft ?? title} disabled={disabled} aria-invalid={!!error}
      onChange={(event) => { setDraft(event.target.value); setError(""); }} onBlur={() => { void commit(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") { cancel.current = true; setDraft(null); setError(""); event.currentTarget.blur(); }
      }} />
    {error && <small className="column-error">{error}</small>}
  </div>;
}
