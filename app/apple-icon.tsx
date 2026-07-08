import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS home-screen icon (full-bleed; iOS rounds the corners itself).
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#030D1C",
        }}
      >
        <div
          style={{
            width: 128,
            height: 128,
            borderRadius: 28,
            background: "#D50A0A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: 68,
            fontWeight: 700,
          }}
        >
          P5
        </div>
      </div>
    ),
    size
  );
}
