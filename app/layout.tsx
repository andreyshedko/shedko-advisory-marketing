import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Shedko · Marketing Automation",
  description: "Private marketing operations workspace for Shedko Advisory",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
