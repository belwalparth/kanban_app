"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage, ChatResult } from "@/lib/chat-api";

export function ChatSidebar({ pending, disabled, onSend }: {
  pending: boolean;
  disabled: boolean;
  onSend: (message: string, history: ChatMessage[]) => Promise<ChatResult>;
}) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const locked = useRef(false);
  const mounted = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const wasPending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [history, pending, error]);
  useEffect(() => {
    if (wasPending.current && !pending) input.current?.focus();
    wasPending.current = pending;
  }, [pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending || disabled || locked.current) return;
    locked.current = true;
    setError("");
    setNotice("");
    try {
      const result = await onSend(message, history.slice(-20));
      if (!mounted.current) return;
      if (result.error !== undefined) setError(result.error);
      else {
        setHistory((previous) => [...previous, { role: "user", content: message } as ChatMessage, { role: "assistant", content: result.response.reply } as ChatMessage].slice(-20));
        setDraft("");
        setNotice(result.response.updated ? "Board updated and saved." : "Answer received. Board unchanged.");
      }
    } finally {
      locked.current = false;
      if (mounted.current) input.current?.focus();
    }
  }

  return <aside className="chat-sidebar" aria-labelledby="chat-heading">
    <header className="chat-heading"><p className="eyebrow">A helping hand</p><h2 id="chat-heading">Board assistant</h2>
      <p>Ask a question, or describe the cards you want to create, edit, or move.</p></header>
    <div className="chat-history" role="log" aria-label="Chat conversation" aria-live="polite" aria-relevant="additions" tabIndex={0}>
      {history.length === 0 && <p className="chat-empty">Try: “Create a release checklist in To do.”</p>}
      {history.map((message, index) => <div key={index} className={`chat-message chat-${message.role}`}>
        <span>{message.role === "user" ? "You" : "Assistant"}</span><p>{message.content}</p>
      </div>)}
      {pending && <p className="chat-pending" role="status">Working on your request...</p>}
      <div ref={end} />
    </div>
    <form className="chat-form" onSubmit={submit} aria-busy={pending}>
      <label htmlFor="chat-message">Message the assistant</label>
      <textarea id="chat-message" ref={input} value={draft} maxLength={4000} rows={4} disabled={pending || disabled}
        placeholder="What would you like to change?" onChange={(event) => setDraft(event.target.value)} aria-describedby="chat-hint" />
      <p id="chat-hint" className="chat-hint">AI changes are saved to your board. Conversation clears on reload or sign out.</p>
      {error && <p className="chat-error" role="alert">{error}</p>}
      {notice && <p className="chat-notice" role="status">{notice}</p>}
      <button className="primary-button" type="submit" disabled={pending || disabled || !draft.trim()}>{pending ? "Working..." : error ? "Send again" : "Send message"}</button>
    </form>
  </aside>;
}
