"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BoardView } from "./BoardView";
import { BoardApiError, createBoard, listBoards, renameBoard, type BoardSummary } from "@/lib/board-api";
import type { ChatMemory } from "@/lib/chat-api";

function requestedBoard() { return new URLSearchParams(window.location.search).get("board"); }
function writeBoardURL(id: number, replace = false) {
  const url = new URL(window.location.href);
  url.searchParams.set("board", String(id));
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
}

export function KanbanBoard({ username, onSignOut, signingOut = false, onSessionExpired }: {
  username?: string;
  onSignOut?: () => void;
  signingOut?: boolean;
  onSessionExpired?: () => void;
}) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [requested, setRequested] = useState<string | null>(() => typeof window === "undefined" ? null : requestedBoard());
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [locks, setLocks] = useState({ request: false, draft: false, form: false, management: false });
  const lockRef = useRef(locks);
  const queued = useRef<{ requested: string | null } | null>(null);
  const mounted = useRef(false);
  const [mode, setMode] = useState<"create" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [managementError, setManagementError] = useState("");
  const [chatMemory, setChatMemory] = useState<Record<number, ChatMemory>>({});
  const nameInput = useRef<HTMLInputElement>(null);
  const formTrigger = useRef<HTMLElement | null>(null);

  const changeLock = useCallback((kind: keyof typeof locks, value: boolean) => {
    lockRef.current = { ...lockRef.current, [kind]: value };
    setLocks(lockRef.current);
    if (!Object.values(lockRef.current).some(Boolean) && queued.current) {
      setRequested(queued.current.requested);
      queued.current = null;
      setWaiting(false);
    }
  }, []);
  const onPendingChange = useCallback((value: boolean) => changeLock("request", value), [changeLock]);
  const onDraftChange = useCallback((value: boolean) => changeLock("draft", value), [changeLock]);
  const onRevisionChange = useCallback((id: number, revision: number) => {
    setBoards(previous => previous.map(board => board.id === id ? { ...board, revision } : board));
  }, []);

  useEffect(() => {
    mounted.current = true;
    function navigate() {
      const requested = requestedBoard();
      if (Object.values(lockRef.current).some(Boolean)) { queued.current = { requested }; setWaiting(true); }
      else setRequested(requested);
    }
    window.addEventListener("popstate", navigate);
    return () => { mounted.current = false; window.removeEventListener("popstate", navigate); };
  }, []);
  useEffect(() => {
    let active = true;
    listBoards().then(items => {
      if (!active) return;
      setBoards(items);
      const requested = requestedBoard();
      if (requested === null && items.length) { writeBoardURL(items[0].id, true); setRequested(String(items[0].id)); }
      else setRequested(requested);
      setListError("");
    }).catch(failure => {
      if (!active) return;
      if (failure instanceof BoardApiError && failure.status === 401) onSessionExpired?.();
      setListError("Couldn't load your boards. Please try again.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, onSessionExpired]);
  useEffect(() => { if (mode) nameInput.current?.focus(); else formTrigger.current?.focus(); }, [mode]);

  const selected = requested === null ? boards[0] : boards.find(board => String(board.id) === requested);
  const pickerLocked = signingOut || Object.values(locks).some(Boolean);
  function selectBoard(id: number) {
    if (Object.values(lockRef.current).some(Boolean)) return;
    writeBoardURL(id);
    setRequested(String(id));
  }
  function openForm(next: "create" | "rename", trigger: HTMLElement) {
    if (Object.values(lockRef.current).some(Boolean)) return;
    formTrigger.current = trigger;
    setName(next === "rename" ? selected?.name ?? "" : "");
    setManagementError("");
    setMode(next);
    changeLock("form", true);
  }
  function closeForm() { setMode(null); changeLock("form", false); }
  function reloadList() { if (pickerLocked) return; setLoading(true); setAttempt(value => value + 1); }
  async function submitName(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || name.trim().length > 100 || lockRef.current.management || lockRef.current.request || lockRef.current.draft) return;
    changeLock("management", true);
    setManagementError("");
    try {
      const result = mode === "create" ? await createBoard(name.trim())
        : await renameBoard(selected!.id, name.trim(), selected!.revision);
      if (!mounted.current) return;
      setBoards(previous => mode === "create" ? [...previous, result] : previous.map(board => board.id === result.id ? result : board));
      if (mode === "create") {
        if (!queued.current) { writeBoardURL(result.id); setRequested(String(result.id)); }
      }
      else setRefresh(value => value + 1);
      closeForm();
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof BoardApiError && failure.status === 401) onSessionExpired?.();
      if (failure instanceof BoardApiError && failure.status === 409) {
        setManagementError("This board changed elsewhere. Review the latest board before renaming again.");
        try {
          const latest = await listBoards();
          if (!mounted.current) return;
          setBoards(latest);
        } catch (listFailure) {
          if (!mounted.current) return;
          if (listFailure instanceof BoardApiError && listFailure.status === 401) onSessionExpired?.();
        }
        setRefresh(value => value + 1);
      } else setManagementError(mode === "create" ? "Couldn't create the board. Your current board is unchanged; try again."
        : "Couldn't rename the board. Check the name and try again.");
    } finally { if (mounted.current) changeLock("management", false); }
  }

  return <div className="workspace">
    <header className="workspace-bar">
      <div className="wordmark"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>Kanban<span className="wordmark-divider" /> <span className="workspace-name">My workspace</span></div>
      <div className="workspace-actions"><span className="workspace-badge"><span aria-hidden="true" />{username ?? "Demo workspace"}</span>
        {onSignOut && <button type="button" className="quiet-button" onClick={onSignOut} disabled={signingOut || locks.request || locks.management}>{signingOut ? "Signing out..." : "Sign out"}</button>}
      </div>
    </header>
    <div className="workspace-content"><div className="board-shell">
      {loading || listError ? <div className="session-retry">
        {loading ? <p role="status">Loading your boards...</p> : <><p role="alert">{listError}</p><button className="primary-button" onClick={reloadList}>Try again</button></>}
      </div> : <>
        <div className="board-picker">
          <label htmlFor="board-picker">Board</label>
          <select id="board-picker" value={selected?.id ?? ""} disabled={pickerLocked} onChange={event => selectBoard(Number(event.target.value))}>
            {!selected && <option value="">Choose a board</option>}
            {boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}
          </select>
          <button className="quiet-button" type="button" disabled={pickerLocked} onClick={event => openForm("create", event.currentTarget)}>New board</button>
          <button className="quiet-button" type="button" disabled={pickerLocked || !selected} onClick={event => openForm("rename", event.currentTarget)}>Rename board</button>
          <button className="quiet-button" type="button" disabled={pickerLocked} onClick={reloadList}>Reload list</button>
        </div>
        {mode && <form className="board-name-form" aria-label={mode === "create" ? "Create board" : "Rename board"} onSubmit={submitName}>
          <label htmlFor="board-name">Board name</label>
          <input id="board-name" ref={nameInput} value={name} maxLength={100} required disabled={locks.management} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && !locks.management) { event.preventDefault(); closeForm(); } }} />
          <button className="primary-button" disabled={locks.management || !name.trim()}>{locks.management ? "Saving..." : mode === "create" ? "Create board" : "Save board name"}</button>
          <button type="button" className="quiet-button" disabled={locks.management} onClick={closeForm}>Cancel</button>
          {managementError && <p role="alert">{managementError}</p>}
        </form>}
        {waiting && <p role="status" className="board-switch-notice">Finish the current edit or wait for it to save. Your board will switch afterward.</p>}
        {selected ? <BoardView key={`${selected.id}:${refresh}`} boardId={selected.id} name={selected.name}
          locked={signingOut || !!mode || locks.management} onSessionExpired={onSessionExpired}
          onPendingChange={onPendingChange} onDraftChange={onDraftChange} onRevisionChange={onRevisionChange}
          chatMemory={chatMemory[selected.id]} onChatMemoryChange={memory => setChatMemory(previous => ({ ...previous, [selected.id]: memory }))} />
          : <div className="session-retry"><p role="alert">{boards.length ? "This board is unavailable. Choose another board or reload the list." : "You have no boards. Create a board to get started."}</p></div>}
      </>}
    </div></div>
  </div>;
}
