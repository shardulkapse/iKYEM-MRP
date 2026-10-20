import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";

import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "iKYEM Factory", template: "%s · iKYEM Factory" },
  description:
    "Production, stock, orders and pay for the iKYEM cricket ball factory.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html lang="en-IN">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
