"use client";

import { useEffect, useRef, useState } from "react";
import { BoardApiError, loadBoard, saveBoard, type BoardState } from "./board-api";
import type { Column } from "./board";

export function useBoard(onSessionExpired?: () => void) {
  const [state, setState] = useState<BoardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      } else setError("Couldn't save your changes. Please try again.");
      return "failed";
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return { state, loading, saving, blocked, error, generation, save, reload };
}
