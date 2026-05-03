import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rising Team Interview — Live Mirror",
  description:
    "Production-ready Next.js + Django starter. Type and watch the text come alive.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="terminal-grid min-h-screen antialiased">{children}</body>
    </html>
  );
}
