import Link from "next/link";

// Dev-only navigation check; see app/instance-probe.tsx.
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
