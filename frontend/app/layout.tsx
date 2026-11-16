import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project board | Kanban",
  description: "A focused workspace to organize your ideas and keep your project moving.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
