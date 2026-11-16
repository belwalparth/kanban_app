"use client";

import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { Card, Column } from "@/lib/board";

type CardEditorProps = {
  card?: Card;
  columnId: string;
  columns: Column[];
  onSave: (title: string, details: string, columnId: string) => void;
  onClose: () => void;
};

export function CardEditor({ card, columnId, columns, onSave, onClose }: CardEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(card?.title ?? "");
  const [details, setDetails] = useState(card?.details ?? "");
  const [destination, setDestination] = useState(columnId);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const trigger = document.activeElement as HTMLElement;
    dialog.showModal();
    titleRef.current!.focus();
    return () => {
      dialog.close();
      trigger.focus();
    };
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim()) onSave(title.trim(), details.trim(), destination);
  }

  return (
    <dialog ref={dialogRef} className="card-dialog" aria-labelledby="card-editor-heading" onCancel={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">A little clarity goes a long way</p>
            <h2 id="card-editor-heading">{card ? "Edit card" : "New card"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close card editor">&times;</button>
        </div>
        <label htmlFor="card-title">Title</label>
        <input ref={titleRef} id="card-title" required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to get done?" />
        <label htmlFor="card-details">Details</label>
        <textarea id="card-details" rows={4} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Add a little context..." />
        <label htmlFor="card-column">Column</label>
        <select id="card-column" value={destination} onChange={(event) => setDestination(event.target.value)}>
          {columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
        </select>
        <div className="dialog-actions">
          <button type="button" className="quiet-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={!title.trim()}>{card ? "Save changes" : "Create card"}</button>
        </div>
      </form>
    </dialog>
  );
}
