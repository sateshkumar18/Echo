"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { setStoredAuth, setStoredApiUrl, getStoredToken } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [apiUrl, setApiUrl] = useState("http://localhost:5012");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getStoredToken()) router.replace("/sessions");
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const base = apiUrl.trim() || "http://localhost:5012";
      const data = await login(base, email.trim(), password);
      setStoredApiUrl(base);
      setStoredAuth(data.token, data.user || null);
      router.push("/sessions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: "4rem auto", padding: "0 1rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Echo Dashboard</h1>
      <p style={{ color: "#94a3b8", marginBottom: "1.5rem" }}>
        Sign in to view your recordings and Boss Summaries.
      </p>
      <form onSubmit={handleSubmit}>
        <label>API URL</label>
        <input
          type="text"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          placeholder="http://localhost:5012"
        />
        <label style={{ marginTop: 12 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <label style={{ marginTop: 12 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        {error && (
          <p style={{ color: "#f87171", fontSize: 14, marginTop: 12 }}>{error}</p>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 20 }}
          disabled={loading}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
