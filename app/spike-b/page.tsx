import Link from "next/link";

// M0 nav spike route (spec.md subtask 3). Trivial route + a <Link> to its
// sibling route, used to verify SPA-smooth client-side navigation inside
// the Tauri webview. See app/instance-probe.tsx for the detection method.
export default function SpikeB() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Spike B</h1>
      <Link href="/spike-a" className="text-blue-500 underline">
        Go to Spike A
      </Link>
    </div>
  );
}
