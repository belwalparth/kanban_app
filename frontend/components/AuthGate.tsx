"use client";

import { useEffect, useRef, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { SignIn } from "@/components/SignIn";
import { getSession, signOut, type User } from "@/lib/auth";

export function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const sessionVersion = useRef(0);

  useEffect(() => {
    let active = true;
    async function checkSession() {
      const version = sessionVersion.current;
      try {
        const currentUser = await getSession();
        if (active && version === sessionVersion.current) { setUser(currentUser); setError(""); }
      } catch {
        if (active && version === sessionVersion.current) setError("Couldn't check your session. Please try again.");
      } finally {
        if (active && version === sessionVersion.current) setChecking(false);
      }
    }
    void checkSession();
    window.addEventListener("focus", checkSession);
    return () => { active = false; window.removeEventListener("focus", checkSession); };
  }, [attempt]);

  async function handleSignOut() {
    setSigningOut(true);
    setError("");
    try {
      await signOut();
      sessionVersion.current += 1;
      setUser(null);
    } catch {
      setError("Couldn't sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  if (checking) return <div className="session-check" role="status">Checking your session...</div>;
  if (user) return <>
    {error && <p className="auth-banner" role="alert">{error}</p>}
    <KanbanBoard username={user.username} onSignOut={handleSignOut} signingOut={signingOut} />
  </>;

  return <>
    <header className="workspace-bar"><div className="wordmark"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>Kanban</div><span className="workspace-badge"><span aria-hidden="true" />Demo workspace</span></header>
    {error ? <div className="session-retry"><p role="alert">{error}</p><button type="button" className="primary-button" onClick={() => { setChecking(true); setAttempt((current) => current + 1); }}>Try again</button></div>
      : <SignIn onSignedIn={(currentUser) => { sessionVersion.current += 1; setError(""); setUser(currentUser); }} />}
  </>;
}
