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
    // pdfkit loads its .afm font metrics files from disk at runtime —
    // webpack bundling breaks that path resolution the same way it broke
    // pdf-parse above.
    "pdfkit",
  ],
};

export default nextConfig;
