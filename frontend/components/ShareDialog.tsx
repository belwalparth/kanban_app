"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { BoardApiError } from "@/lib/board-api";
import { createInvitation, listInvitations, listMembers, removeMember, revokeInvitation, type Invitation, type Member } from "@/lib/sharing-api";

export function ShareDialog({ boardId, name, onClose, onSessionExpired, onAccessLost }: {
  boardId: number; name: string; onClose: () => void; onSessionExpired?: () => void; onAccessLost: (id: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const locked = useRef(false);
  const [email, setEmail] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement as HTMLElement;
    element.showModal(); input.current?.focus();
    return () => { element.close(); queueMicrotask(() => { if (!element.open) trigger?.focus(); }); };
  }, []);
  const failure = useCallback((error: unknown) => {
    if (error instanceof BoardApiError && error.status === 401) onSessionExpired?.();
    else if (error instanceof BoardApiError && [403, 404].includes(error.status)) onAccessLost(boardId);
    setError(error instanceof BoardApiError && error.status === 409
      ? "This email already has access or a pending invitation. Revoke the old invitation before creating a replacement."
      : error instanceof BoardApiError && error.status === 422 ? "Enter a valid email address."
        : "Couldn't complete this request. Check the list before trying again.");
  }, [boardId, onAccessLost, onSessionExpired]);
  const refresh = useCallback(async () => {
    const [invitations, members] = await Promise.all([listInvitations(boardId), listMembers(boardId)]);
    if (mounted.current) { setInvitations(invitations); setMembers(members); }
  }, [boardId]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    Promise.all([listInvitations(boardId), listMembers(boardId)]).then(([invitations, members]) => {
      if (active) { setInvitations(invitations); setMembers(members); }
    }).catch(error => { if (active) failure(error); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [boardId, failure]);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setPending(true); setError("");
    try { await action(); await refresh(); }
    catch (error) { if (mounted.current) failure(error); }
    finally { locked.current = false; if (mounted.current) setPending(false); }
  }
  function invite(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    void run(async () => {
      const result = await createInvitation(boardId, email.trim());
      if (mounted.current) { setLink(result.link); setEmail(""); setNotice("Invitation created. Copy this link now; it is only shown here once."); }
    });
  }
  return <dialog ref={dialog} className="share-dialog" aria-labelledby="share-heading" onCancel={event => { event.preventDefault(); if (!locked.current) onClose(); }}>
    <header><button className="icon-button chat-close" aria-label="Close sharing" disabled={pending} onClick={onClose}>&times;</button><p className="eyebrow">Invite collaborators</p><h2 id="share-heading">Share {name}</h2>
      <p>Members can edit cards and columns and use the assistant. Only you can rename the board or manage access.</p></header>
    <form onSubmit={invite}>
      <label htmlFor="invite-email">Google email to invite</label>
      <div className="invite-fields"><input id="invite-email" ref={input} type="email" maxLength={254} required autoComplete="email" value={email} disabled={pending} onChange={event => setEmail(event.target.value)} /><button className="primary-button" disabled={pending || loading || !email.trim()}>Create invitation</button></div>
      <p className="share-hint">Links expire after seven days. Share the link yourself with this person.</p>
    </form>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {link && <div className="invite-link"><label htmlFor="invite-link">Invitation link</label><textarea id="invite-link" readOnly value={link} onFocus={event => event.currentTarget.select()} /><button className="quiet-button" onClick={async () => {
      try { await navigator.clipboard.writeText(link); if (mounted.current) setNotice("Invitation link copied."); }
      catch { if (mounted.current) setNotice("Select the invitation link and copy it manually."); }
    }}>Copy link</button></div>}
    {loading ? <p role="status">Loading sharing details...</p> : <>
      <h3>Members</h3><p className="share-hint">You are the owner. Removing a member ends their access to this board.</p>
      {!members.length ? <p>No members yet.</p> : <ul className="sharing-list">{members.map(member => <li key={member.user_id}>
        <span>{member.display_name || member.email || "Google user"}{member.display_name && member.email && <small>{member.email}</small>}</span>
        {confirm === member.user_id ? <div className="remove-confirm"><p>Remove this member from the board?</p><button className="quiet-button" disabled={pending} onClick={() => void run(async () => { await removeMember(boardId, member.user_id); if (mounted.current) { setConfirm(null); setNotice("Member removed."); } })}>Confirm removal</button><button className="quiet-button" disabled={pending} onClick={() => setConfirm(null)}>Keep member</button></div>
          : <button className="quiet-button" disabled={pending} onClick={() => setConfirm(member.user_id)}>Remove member</button>}
      </li>)}</ul>}
      <h3>Invitations</h3>{!invitations.length ? <p>No invitations yet.</p> : <ul className="sharing-list">{invitations.map(invitation => <li key={invitation.id}>
        <span>{invitation.email}<small>{invitation.status}{invitation.status === "pending" && ` · Expires ${new Date(invitation.expires_at * 1000).toLocaleDateString()}`}</small></span>
        {invitation.status === "pending" && <button className="quiet-button" disabled={pending} onClick={() => void run(async () => { await revokeInvitation(boardId, invitation.id); if (mounted.current) { setLink(""); setNotice("Invitation revoked."); } })}>Revoke invitation</button>}
      </li>)}</ul>}
    </>}
    <footer className="invitation-actions"><button className="quiet-button" disabled={pending} onClick={() => void run(async () => {})}>Refresh sharing</button><button className="primary-button" disabled={pending} onClick={onClose}>Done</button></footer>
  </dialog>;
}
