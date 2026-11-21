"use client";
import { useEffect, useRef, useState } from "react";

export function ColumnTitle({ title, disabled, onRename, columnId, onEditingChange }: {
  title: string; disabled: boolean; onRename: (title: string) => Promise<boolean>;
  columnId: string; onEditingChange: (id: string, dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const cancel = useRef(false);
  useEffect(() => () => onEditingChange(columnId, false), [columnId, onEditingChange]);
  function clearDraft() { setDraft(null); onEditingChange(columnId, false); }
  async function commit() {
    if (cancel.current) { cancel.current = false; return; }
    if (draft === null) return;
    const next = draft.trim();
    if (!next) { clearDraft(); setError("Column name cannot be blank."); return; }
    if (next === title) { clearDraft(); return; }
    if (await onRename(next)) { clearDraft(); setError(""); }
    else setError("Column name was not saved.");
  }
  return <div className="column-name">
    <input aria-label={`Rename ${title}`} value={draft ?? title} disabled={disabled} aria-invalid={!!error}
      onChange={(event) => { setDraft(event.target.value); onEditingChange(columnId, true); setError(""); }} onBlur={() => { void commit(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") { cancel.current = true; clearDraft(); setError(""); event.currentTarget.blur(); }
      }} />
    {error && <small className="column-error">{error}</small>}
  </div>;
}
