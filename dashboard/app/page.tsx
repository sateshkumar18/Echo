"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStoredToken } from "@/lib/auth";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = getStoredToken();
    if (token) router.replace("/sessions");
    else router.replace("/login");
  }, [router]);

  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <p>Redirecting…</p>
    </div>
  );
}
