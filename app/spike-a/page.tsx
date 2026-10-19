import Link from "next/link";

// Dev-only navigation check; see app/instance-probe.tsx.
export default function SpikeA() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Spike A</h1>
      <Link href="/spike-b" className="text-blue-500 underline">
        Go to Spike B
      </Link>
    </div>
  );
}
