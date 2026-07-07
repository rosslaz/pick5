"use client";

import { useEffect, useState } from "react";

/** Renders a kickoff in the viewer's local timezone (client-only to avoid hydration mismatch). */
export function KickoffTime({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(
      new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  }, [iso]);
  return <span suppressHydrationWarning>{text || "\u00A0"}</span>;
}
