import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// App icon rendered at build/request time — no binary asset in the repo.
// Badge sits inside the maskable safe zone (center ~66%).
export default function Icon() {
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
            width: 340,
            height: 340,
            borderRadius: 76,
            background: "#D50A0A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: 180,
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
