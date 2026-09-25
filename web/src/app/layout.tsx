import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import AppProviders from "@/components/AppProviders";
import TabBar from "@/components/TabBar";
import styles from "@/components/AppShell.module.css";
import { fetchProfile } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: { default: "Stack", template: "%s · Stack" },
  description: "Short lists of anything worth remembering — bars, books, gear and more.",
  appleWebApp: { capable: true, title: "Stack", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1f2724",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  let viewer: Profile | null = null;
  if (viewerId) {
    viewer = await fetchProfile(sb, "id", viewerId);
  }
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body>
        <div className={styles.app}>
          <AppProviders initialViewer={viewer}>
            {children}
            <TabBar />
          </AppProviders>
        </div>
      </body>
    </html>
  );
}
