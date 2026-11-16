export type Card = {
  id: string;
  title: string;
  details: string;
};

export type Column = {
  id: string;
  title: string;
  cards: Card[];
};

const makePersistedId = (prefix: string, seed: number) => `${prefix}-${seed}`;

const makeRuntimeId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const DEFAULT_COLUMNS: Column[] = [
  {
    id: "backlog",
    title: "Backlog",
    cards: [
      { id: makePersistedId("card", 1), title: "Draft onboarding", details: "Outline the first-run experience for new users." },
      { id: makePersistedId("card", 2), title: "Research analytics", details: "Review the event map and reporting needs." },
    ],
  },
  {
    id: "todo",
    title: "To do",
    cards: [
      { id: makePersistedId("card", 3), title: "Design sprint plan", details: "Align the product and engineering priorities." },
    ],
  },
  {
    id: "in-progress",
    title: "In progress",
    cards: [
      { id: makePersistedId("card", 4), title: "Prototype dashboard", details: "Validate card interactions and spacing." },
    ],
  },
  {
    id: "review",
    title: "Review",
    cards: [
      { id: makePersistedId("card", 5), title: "QA checklist", details: "Review the board interactions and final details." },
    ],
  },
  {
    id: "done",
    title: "Done",
    cards: [
      { id: makePersistedId("card", 6), title: "Kickoff brief", details: "Locked in scope and success criteria." },
    ],
  },
];

export const createCard = (title = "New card", details = "Add some details here.") => ({
  id: makeRuntimeId("card"),
  title,
  details,
});

export const addCardToColumn = (columns: Column[], columnId: string, title = "New card", details = "Add some details here.") =>
  columns.map((column) =>
    column.id === columnId
      ? { ...column, cards: [...column.cards, createCard(title, details)] }
      : column,
  );

export const deleteCardFromColumn = (columns: Column[], columnId: string, cardId: string) =>
  columns.map((column) =>
    column.id === columnId
      ? { ...column, cards: column.cards.filter((card) => card.id !== cardId) }
      : column,
  );

export const renameColumnTitle = (columns: Column[], columnId: string, title: string) =>
  columns.map((column) => (column.id === columnId ? { ...column, title } : column));

export const editCardInColumn = (
  columns: Column[],
  columnId: string,
  cardId: string,
  changes: Pick<Card, "title" | "details">,
) => columns.map((column) => column.id === columnId
  ? { ...column, cards: column.cards.map((card) => card.id === cardId ? { ...card, ...changes } : card) }
  : column);

export const moveCardBetweenColumns = (
  columns: Column[],
  sourceColumnId: string,
  targetColumnId: string,
  cardId: string,
) => {
  if (sourceColumnId === targetColumnId) return columns;

  const nextColumns = columns.map((column) => ({ ...column, cards: [...column.cards] }));
  const sourceIndex = nextColumns.findIndex((column) => column.id === sourceColumnId);
  const targetIndex = nextColumns.findIndex((column) => column.id === targetColumnId);

  if (sourceIndex === -1 || targetIndex === -1) {
    return columns;
  }

  const card = nextColumns[sourceIndex].cards.find((item) => item.id === cardId);

  if (!card) {
    return columns;
  }

  nextColumns[sourceIndex].cards = nextColumns[sourceIndex].cards.filter((item) => item.id !== cardId);
  nextColumns[targetIndex].cards = [...nextColumns[targetIndex].cards, card];

  return nextColumns;
};
