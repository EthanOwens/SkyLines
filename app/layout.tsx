import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import InstanceProbe from "./instance-probe";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Skylines",
  description: "A local-first note-taking app",
};

export const viewport: Viewport = {
  themeColor: "#18181b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <InstanceProbe />
        {/* Required by components/ui/tooltip.tsx's TooltipTrigger/TooltipContent
            (base-ui context) - components/sidebar/Sidebar.tsx (spec.md subtask 16)
            is the first consumer. Matches ../note_taking_app/app/layout.tsx, minus
            AuthProvider (not yet wired globally here - see hooks/useAuth.ts /
            components/AuthProvider.tsx, ported standalone in subtask 15). */}
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
