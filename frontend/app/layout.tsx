import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kanban app",
  description: "Single-board Kanban MVP built in Next.js",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
