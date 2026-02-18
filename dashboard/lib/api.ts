/**
 * Echo API client. Uses NEXT_PUBLIC_ECHO_API_URL (e.g. http://localhost:5012) and token from localStorage.
 */

function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    const stored = (typeof localStorage !== "undefined" && localStorage.getItem("echo_api_url")) || "";
    const url = stored.trim() || (process.env.NEXT_PUBLIC_ECHO_API_URL || "").trim() || "http://localhost:5012";
    return url.replace(/\/$/, "");
  }
  return (process.env.NEXT_PUBLIC_ECHO_API_URL || "http://localhost:5012").replace(/\/$/, "");
}

export type SessionListItem = {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  chunkCount: number;
  status: string;
};

export type SessionDetail = SessionListItem & {
  transcript: string | null;
  summary: string | null;
  processedAt: string | null;
  errorMessage: string | null;
};

export async function login(
  baseUrl: string,
  email: string,
  password: string
): Promise<{ token: string; user: { email: string; displayName?: string; subscriptionTier?: string } }> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Login failed (${res.status})`);
  return data;
}

export async function fetchSessions(token: string): Promise<SessionListItem[]> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/echo/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load sessions (${res.status})`);
  return Array.isArray(data) ? data : [];
}

export async function fetchSession(token: string, id: string): Promise<SessionDetail> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/echo/session/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (res.status === 404) throw new Error("NOT_FOUND");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load session (${res.status})`);
  return data;
}
