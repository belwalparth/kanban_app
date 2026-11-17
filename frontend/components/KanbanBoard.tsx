"use client";

import { useState, type DragEvent } from "react";
import { CardEditor } from "@/components/CardEditor";
import { ColumnTitle } from "@/components/ColumnTitle";
import { ChatSidebar } from "@/components/ChatSidebar";
import { useBoard } from "@/lib/use-board";
import {
  addCardToColumn, deleteCardFromColumn, editCardInColumn,
  moveCardBetweenColumns, renameColumnTitle, type Card,
} from "@/lib/board";

export function KanbanBoard({ username, onSignOut, signingOut = false, onSessionExpired }: {
  username?: string;
  onSignOut?: () => void;
  signingOut?: boolean;
  onSessionExpired?: () => void;
}) {
  const { state, loading, saving, chatting, blocked, error, generation, save, reload, chat } = useBoard(onSessionExpired);
  const [draggedCard, setDraggedCard] = useState<{ cardId: string; sourceColumnId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ columnId: string; card?: Card } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const columns = state?.board.columns ?? [];
  const busy = saving || chatting || loading || blocked || signingOut;
  const totalCards = columns.reduce((sum, column) => sum + column.cards.length, 0);
  const completedCards = columns.find((column) => column.id === "done")?.cards.length ?? 0;
  const progress = totalCards ? Math.round(completedCards / totalCards * 100) : 0;

  function endDrag() {
    setDraggedCard(null);
    setDropTarget(null);
  }

  function handleDragStart(event: DragEvent<HTMLElement>, cardId: string, sourceColumnId: string) {
    event.dataTransfer.setData("text/plain", cardId);
    event.dataTransfer.effectAllowed = "move";
    setDraggedCard({ cardId, sourceColumnId });
  }

  async function handleDrop(targetColumnId: string) {
    if (draggedCard && !busy && draggedCard.sourceColumnId !== targetColumnId) {
      const moved = moveCardBetweenColumns(columns, draggedCard.sourceColumnId, targetColumnId, draggedCard.cardId);
      if (await save(moved) === "saved") setAnnouncement(`Card moved to ${columns.find((column) => column.id === targetColumnId)!.title}.`);
    }
    endDrag();
  }

  async function saveCard(title: string, details: string, targetColumnId: string) {
    if (!editor) return;
    const { card, columnId } = editor;
    const result = await save(card
      ? moveCardBetweenColumns(editCardInColumn(columns, columnId, card.id, { title, details }), columnId, targetColumnId, card.id)
      : addCardToColumn(columns, targetColumnId, title, details));
    if (result === "saved") setAnnouncement(`${title} ${card ? "updated" : "created"}.`);
    if (result !== "failed") setEditor(null);
  }

  if (!state) return <div className="session-retry">
    {loading ? <p role="status">Loading your board...</p> : <><p role="alert">{error}</p><button className="primary-button" onClick={reload}>Try again</button></>}
    {onSignOut && <button className="quiet-button" onClick={onSignOut} disabled={signingOut}>Sign out</button>}
  </div>;

  return (
    <div className="workspace">
      <header className="workspace-bar">
        <div className="wordmark"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>Kanban<span className="wordmark-divider" /> <span className="workspace-name">My workspace</span></div>
        <div className="workspace-actions"><span className="workspace-badge"><span aria-hidden="true" />{username ?? "Demo workspace"}</span>
          {onSignOut && <button type="button" className="quiet-button" onClick={onSignOut} disabled={signingOut || saving || chatting}>{signingOut ? "Signing out..." : "Sign out"}</button>}
        </div>
      </header>

      <div className="workspace-content">
      <div className="board-shell">
        {error && !editor && <div className="board-error"><p role="alert">{error}</p><button className="quiet-button" onClick={reload} disabled={saving || chatting || loading}>Reload board</button></div>}
        <div className="breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><span>Project board</span></div>
        <header className="board-header">
          <div className="board-header-copy">
            <p className="eyebrow">Small steps. Meaningful progress.</p>
            <h1>Project board<span className="heading-dot">.</span></h1>
            <p className="board-subtitle">A little structure for your next big idea.</p>
          </div>
          <div className="progress-summary">
            <div className="progress-label"><span>Project progress</span><strong>{progress}%</strong></div>
            <div role="progressbar" aria-label="Project progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="progress-track"><span style={{ width: `${progress}%` }} /></div>
            <p>{completedCards} of {totalCards} cards complete</p>
          </div>
        </header>

        <div className="board-toolbar">
          <div className="board-view"><span className="board-view-icon" aria-hidden="true"><i /><i /><i /></span>Board view<span className="total-count" aria-label={`${totalCards} cards on this board`}>{totalCards}</span></div>
          <p>Drag to move. Edit to add the details.</p>
        </div>

        <div className="board-scroll" role="region" aria-label="Kanban columns" tabIndex={0}>
          <div className="board-grid">
            {columns.map((column, index) => (
              <section key={column.id} data-column={column.id} className={`column${dropTarget === column.id ? " column-drop-ready" : ""}`} aria-label={`${column.title} column`}
                onDragOver={(event) => { event.preventDefault(); if (draggedCard) setDropTarget(column.id); }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
                onDrop={(event) => { event.preventDefault(); void handleDrop(column.id); }}>
                <div className="column-header">
                  <span className="column-dot" aria-hidden="true" />
                  <ColumnTitle key={`${column.id}:${generation}`} title={column.title} disabled={busy}
                    onRename={async (title) => await save(renameColumnTitle(columns, column.id, title)) === "saved"} />
                  <span className="card-count" aria-label={`${column.cards.length} cards`}>{column.cards.length}</span>
                </div>
                <div className="column-rule" />
                <div className="card-list">
                  {column.cards.map((card) => (
                    <article key={card.id} aria-label={card.title} className={`card${draggedCard?.cardId === card.id ? " card-dragging" : ""}`} draggable={!editor && !busy}
                      onDragStart={(event) => handleDragStart(event, card.id, column.id)} onDragEnd={endDrag}>
                      <div className="card-topline"><span className="card-label">TASK</span><span className="drag-handle" aria-hidden="true">⠿</span></div>
                      <h3>{card.title}</h3>
                      <p className="card-details">{card.details || "No details yet."}</p>
                      <div className="card-footer">
                        <button type="button" className="edit-button" disabled={busy} aria-label={`Edit ${card.title}`} onClick={() => setEditor({ columnId: column.id, card })}>Edit card<span aria-hidden="true"> ↗</span></button>
                        <button type="button" className="delete-button" disabled={busy} aria-label={`Delete ${card.title}`} onClick={async () => { if (await save(deleteCardFromColumn(columns, column.id, card.id)) === "saved") setAnnouncement(`${card.title} deleted.`); }}>Delete</button>
                      </div>
                    </article>
                  ))}
                  {column.cards.length === 0 && <div className="empty-state">A little breathing room.<span>Drop a card here to keep things moving.</span></div>}
                </div>
                <button type="button" className="add-card-button" disabled={busy} aria-label={`Add card to ${column.title}`} onClick={() => setEditor({ columnId: column.id })}><span aria-hidden="true">+</span>Add card</button>
                <span className="column-number" aria-hidden="true">0{index + 1}</span>
              </section>
            ))}
          </div>
        </div>
        <footer className="board-note"><span className="note-dot" aria-hidden="true" /><p role="status">{chatting ? "AI request in progress..." : saving ? "Saving changes..." : loading ? "Loading your board..." : error ? "Some changes were not saved." : "Your board is saved."}</p></footer>
      </div>
      <ChatSidebar pending={chatting} disabled={saving || loading || blocked || signingOut || !!editor} onSend={chat} />
      </div>
      <p aria-live="polite" className="sr-only">{announcement}</p>
      {editor && <CardEditor card={editor.card} columnId={editor.columnId} columns={columns} pending={busy} error={error} onSave={saveCard} onClose={() => setEditor(null)} />}
    </div>
  );
}
