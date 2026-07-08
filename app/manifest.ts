import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest — Next links it automatically. Makes the
// app installable from the browser ("Add to Home Screen" on iOS) so it runs
// full-screen with its own icon. Deliberately no service worker: offline
// caching a live-scores app would show stale data.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pick 5 NFL",
    short_name: "Pick 5",
    description: "Pick five NFL winners a week. Score what your teams score.",
    start_url: "/",
    display: "standalone",
    background_color: "#030D1C",
    theme_color: "#030D1C",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
