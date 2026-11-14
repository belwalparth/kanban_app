'use client';

import { useMemo, useState, type DragEvent } from "react";
import {
  DEFAULT_COLUMNS,
  addCardToColumn,
  deleteCardFromColumn,
  moveCardBetweenColumns,
  renameColumnTitle,
  type Column,
} from "@/lib/board";

export function KanbanBoard() {
  const [columns, setColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [draggedCard, setDraggedCard] = useState<{ cardId: string; sourceColumnId: string } | null>(null);

  const totalCards = useMemo(
    () => columns.reduce((sum, column) => sum + column.cards.length, 0),
    [columns],
  );

  const handleAddCard = (columnId: string) => {
    setColumns((current) => addCardToColumn(current, columnId));
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    setColumns((current) => deleteCardFromColumn(current, columnId, cardId));
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    setColumns((current) => renameColumnTitle(current, columnId, title));
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>, cardId: string, sourceColumnId: string) => {
    event.dataTransfer.setData("text/plain", cardId);
    event.dataTransfer.effectAllowed = "move";
    setDraggedCard({ cardId, sourceColumnId });
  };

  const handleDrop = (targetColumnId: string) => {
    if (!draggedCard) {
      return;
    }

    setColumns((current) =>
      moveCardBetweenColumns(current, draggedCard.sourceColumnId, targetColumnId, draggedCard.cardId),
    );
    setDraggedCard(null);
  };

  return (
    <div className="board-shell">
      <header className="board-header">
        <div>
          <p className="eyebrow">Project board</p>
          <h1>Kanban workflow</h1>
        </div>
        <div className="board-stat">
          <span>{totalCards}</span>
          <small>cards</small>
        </div>
      </header>

      <div className="board-grid">
        {columns.map((column) => (
          <section
            key={column.id}
            className="column"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => handleDrop(column.id)}
          >
            <div className="column-header">
              <input
                aria-label={`Rename ${column.title}`}
                value={column.title}
                onChange={(event) => handleRenameColumn(column.id, event.target.value)}
              />
              <button type="button" className="secondary-button" onClick={() => handleAddCard(column.id)}>
                Add card
              </button>
            </div>

            <div className="card-list">
              {column.cards.length === 0 ? (
                <div className="empty-state">Drop a card here</div>
              ) : (
                column.cards.map((card) => (
                  <div
                    key={card.id}
                    className="card"
                    draggable
                    onDragStart={(event) => handleDragStart(event, card.id, column.id)}
                    onDragEnd={() => setDraggedCard(null)}
                  >
                    <div className="card-header-row">
                      <h3>{card.title}</h3>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Delete ${card.title}`}
                        onClick={() => handleDeleteCard(column.id, card.id)}
                      >
                        ×
                      </button>
                    </div>
                    <p>{card.details}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
