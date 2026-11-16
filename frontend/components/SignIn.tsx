"use client";

import { useState, type FormEvent } from "react";
import { signIn, type User } from "@/lib/auth";

export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

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
        <form onSubmit={handleSubmit} aria-label="Sign in">
          <label htmlFor="username">Username</label>
          <input id="username" name="username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} disabled={pending} spellCheck={false} autoCapitalize="none" aria-describedby={error ? "sign-in-error" : undefined} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} aria-describedby={error ? "sign-in-error" : undefined} />
          {error && <p className="auth-error" id="sign-in-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</button>
        </form>
        <p className="demo-credentials">Demo access: <code>user</code> / <code>password</code></p>
      </section>
    </div>
  );
}
