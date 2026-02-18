import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Echo – Meeting Notebook",
  description: "View transcripts and Boss Summaries from your Echo recordings",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
