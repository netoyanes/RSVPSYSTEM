import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BRUMA — Reservaciones",
  description:
    "Reserva tu mesa en BRUMA. Bar de vinilo, cocteles de autor y street-food en Mazatlán.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BRUMA",
  },
};

export const viewport: Viewport = {
  themeColor: "#120F0D",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-dvh bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
