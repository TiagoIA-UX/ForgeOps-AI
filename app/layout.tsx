import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZAEA — Zairyx Autonomous Engineering Agent",
  description:
    "Sistema de agentes autônomos que monitora, diagnostica e corrige plataformas Next.js + Supabase",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="antialiased bg-zaea-bg text-white font-sans">{children}</body>
    </html>
  );
}
