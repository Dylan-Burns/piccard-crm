import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "CRM", template: "%s · CRM" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster theme="light" position="top-center" />
      </body>
    </html>
  );
}
