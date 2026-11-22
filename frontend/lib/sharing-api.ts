import { BoardApiError, type BoardSummary } from "./board-api";

export type Invitation = { id: number; email: string; expires_at: number; status: "pending" | "accepted" | "expired" | "revoked" };
export type Member = { user_id: number; joined_at: number; email: string | null; display_name: string | null };
export type InvitationPreview = { board_id: number; name: string; status: "pending" | "accepted" };

async function request<T>(path: string, method = "GET", data?: object): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method, credentials: "same-origin", cache: "no-store",
    ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}),
  });
  if (!response.ok) throw new BoardApiError(response.status);
  return response.status === 204 ? undefined as T : response.json();
}
export const listInvitations = (id: number) => request<Invitation[]>(`boards/${id}/invitations`);
export const listMembers = (id: number) => request<Member[]>(`boards/${id}/members`);
export const createInvitation = (id: number, email: string) => request<Invitation & { link: string }>(`boards/${id}/invitations`, "POST", { email });
export const revokeInvitation = (id: number, inviteId: number) => request<void>(`boards/${id}/invitations/${inviteId}`, "DELETE");
export const removeMember = (id: number, userId: number) => request<void>(`boards/${id}/members/${userId}`, "DELETE");
export const inspectInvitation = (token: string) => request<InvitationPreview>("invitations/inspect", "POST", { token });
export const acceptInvitation = (token: string) => request<BoardSummary>("invitations/accept", "POST", { token });

const PENDING_INVITATION = "kanban.pendingInvitation";
export function pendingInvitation(): string | null {
  const url = new URL(window.location.href);
  const incoming = new URLSearchParams(url.hash.slice(1)).get("invite");
  if (incoming !== null) {
    sessionStorage.setItem(PENDING_INVITATION, /^[A-Za-z0-9_-]{43}$/.test(incoming) ? incoming : "invalid");
    url.hash = "";
    window.history.replaceState(null, "", url);
  }
  return sessionStorage.getItem(PENDING_INVITATION);
}
export function clearInvitation() { sessionStorage.removeItem(PENDING_INVITATION); }
