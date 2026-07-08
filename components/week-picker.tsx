import Link from "next/link";
import { TOTAL_WEEKS } from "@/lib/config";

export function WeekPicker({
  basePath,
  selected,
  current,
}: {
  basePath: string;
  selected: number;
  current: number;
}) {
  return (
    <div className="-mx-3 mb-4 flex gap-1 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
      {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map((w) => (
        <Link
          key={w}
          href={`${basePath}?week=${w}`}
          className={`shrink-0 rounded-md border px-3 py-1 font-display text-base font-semibold ${
            w === selected
              ? "border-amber bg-amber text-white"
              : w === current
                ? "border-amber/50 text-amber"
                : "border-line text-muted hover:text-ink"
          }`}
        >
          W{w}
        </Link>
      ))}
    </div>
  );
}
