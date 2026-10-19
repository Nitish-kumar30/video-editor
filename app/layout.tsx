import type { Metadata } from "next";
import "./globals.css";
import HoverTips from "@/components/HoverTips";

export const metadata: Metadata = {
  title: "ClipForge",
  description: "Local, AI-customizable video editor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <HoverTips />
      </body>
    </html>
  );
}
