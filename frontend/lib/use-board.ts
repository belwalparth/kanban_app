"use client";

import { useEffect, useRef, useState } from "react";
import { BoardApiError, loadBoard, saveBoard, type BoardState } from "./board-api";
import type { Column } from "./board";
import { sendChat, type ChatMessage, type ChatResult } from "./chat-api";

export function useBoard(onSessionExpired?: () => void) {
  const [state, setState] = useState<BoardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [generation, setGeneration] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    loadBoard().then((board) => {
      if (active) { setState(board); setBlocked(false); setError(""); setGeneration((value) => value + 1); }
    }).catch((failure) => {
      if (!active) return;
      if (failure instanceof BoardApiError && failure.status === 401) onSessionExpired?.();
      setError(failure instanceof BoardApiError && failure.status === 401
        ? "Your session expired. Please sign in again." : "Couldn't load your board. Please try again.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, onSessionExpired]);

  function reload() {
    if (inFlight.current) return;
    setLoading(true);
    setAttempt((value) => value + 1);
  }
  async function save(columns: Column[]): Promise<"saved" | "failed" | "conflict"> {
    if (!state || inFlight.current || loading || blocked) return "failed";
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await saveBoard({ revision: state.revision, board: { columns } });
      if (!mounted.current) return "failed";
      setState(saved);
      return "saved";
    } catch (failure) {
      if (!mounted.current) return "failed";
      if (failure instanceof BoardApiError && failure.status === 401) {
        onSessionExpired?.();
        setError("Your session expired. Please sign in again.");
      } else if (failure instanceof BoardApiError && failure.status === 409) {
        setBlocked(true);
        try {
          const latest = await loadBoard();
          if (!mounted.current) return "failed";
          setState(latest);
          setGeneration((value) => value + 1);
          setBlocked(false);
          setError("This board changed elsewhere. The latest version is loaded; your edit was not saved.");
        } catch (reloadFailure) {
          if (!mounted.current) return "failed";
          if (reloadFailure instanceof BoardApiError && reloadFailure.status === 401) onSessionExpired?.();
          setError("This board changed elsewhere. Couldn't load the latest version. Reload the board before editing.");
        }
        return "conflict";
      } else if (failure instanceof BoardApiError && [413, 422].includes(failure.status)) {
        setError("The board couldn't be accepted. Check your changes and shorten large card text before saving again.");
      } else setError("Couldn't save your changes. Please try again.");
      return "failed";
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  async function chat(message: string, history: ChatMessage[]): Promise<ChatResult> {
    if (!state || inFlight.current || loading || blocked) return { error: "Wait for the board to be ready before sending." };
    inFlight.current = true;
    setChatting(true);
    setError("");
    try {
      const response = await sendChat(state.revision, message, history);
      if (!mounted.current) return { error: "Your session has ended." };
      setState(response.state);
      setGeneration((value) => value + 1);
      return { response };
    } catch (failure) {
      if (!mounted.current) return { error: "Your session has ended." };
      const status = failure instanceof BoardApiError ? failure.status : 0;
      if (status === 401) {
        onSessionExpired?.();
        return { error: "Your session expired. Please sign in again." };
      }
      if (status === 409) {
        setBlocked(true);
        try {
          const latest = await loadBoard();
          if (!mounted.current) return { error: "Your session has ended." };
          setState(latest);
          setGeneration((value) => value + 1);
          setBlocked(false);
          return { error: "This board changed elsewhere. The latest version is loaded. Review it before sending again." };
        } catch (reloadFailure) {
          if (!mounted.current) return { error: "Your session has ended." };
          if (reloadFailure instanceof BoardApiError && reloadFailure.status === 401) onSessionExpired?.();
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
      if (mounted.current) setChatting(false);
    }
  }
  return { state, loading, saving, chatting, blocked, error, generation, save, reload, chat };
}
