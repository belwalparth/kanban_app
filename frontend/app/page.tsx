import { AuthGate } from "@/components/AuthGate";

export default function Page() {
  return (
    <main className="page-shell">
      <AuthGate />
    </main>
  );
}
