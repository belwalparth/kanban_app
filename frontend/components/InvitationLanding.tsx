"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BoardApiError } from "@/lib/board-api";
import { acceptInvitation, inspectInvitation, type InvitationPreview } from "@/lib/sharing-api";

export function InvitationLanding({ token, username, onAccepted, onDismiss, onSignOut, onSessionExpired }: {
  token: string; username: string; onAccepted: (id: number) => void; onDismiss: () => void;
  onSignOut: () => Promise<void>; onSessionExpired: () => void;
}) {
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  const locked = useRef(false);
  const failure = useCallback((error: unknown) => {
    if (error instanceof BoardApiError && error.status === 401) onSessionExpired();
    setError(error instanceof BoardApiError && error.status === 403
      ? "Sign in with the Google account this invitation was sent to. If this is the right account, sign in again to verify its email."
      : error instanceof BoardApiError && [404, 409, 422].includes(error.status)
        ? "This invitation is unavailable. It may have expired, been revoked, or already been used. Ask the owner for a new link."
        : "Couldn't check this invitation. Please try again.");
  }, [onSessionExpired]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    inspectInvitation(token).then(value => { if (active) { setPreview(value); setError(""); } })
      .catch(error => { if (active) failure(error); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, attempt, failure]);
  async function accept() {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    try {
      const board = await acceptInvitation(token);
      if (mounted.current) onAccepted(board.id);
    } catch (error) { if (mounted.current) { setPreview(null); failure(error); } }
    finally { locked.current = false; if (mounted.current) setPending(false); }
  }
  return <section className="invitation-panel" aria-labelledby="invitation-heading">
    <p className="eyebrow">Work together</p><h1 id="invitation-heading">Board invitation</h1>
    <p>Signed in as {username}</p>
    {loading ? <p role="status">Checking your invitation...</p> : error ? <p role="alert">{error}</p>
      : preview && <p>{preview.status === "accepted" ? "You have already joined" : "You are invited to join"} <strong>{preview.name}</strong>.</p>}
    <div className="invitation-actions">
      {preview && !error && <button className="primary-button" disabled={pending} onClick={accept}>{pending ? "Joining..." : preview.status === "accepted" ? "Open shared board" : "Accept invitation"}</button>}
      {error && <button className="quiet-button" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Check again</button>}
      <button className="quiet-button" disabled={pending} onClick={async () => { if (!locked.current) { locked.current = true; setPending(true); try { await onSignOut(); } finally { locked.current = false; if (mounted.current) setPending(false); } } }}>Use another Google account</button>
      <button className="quiet-button" disabled={pending} onClick={onDismiss}>Go to my boards</button>
    </div>
  </section>;
}
