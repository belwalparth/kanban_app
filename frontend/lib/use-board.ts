"use client";

import { useEffect, useRef, useState } from "react";
import { BoardApiError, loadBoard, saveBoard, type BoardState } from "./board-api";
import type { Column } from "./board";
import { sendChat, type ChatMessage, type ChatResult } from "./chat-api";

export function useBoard(onSessionExpired: (() => void) | undefined, boardId: number,
  onPendingChange: (pending: boolean) => void, onRevisionChange: (id: number, revision: number) => void,
  onAccessLost: (id: number) => void, canRefresh: () => boolean) {
  const [state, setState] = useState<BoardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const version = useRef(0);

  useEffect(() => {
    let active = true;
    let latestFocus = 0;
    async function focus() {
      const focusId = ++latestFocus;
      const startedAt = version.current;
      try {
        const latest = await loadBoard(boardId);
        if (!active || focusId !== latestFocus || startedAt !== version.current || inFlight.current || !canRefresh()) return;
        setState(previous => latest.revision >= (previous?.revision ?? -1) ? latest : previous);
        onRevisionChange(boardId, latest.revision);
      } catch (failure) {
        if (!active || focusId !== latestFocus) return;
        if (failure instanceof BoardApiError && failure.status === 401) onSessionExpired?.();
        if (failure instanceof BoardApiError && failure.status === 404) onAccessLost(boardId);
      }
    }
    window.addEventListener("focus", focus);
    return () => { active = false; window.removeEventListener("focus", focus); };
  }, [boardId, canRefresh, onAccessLost, onRevisionChange, onSessionExpired]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    loadBoard(boardId).then((board) => {
      if (active) { setState(board); onRevisionChange(boardId, board.revision); setBlocked(false); setError(""); }
    }).catch((failure) => {
      if (!active) return;
      if (failure instanceof BoardApiError && failure.status === 401) onSessionExpired?.();
      if (failure instanceof BoardApiError && failure.status === 404) onAccessLost(boardId);
      setError(failure instanceof BoardApiError && failure.status === 401
        ? "Your session expired. Please sign in again." : failure instanceof BoardApiError && failure.status === 404
          ? "This board is unavailable. Choose another board or reload the list." : "Couldn't load your board. Please try again.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, boardId, onSessionExpired, onRevisionChange, onAccessLost]);

  function reload() {
    if (inFlight.current) return;
    version.current += 1;
    setLoading(true);
    setAttempt((value) => value + 1);
  }
  async function save(columns: Column[]): Promise<"saved" | "failed" | "conflict"> {
    if (!state || inFlight.current || loading || blocked) return "failed";
    inFlight.current = true;
    version.current += 1;
    onPendingChange(true);
    setSaving(true);
    setError("");
    try {
      const saved = await saveBoard({ revision: state.revision, board: { columns } }, boardId);
      if (!mounted.current) return "failed";
      setState(saved);
      onRevisionChange(boardId, saved.revision);
      return "saved";
    } catch (failure) {
      if (!mounted.current) return "failed";
      if (failure instanceof BoardApiError && failure.status === 401) {
        onSessionExpired?.();
        setError("Your session expired. Please sign in again.");
      } else if (failure instanceof BoardApiError && failure.status === 404) {
        onAccessLost(boardId);
      } else if (failure instanceof BoardApiError && failure.status === 409) {
        setBlocked(true);
        try {
          const latest = await loadBoard(boardId);
          if (!mounted.current) return "failed";
          setState(latest);
          onRevisionChange(boardId, latest.revision);
          setBlocked(false);
          setError("This board changed elsewhere. The latest version is loaded; your edit was not saved.");
        } catch (reloadFailure) {
          if (!mounted.current) return "failed";
          if (reloadFailure instanceof BoardApiError && reloadFailure.status === 401) onSessionExpired?.();
          if (reloadFailure instanceof BoardApiError && reloadFailure.status === 404) onAccessLost(boardId);
          setError("This board changed elsewhere. Couldn't load the latest version. Reload the board before editing.");
        }
        return "conflict";
      } else if (failure instanceof BoardApiError && [413, 422].includes(failure.status)) {
        setError("The board couldn't be accepted. Check your changes and shorten large card text before saving again.");
      } else setError("Couldn't save your changes. Please try again.");
      return "failed";
    } finally {
      inFlight.current = false;
      if (mounted.current) { setSaving(false); onPendingChange(false); }
    }
  }
  async function chat(message: string, history: ChatMessage[]): Promise<ChatResult> {
    if (!state || inFlight.current || loading || blocked) return { error: "Wait for the board to be ready before sending." };
    inFlight.current = true;
    version.current += 1;
    onPendingChange(true);
    setChatting(true);
    setError("");
    try {
      const response = await sendChat(state.revision, message, history, boardId);
      if (!mounted.current) return { error: "Your session has ended." };
      setState(response.state);
      onRevisionChange(boardId, response.state.revision);
      return { response };
    } catch (failure) {
      if (!mounted.current) return { error: "Your session has ended." };
      const status = failure instanceof BoardApiError ? failure.status : 0;
      if (status === 401) {
        onSessionExpired?.();
        return { error: "Your session expired. Please sign in again." };
      }
      if (status === 404) { onAccessLost(boardId); return { error: "Your access to this board has ended." }; }
      if (status === 409) {
        setBlocked(true);
        try {
          const latest = await loadBoard(boardId);
          if (!mounted.current) return { error: "Your session has ended." };
          setState(latest);
          onRevisionChange(boardId, latest.revision);
          setBlocked(false);
          return { error: "This board changed elsewhere. The latest version is loaded. Review it before sending again." };
        } catch (reloadFailure) {
          if (!mounted.current) return { error: "Your session has ended." };
          if (reloadFailure instanceof BoardApiError && reloadFailure.status === 401) onSessionExpired?.();
          if (reloadFailure instanceof BoardApiError && reloadFailure.status === 404) onAccessLost(boardId);
          setError("Couldn't load the latest board. Reload the board before editing or sending again.");
          return { error: "This board changed elsewhere. Reload the board before sending again." };
        }
      }
      if (![413, 422, 502, 503, 504].includes(status)) {
        setBlocked(true);
        setError("Couldn't confirm the AI result. Reload the board and review it before sending again.");
      }
      return { error: status === 502 ? "The AI returned an unusable response. You can try again."
        : status === 503 ? "AI is unavailable or busy. Please try again later."
        : status === 504 ? "The AI took too long to respond. You can try again."
        : status === 413 ? "This request is too large. Shorten your message and try again."
        : status === 422 ? "The message couldn't be accepted. Edit it and try again."
        : "Couldn't confirm the result. Reload the board and review it before sending again." };
    } finally {
      inFlight.current = false;
      if (mounted.current) { setChatting(false); onPendingChange(false); }
    }
  }
  return { state, loading, saving, chatting, blocked, error, save, reload, chat };
}
