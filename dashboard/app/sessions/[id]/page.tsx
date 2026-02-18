"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { fetchSession } from "@/lib/api";
import type { SessionDetail } from "@/lib/api";
import { getStoredToken, clearStoredAuth } from "@/lib/auth";

function formatDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return s;
  }
}

export default function SessionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const token = getStoredToken();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!id) return;
    fetchSession(token, id)
      .then(setSession)
      .catch((err) => {
        if (err.message === "UNAUTHORIZED") {
          clearStoredAuth();
          router.replace("/login");
        } else setError(err instanceof Error ? err.message : "Failed to load session");
      })
      .finally(() => setLoading(false));
  }, [token, id, router]);

  const transcriptText = session?.transcript ?? "";
  const filteredTranscript = useMemo(() => {
    if (!search.trim()) return transcriptText;
    const re = new RegExp(
      search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
      "gi"
    );
    return transcriptText.replace(re, (m) => `\u0000${m}\u0000`);
  }, [transcriptText, search]);

  const handleExportTxt = () => {
    const lines: string[] = [];
    lines.push(`Echo – Session ${id}`);
    lines.push(`Recorded: ${formatDate(session?.createdAt ?? null)}`);
    lines.push("");
    if (session?.summary) {
      lines.push("--- Boss Summary ---");
      lines.push(session.summary);
      lines.push("");
    }
    if (session?.transcript) {
      lines.push("--- Transcript ---");
      lines.push(session.transcript);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `echo-session-${id}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!token) return null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1rem" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <Link href="/sessions" style={{ color: "#94a3b8", fontSize: 14 }}>
          ← Back to sessions
        </Link>
      </header>

      {error && (
        <p style={{ color: "#f87171", marginBottom: 16 }}>{error}</p>
      )}

      {loading ? (
        <p style={{ color: "#94a3b8" }}>Loading…</p>
      ) : !session ? (
        <p style={{ color: "#94a3b8" }}>Session not found.</p>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h1 style={{ fontSize: "1.25rem", margin: "0 0 8px" }}>Session</h1>
                <p style={{ color: "#94a3b8", fontSize: 14, margin: 0 }}>
                  Recorded {formatDate(session.createdAt)} · {session.chunkCount} chunk{session.chunkCount !== 1 ? "s" : ""}
                </p>
              </div>
              <button type="button" className="btn btn-primary" onClick={handleExportTxt}>
                Export as .txt
              </button>
            </div>
          </div>

          {session.summary && (
            <section className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: "1rem", margin: "0 0 12px", color: "#38bdf8" }}>Boss Summary</h2>
              <div
                style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
                dangerouslySetInnerHTML={{
                  __html: session.summary
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/\n/g, "<br />"),
                }}
              />
            </section>
          )}

          <section className="card">
            <h2 style={{ fontSize: "1rem", margin: "0 0 12px", color: "#38bdf8" }}>Full Transcript</h2>
            {session.transcript ? (
              <>
                <input
                  type="text"
                  placeholder="Search in transcript…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ marginBottom: 12 }}
                />
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.6,
                    maxHeight: 60 * 16,
                    overflowY: "auto",
                    fontSize: 14,
                  }}
                >
                  {filteredTranscript.split("\u0000").map((part, i) =>
                    i % 2 === 1 ? (
                      <mark key={i} style={{ background: "#334155", padding: "0 2px" }}>
                        {part}
                      </mark>
                    ) : (
                      part
                    )
                  )}
                </div>
              </>
            ) : (
              <p style={{ color: "#94a3b8" }}>
                {session.status?.toLowerCase().includes("process")
                  ? "Transcript is being generated…"
                  : "No transcript yet."}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
