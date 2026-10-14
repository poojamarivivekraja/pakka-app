import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The simulator's sample images are read from disk by the API routes. Files in public/ are served by
  // the CDN and are not part of a serverless function, so ask Next to ship them inside the API bundles.
  outputFileTracingIncludes: {
    "/api/*": ["public/samples/**/*"],
  },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
