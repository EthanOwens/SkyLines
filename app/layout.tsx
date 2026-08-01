import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import InstanceProbe from "./instance-probe";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/components/AuthProvider";
import { AppShell } from "@/components/AppShell";

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
        {/* AuthProvider/TooltipProvider wired globally as of spec.md subtask 4
            ("Root app shell"). AppShell is the actual gatekeeper: it calls
            useSyncEngine/useNotes/useFolders/useNotebooks and redirects
            unauthenticated users away from non-public routes to /login - see
            components/AppShell.tsx for the exempted public routes (login,
            register, /spike-*). TooltipProvider (components/ui/tooltip.tsx)
            is required by TooltipTrigger/TooltipContent (base-ui context);
            components/sidebar/Sidebar.tsx (spec.md subtask 16) is the first
            consumer. */}
        <AuthProvider>
          <TooltipProvider>
            <AppShell>{children}</AppShell>
          </TooltipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
