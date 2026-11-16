export type User = { username: string };

export async function getSession(): Promise<User | null> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Couldn't check your session. Please try again.");
  return response.json();
}

export async function signIn(username: string, password: string): Promise<User> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }).catch(() => {
    throw new Error("Couldn't connect to the server. Please try again.");
  });
  if (response.status === 401) throw new Error("Username or password is incorrect.");
  if (!response.ok) throw new Error("Couldn't sign in. Please try again.");
  return response.json();
}

export async function signOut(): Promise<void> {
  const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error("Couldn't sign out. Please try again.");
}
