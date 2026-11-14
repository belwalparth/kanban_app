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

const makeId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export const DEFAULT_COLUMNS: Column[] = [
  {
    id: "backlog",
    title: "Backlog",
    cards: [
      { id: makeId("card"), title: "Draft onboarding", details: "Outline the first-run experience for new users." },
      { id: makeId("card"), title: "Research analytics", details: "Review the event map and reporting needs." },
    ],
  },
  {
    id: "todo",
    title: "To do",
    cards: [
      { id: makeId("card"), title: "Design sprint plan", details: "Align the product and engineering priorities." },
    ],
  },
  {
    id: "in-progress",
    title: "In progress",
    cards: [
      { id: makeId("card"), title: "Prototype dashboard", details: "Validate card interactions and spacing." },
    ],
  },
  {
    id: "review",
    title: "Review",
    cards: [
      { id: makeId("card"), title: "QA checklist", details: "Confirm the no-persistence and fixed-board constraints." },
    ],
  },
  {
    id: "done",
    title: "Done",
    cards: [
      { id: makeId("card"), title: "Kickoff brief", details: "Locked in scope and success criteria." },
    ],
  },
];

export const createCard = (title = "New card", details = "Add some details here.") => ({
  id: makeId("card"),
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
