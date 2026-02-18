"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchSessions } from "@/lib/api";
import type { SessionListItem } from "@/lib/api";
import { getStoredToken, getStoredUser, clearStoredAuth } from "@/lib/auth";

function formatDate(s: string) {
  try {
    const d = new Date(s);
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return s;
  }
}

function statusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "done" || s === "completed") return <span className="badge badge-done">Done</span>;
  if (s.includes("process") || s === "processing") return <span className="badge badge-processing">Processing</span>;
  if (s.includes("error")) return <span className="badge badge-error">Error</span>;
  return <span className="badge badge-pending">{status || "Pending"}</span>;
}

export default function SessionsPage() {
  const router = useRouter();
  const [list, setList] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const token = getStoredToken();
  const user = getStoredUser();

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    fetchSessions(token)
      .then(setList)
      .catch((err) => {
        if (err.message === "UNAUTHORIZED") {
          clearStoredAuth();
          router.replace("/login");
        } else setError(err instanceof Error ? err.message : "Failed to load sessions");
      })
      .finally(() => setLoading(false));
  }, [token, router]);

  const handleLogout = () => {
    clearStoredAuth();
    router.replace("/login");
  };

  if (!token) return null;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "1.5rem 1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Echo – Meeting Notebook</h1>
          <p style={{ color: "#94a3b8", fontSize: 14, margin: "4px 0 0" }}>
            {user?.displayName || user?.email || "Signed in"}
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={handleLogout}>
          Log out
        </button>
      </header>

      {error && (
        <p style={{ color: "#f87171", marginBottom: 16 }}>{error}</p>
      )}

      {loading ? (
        <p style={{ color: "#94a3b8" }}>Loading sessions…</p>
      ) : list.length === 0 ? (
        <div className="card">
          <p style={{ color: "#94a3b8", margin: 0 }}>
            No recordings yet. Use the Echo extension to record a meeting, then stop and wait for processing.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {list.map((s) => (
            <li key={s.id}>
              <Link
                href={`/sessions/${s.id}`}
                className="card"
                style={{ display: "block", color: "inherit" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <strong>{formatDate(s.createdAt)}</strong>
                    <span style={{ marginLeft: 8 }}>{statusBadge(s.status)}</span>
                  </div>
                  <span style={{ fontSize: 13, color: "#94a3b8" }}>
                    {s.chunkCount} chunk{s.chunkCount !== 1 ? "s" : ""}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
