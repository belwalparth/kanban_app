"use client";

import { useEffect, useState, type FormEvent } from "react";
import { signIn, type AuthConfig, type User } from "@/lib/auth";

export function SignIn({ config, onSignedIn }: { config: AuthConfig; onSignedIn: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [callbackError] = useState(() => {
    const code = new URLSearchParams(window.location.search).get("auth_error");
    if (!code) return "";
    const errors: Record<string, string> = {
      cancelled: "Google sign-in was cancelled. You can try again.",
      invalid: "This sign-in attempt expired or was already used. Please start again.",
      unavailable: "Google sign-in is unavailable. Please try again later.",
      failed: "Google sign-in could not be verified. Please try again.",
    };
    return errors[code] ?? errors.failed;
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("auth_error")) {
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      onSignedIn(await signIn(username, password));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn't sign in. Please try again.");
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="sign-in-layout">
      <section className="sign-in-story" aria-label="Welcome to Kanban">
        <p className="eyebrow">Small steps. Meaningful progress.</p>
        <h1>A little structure.<br />A lot of possibility<span className="heading-dot">.</span></h1>
        <p>Your ideas, priorities, and next steps. Together in one focused workspace.</p>
        <div className="sign-in-illustration" aria-hidden="true">
          <div><i /><span /><span /></div><div><i /><span /></div><div><i /><span /></div>
        </div>
        <p className="sign-in-caption">Make room for what comes next.</p>
      </section>
      <section className="sign-in-card" aria-labelledby="sign-in-heading">
        <p className="eyebrow">Your workspace awaits</p>
        <h2 id="sign-in-heading">Welcome back</h2>
        <p>Sign in to get your project moving.</p>
        {callbackError && <p className="auth-error" role="alert">{callbackError}</p>}
        {config.google && <a className="google-sign-in" href="/api/auth/google/start">Continue with Google</a>}
        {!config.google && !config.demo && <p role="status">Sign-in is temporarily unavailable. Please try again later.</p>}
        {config.demo && <><form onSubmit={handleSubmit} aria-label="Sign in">
          <label htmlFor="username">Username</label>
          <input id="username" name="username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} disabled={pending} spellCheck={false} autoCapitalize="none" aria-describedby={error ? "sign-in-error" : undefined} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} aria-describedby={error ? "sign-in-error" : undefined} />
          {error && <p className="auth-error" id="sign-in-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</button>
        </form>
        <p className="demo-credentials">Local demo access: <code>user</code> / <code>password</code></p></>}
      </section>
    </div>
  );
}
