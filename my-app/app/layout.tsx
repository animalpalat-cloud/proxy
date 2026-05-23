import type { Metadata } from "next";
import { BareUvBootstrap } from "@/components/BareUvBootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenRelay — Access the Web Safely",
  description:
    "Professional web proxy and unblocker. Paste a link and browse through an auto-rotating secure relay.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Browser extensions (password managers, etc.) inject attributes onto <html>/<body>.
  // suppressHydrationWarning tells React to ignore those known host/DOM differences.
  return (
    <html lang="en" className="scroll-smooth antialiased" suppressHydrationWarning>
      <body
        className="min-h-dvh flex flex-col bg-slate-950 text-slate-100 font-sans"
        suppressHydrationWarning
      >
        <BareUvBootstrap />
        {children}
      </body>
    </html>
  );
}
