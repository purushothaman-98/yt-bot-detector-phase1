import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "YouTube Bot Detector — Phase 1",
  description: "Server-side YouTube comment fetch + rule-based bot scoring.",
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

