import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@supabase/supabase-js",
    // Node-native document-processing libraries — pdf-parse's pdfjs-dist
    // dependency in particular breaks when webpack tries to bundle it for
    // the RSC runtime ("Object.defineProperty called on non-object").
    // These need Node's own module resolution, not webpack's.
    "pdf-parse",
    "pdfjs-dist",
    "mammoth",
    "exceljs",
  ],
};

export default nextConfig;
