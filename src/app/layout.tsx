import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Thesis & Research Assistant",
  description: "Research workspace with AI-assisted thesis writing, evidence, and quality checks.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
