"use client";

import { useEffect, useState } from "react";

/**
 * Renders a timestamp in the VIEWER's timezone and locale.
 *
 * Must be client-only. Formatting a date directly in JSX runs during SSR too,
 * where the server's zone (UTC on Vercel) differs from the browser's — that is
 * a hydration mismatch and a visible flash of the wrong time. Rendering after
 * mount means the server emits nothing and the browser fills it in.
 */
export function LocalTime({
  iso,
  withWeekday = false,
  dateOnly = false,
}: {
  iso: string;
  withWeekday?: boolean;
  dateOnly?: boolean;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(
      new Date(iso).toLocaleString(undefined, {
        ...(withWeekday ? { weekday: "short" as const } : {}),
        month: "short",
        day: "numeric",
        ...(dateOnly ? {} : { hour: "numeric" as const, minute: "2-digit" as const }),
      })
    );
  }, [iso, withWeekday, dateOnly]);
  // Non-breaking space keeps the row height stable before hydration.
  return <span suppressHydrationWarning>{text || "\u00A0"}</span>;
}
