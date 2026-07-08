"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KickoffTime } from "@/components/kickoff-time";
import { PICKS_PER_WEEK } from "@/lib/config";
import type { Game } from "@/lib/types";
import { savePicks, type PickInput } from "./actions";

interface Sel {
  gameId: string;
  pickedHome: boolean;
}

export function PicksForm({
  leagueId,
  season,
  week,
  games,
  initialPicks,
}: {
  leagueId: string;
  season: number;
  week: number;
  games: Game[];
  initialPicks: { game_id: string; picked_home: boolean; pick_order: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const initialSlots = useMemo(() => {
    const slots: (Sel | null)[] = Array(PICKS_PER_WEEK).fill(null);
    for (const p of initialPicks) {
      if (p.pick_order >= 1 && p.pick_order <= PICKS_PER_WEEK) {
        slots[p.pick_order - 1] = { gameId: p.game_id, pickedHome: p.picked_home };
      }
    }
    return slots;
  }, [initialPicks]);

  const [slots, setSlots] = useState<(Sel | null)[]>(initialSlots);
  useEffect(() => setSlots(initialSlots), [initialSlots]);

  // Re-evaluate locks as kickoffs pass while the page is open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const isLocked = (gameId: string) => {
    const g = gameById.get(gameId);
    return !g || new Date(g.kickoff).getTime() <= now;
  };
  const slotLocked = (i: number) => slots[i] !== null && isLocked(slots[i]!.gameId);
  const slotOf = (gameId: string) => slots.findIndex((s) => s?.gameId === gameId);
  const used = slots.filter(Boolean).length;

  const dirty = useMemo(
    () =>
      slots.some((s, i) => {
        const init = initialSlots[i];
        if (!s && !init) return false;
        if (!s || !init) return true;
        return s.gameId !== init.gameId || s.pickedHome !== init.pickedHome;
      }),
    [slots, initialSlots]
  );

  function pickTeam(game: Game, home: boolean) {
    setMessage(null);
    if (isLocked(game.id)) return;
    setSlots((prev) => {
      const next = [...prev];
      const idx = next.findIndex((s) => s?.gameId === game.id);
      if (idx >= 0) {
        // Same team again removes it; the other team flips the pick.
        next[idx] = next[idx]!.pickedHome === home ? null : { gameId: game.id, pickedHome: home };
        return next;
      }
      const empty = next.findIndex((s) => s === null);
      if (empty < 0) {
        setMessage({ text: "All 5 slots are full — remove a pick first.", error: true });
        return prev;
      }
      next[empty] = { gameId: game.id, pickedHome: home };
      return next;
    });
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= PICKS_PER_WEEK) return;
    if (slotLocked(i) || slotLocked(j)) return;
    setMessage(null);
    setSlots((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function remove(i: number) {
    if (slotLocked(i)) return;
    setMessage(null);
    setSlots((prev) => {
      const next = [...prev];
      next[i] = null;
      return next;
    });
  }

  function save() {
    const payload: PickInput[] = [];
    slots.forEach((s, i) => {
      if (s) payload.push({ game_id: s.gameId, picked_home: s.pickedHome, pick_order: i + 1 });
    });
    startTransition(async () => {
      const res = await savePicks(leagueId, season, week, payload);
      if (res.error) {
        setMessage({ text: res.error, error: true });
      } else {
        setMessage({ text: "Picks saved.", error: false });
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-3">
        {games.map((game) => {
          const locked = isLocked(game.id);
          const mySlot = slotOf(game.id);
          const picked = mySlot >= 0 ? slots[mySlot] : null;
          return (
            <div
              key={game.id}
              className={`card p-3 ${locked ? "opacity-75" : ""}`}
            >
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <KickoffTime iso={game.kickoff} />
                <span>
                  {game.status === "final" && "Final"}
                  {game.status === "in_progress" && (
                    <span className="pulse-live font-semibold text-win">LIVE</span>
                  )}
                  {game.status === "scheduled" && locked && "Kicked off"}
                  {game.status === "scheduled" && !locked && "\u00A0"}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
                <TeamButton
                  name={game.away_team}
                  abbr={game.away_abbr}
                  logo={game.away_logo}
                  score={game.status !== "scheduled" ? game.away_score : null}
                  selected={picked ? !picked.pickedHome : false}
                  locked={locked}
                  slotNumber={picked && !picked.pickedHome ? mySlot + 1 : null}
                  onClick={() => pickTeam(game, false)}
                />
                <span className="self-center font-display text-muted">@</span>
                <TeamButton
                  name={game.home_team}
                  abbr={game.home_abbr}
                  logo={game.home_logo}
                  score={game.status !== "scheduled" ? game.home_score : null}
                  selected={picked ? picked.pickedHome : false}
                  locked={locked}
                  slotNumber={picked && picked.pickedHome ? mySlot + 1 : null}
                  onClick={() => pickTeam(game, true)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="card p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-2xl">Your picks</h2>
            <span className="score-cell">{used}/5</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Order matters — Pick 1 is your first tiebreaker.
          </p>
          <ol className="mt-3 flex flex-col gap-2">
            {slots.map((s, i) => {
              const game = s ? gameById.get(s.gameId) : undefined;
              const locked = slotLocked(i);
              return (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-line bg-pitch px-2 py-1.5"
                >
                  <span className="score-cell dim">{i + 1}</span>
                  {s && game ? (
                    <>
                      <span className="min-w-0 flex-1 truncate font-display text-lg font-semibold">
                        {s.pickedHome ? game.home_abbr : game.away_abbr}
                        <span className="ml-2 text-sm font-normal text-muted">
                          vs {s.pickedHome ? game.away_abbr : game.home_abbr}
                        </span>
                      </span>
                      {locked ? (
                        <span title="Locked at kickoff" aria-label="Locked">🔒</span>
                      ) : (
                        <span className="flex gap-1">
                          <button
                            className="btn-ghost px-2 py-0.5 text-sm"
                            onClick={() => move(i, -1)}
                            disabled={i === 0 || slotLocked(i - 1)}
                            aria-label={`Move pick ${i + 1} up`}
                            type="button"
                          >
                            ↑
                          </button>
                          <button
                            className="btn-ghost px-2 py-0.5 text-sm"
                            onClick={() => move(i, 1)}
                            disabled={i === PICKS_PER_WEEK - 1 || slotLocked(i + 1)}
                            aria-label={`Move pick ${i + 1} down`}
                            type="button"
                          >
                            ↓
                          </button>
                          <button
                            className="btn-danger px-2 py-0.5 text-sm"
                            onClick={() => remove(i)}
                            aria-label={`Remove pick ${i + 1}`}
                            type="button"
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="flex-1 text-sm text-muted">Tap a team to fill</span>
                  )}
                </li>
              );
            })}
          </ol>
          <button
            className="btn-amber mt-4 w-full"
            onClick={save}
            disabled={pending || !dirty}
            type="button"
          >
            {pending ? "Saving…" : "Save picks"}
          </button>
          {message && (
            <p className={`mt-2 text-sm ${message.error ? "text-loss" : "text-win"}`}>
              {message.text}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function TeamButton({
  name,
  abbr,
  logo,
  score,
  selected,
  locked,
  slotNumber,
  onClick,
}: {
  name: string;
  abbr: string;
  logo: string | null;
  score: number | null;
  selected: boolean;
  locked: boolean;
  slotNumber: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      aria-pressed={selected}
      className={`relative flex min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors disabled:cursor-not-allowed ${
        selected
          ? "border-amber bg-amber/10"
          : "border-line hover:border-amber/40"
      }`}
    >
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-8 w-8 shrink-0" loading="lazy" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-display text-xl font-bold leading-tight">{abbr}</span>
        <span className="block truncate text-xs text-muted">{name}</span>
      </span>
      {score !== null && <span className="score-cell">{score}</span>}
      {slotNumber && (
        <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-amber font-display text-sm font-bold text-white">
          {slotNumber}
        </span>
      )}
    </button>
  );
}
