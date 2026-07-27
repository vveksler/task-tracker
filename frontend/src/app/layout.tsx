import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Task Tracker",
  description: "Full-stack Kanban task tracker",
};

/**
 * Reading headers() opts the tree into dynamic rendering. That is required for
 * CSP nonces: middleware mints a new nonce per request, and Next can only stamp
 * it onto scripts during SSR when the request (and its CSP header) exists.
 * Fully static pages are built without a request, so they cannot use nonces.
 */
const RootLayout = async ({
  children,
}: {
  children: React.ReactNode;
}) => {
  // Available if you add your own <Script nonce={nonce}>; Next also reads the
  // CSP nonce from the request CSP header automatically for framework scripts.
  void (await headers()).get("x-nonce");

  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
};

export default RootLayout;
