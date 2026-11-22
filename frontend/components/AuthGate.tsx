"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { SignIn } from "@/components/SignIn";
import { InvitationLanding } from "./InvitationLanding";
import { clearInvitation, pendingInvitation } from "@/lib/sharing-api";
import { getAuthConfig, getSession, signOut, type AuthConfig, type User } from "@/lib/auth";

export function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<AuthConfig>({ google: false, demo: false });
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [invitation, setInvitation] = useState<string | null>(null);
  const sessionVersion = useRef(0);
  const handleSessionExpired = useCallback(() => {
    sessionVersion.current += 1;
    setUser(null);
    setError("");
  }, []);

  useEffect(() => {
    let active = true;
    async function checkSession() {
      const version = sessionVersion.current;
      try {
        const [currentUser, options] = await Promise.all([getSession(), getAuthConfig()]);
        if (active && version === sessionVersion.current) { setInvitation(pendingInvitation()); setUser(currentUser); setConfig(options); setError(""); }
      } catch {
        if (active && version === sessionVersion.current) setError("Couldn't check your session. Please try again.");
      } finally {
        if (active && version === sessionVersion.current) setChecking(false);
      }
    }
    void checkSession();
    window.addEventListener("focus", checkSession);
    window.addEventListener("hashchange", checkSession);
    return () => { active = false; window.removeEventListener("focus", checkSession); window.removeEventListener("hashchange", checkSession); };
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
  if (user && invitation) return <>
    {error && <p className="auth-banner" role="alert">{error}</p>}
    <InvitationLanding key={`${user.id}:${invitation}`} token={invitation} username={user.username} onSessionExpired={handleSessionExpired} onSignOut={handleSignOut}
      onDismiss={() => { clearInvitation(); setInvitation(null); }} onAccepted={id => {
        clearInvitation(); const url = new URL(window.location.href); url.searchParams.set("board", String(id));
        window.history.replaceState(null, "", url); setInvitation(null);
      }} />
  </>;
  if (user) return <>
    {error && <p className="auth-banner" role="alert">{error}</p>}
    <KanbanBoard key={user.id ?? user.username} username={user.username} onSignOut={handleSignOut} signingOut={signingOut} onSessionExpired={handleSessionExpired} />
  </>;

  return <>
    <header className="workspace-bar"><div className="wordmark"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>Kanban</div><span className="workspace-badge"><span aria-hidden="true" />Your workspace</span></header>
    {invitation && <div className="invitation-banner"><p>Sign in with the invited Google account to review your board invitation.</p><button className="quiet-button" onClick={() => { clearInvitation(); setInvitation(null); }}>Dismiss invitation</button></div>}
    {error ? <div className="session-retry"><p role="alert">{error}</p><button type="button" className="primary-button" onClick={() => { setChecking(true); setAttempt((current) => current + 1); }}>Try again</button></div>
      : <SignIn config={config} onSignedIn={(currentUser) => { sessionVersion.current += 1; setError(""); setUser(currentUser); }} />}
  </>;
}
