import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "firebase-admin",
    "@google/genai",
    "pdf-lib",
    "pdfjs-dist",
    "tesseract.js",
  ],
  experimental: {
    optimizePackageImports: ["lucide-react", "motion"],
  },
  async rewrites() {
    const projectId =
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "memly-bb934";
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${projectId}.firebaseapp.com/__/auth/:path*`,
      },
      {
        source: "/__/firebase/init.json",
        destination: `https://${projectId}.firebaseapp.com/__/firebase/init.json`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "unsafe-none",
          },
        ],
      },
    ];
  },
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      config.output = {
        ...config.output,
        chunkLoadTimeout: 300000,
      };
    }
    return config;
  },
};

export default nextConfig;
