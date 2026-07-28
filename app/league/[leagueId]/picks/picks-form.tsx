"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KickoffTime } from "@/components/kickoff-time";
import { LocalTime } from "@/components/local-time";
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
  lockAnchor,
}: {
  leagueId: string;
  season: number;
  week: number;
  games: Game[];
  initialPicks: { game_id: string; picked_home: boolean; pick_order: number }[];
  /** ISO time of the week's Sunday 1:00 ET freeze, or null if the week has none. */
  lockAnchor: string | null;
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

  // The league freezes every remaining pick when the Sunday 1:00 ET games
  // start, so a pick's deadline is the EARLIER of its own kickoff and that
  // anchor. Games after the anchor (4:25, Sunday night, Monday night) are
  // pickable all week and then lock together at 1:00 — they were previously
  // editable right up to their own kickoff, which was wrong.
  const anchorMs = useMemo(
    () => (lockAnchor ? new Date(lockAnchor).getTime() : null),
    [lockAnchor]
  );
  const lockTimeOf = (g: Game) => {
    const kick = new Date(g.kickoff).getTime();
    return anchorMs === null ? kick : Math.min(kick, anchorMs);
  };
  const isLocked = (gameId: string) => {
    const g = gameById.get(gameId);
    return !g || lockTimeOf(g) <= now;
  };
  /** Locked by the weekly freeze rather than by its own kickoff. */
  const frozenNotStarted = (g: Game) =>
    isLocked(g.id) && new Date(g.kickoff).getTime() > now;
  /** Nothing in this week can be changed any more. */
  const weekLocked = games.length > 0 && games.every((g) => isLocked(g.id));
  const slotLocked = (i: number) => slots[i] !== null && isLocked(slots[i]!.gameId);
  const slotOf = (gameId: string) => slots.findIndex((s) => s?.gameId === gameId);
  const used = slots.filter(Boolean).length;

  // Confirmation-banner state: how many picks are actually persisted. After a
  // successful save, router.refresh() updates initialPicks, so this reflects
  // saved state (not live edits, which `dirty` tracks separately).
  const savedCount = initialSlots.filter(Boolean).length;

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

    // The side effect (the "slots are full" message) is decided out here so the
    // updater stays pure — React double-invokes updaters in StrictMode.
    // Fix #5: the indices themselves are derived from `prev` INSIDE the
    // updater. An earlier version captured them from render state, which could
    // write to a stale slot if two picks landed before a re-render.
    const alreadyPicked = slots.some((s) => s?.gameId === game.id);
    if (!alreadyPicked && slots.every((s) => s !== null)) {
      setMessage({ text: "All 5 slots are full — remove a pick first.", error: true });
      return;
    }

    setSlots((prev) => {
      const next = [...prev];
      const idx = next.findIndex((s) => s?.gameId === game.id);
      if (idx >= 0) {
        // Same team again removes it; the other team flips the pick.
        next[idx] = next[idx]!.pickedHome === home ? null : { gameId: game.id, pickedHome: home };
        return next;
      }
      const empty = next.findIndex((s) => s === null);
      if (empty < 0) return prev; // pure no-op; the message was already shown
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
    <div className="pb-24 lg:pb-0">
      {/* Fix #13: this block was hidden entirely when nothing was saved yet,
          so the player who most needs the nudge — the one with zero picks in —
          saw no status at all. */}
      <div
        className={`mb-4 flex flex-wrap items-center gap-x-2 rounded-lg border px-4 py-3 text-sm ${
          weekLocked
            ? "border-line bg-raised/40 text-muted"
            : savedCount === PICKS_PER_WEEK && !dirty
            ? "border-win/40 bg-win/10 text-win"
            : "border-chosen/40 bg-chosen/10 text-ink"
        }`}
      >
        {weekLocked ? (
          <span>
            <b>Week {week} is locked.</b> You finished with {savedCount} of {PICKS_PER_WEEK}{" "}
            {savedCount === 1 ? "pick" : "picks"} in.
          </span>
        ) : savedCount === PICKS_PER_WEEK && !dirty ? (
          <span className="font-semibold">
            ✓ You&apos;re locked in for Week {week} — all {PICKS_PER_WEEK} picks saved.
          </span>
        ) : dirty ? (
          <span>
            <b>Unsaved changes.</b> {savedCount} of {PICKS_PER_WEEK} picks are currently saved —
            hit Save picks to update.
          </span>
        ) : savedCount === 0 ? (
          <span>
            <b>No picks saved yet for Week {week}.</b> Tap teams below to build your five, then
            hit Save picks.
          </span>
        ) : (
          <span>
            <b>{savedCount} of {PICKS_PER_WEEK} picks saved.</b> Add {PICKS_PER_WEEK - savedCount}{" "}
            more and save to lock in your week.
          </span>
        )}
        {!weekLocked && lockAnchor && (
          <span className="text-muted">
            Everything locks <LocalTime iso={lockAnchor} withWeekday /> in your timezone.
          </span>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-3">
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
                  {game.status === "scheduled" && frozenNotStarted(game) && "Locked"}
                  {game.status === "scheduled" && locked && !frozenNotStarted(game) && "Kicked off"}
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

      <aside id="your-picks" className="min-w-0 scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
        <div className="card p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-2xl">Your picks</h2>
            <span className={`score-cell ${used === PICKS_PER_WEEK ? "win" : ""}`}>
              {used}/5
            </span>
          </div>
          {/* Pick order decides two things people only discover after losing a
            * tiebreak, so both are stated up front rather than in one line. */}
          <p className="mt-1 text-xs text-muted">
            Order matters. <b className="text-ink">Pick 1</b> breaks weekly ties, and the
            perfect-slate jackpot needs all five in exact points order.
          </p>
          <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted">
            <span>1 = most points expected</span>
            <span>5 = fewest</span>
          </div>
          <ol className="mt-1 flex flex-col gap-2">
            {slots.map((s, i) => {
              const game = s ? gameById.get(s.gameId) : undefined;
              const locked = slotLocked(i);
              return (
                <li
                  key={i}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                    i === 0 ? "border-chosen/40 bg-chosen/5" : "border-line bg-pitch"
                  }`}
                >
                  <span className={`score-cell ${i === 0 ? "" : "dim"}`}>{i + 1}</span>
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
                    <span className="flex-1 text-sm text-muted">
                      {i === 0 ? "Tap your highest scorer" : "Tap a team to fill"}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {/* A deliberate beat before saving: this is the only moment the order
            * can still be changed, and its consequences are invisible until
            * results land. */}
          {used === PICKS_PER_WEEK && dirty && !weekLocked && (
            <p className="mt-3 rounded-lg border border-chosen/40 bg-chosen/10 px-3 py-2 text-xs text-ink">
              <b>Check your order before saving.</b> Pick 1 should be the team you expect to
              score the most points. Use the arrows to reorder.
            </p>
          )}
          <button
            className="btn-amber mt-4 w-full"
            onClick={save}
            disabled={pending || !dirty || weekLocked}
            type="button"
          >
            {pending ? "Saving…" : weekLocked ? "Locked" : "Save picks"}
          </button>
          {message && (
            <p className={`mt-2 text-sm ${message.error ? "text-loss" : "text-win"}`}>
              {message.text}
            </p>
          )}
        </div>
      </aside>
    </div>

    {/* Mobile action bar. The "Your picks" aside sits AFTER the games list in
     * DOM order, so on a phone the counter and Save button were stranded below
     * sixteen game cards — you could not see your progress while picking, or
     * save without hunting for it. This pins both to the bottom of the screen
     * on small viewports; the aside still handles it from `lg` up. */}
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <a
          href="#your-picks"
          className={`score-cell ${used === PICKS_PER_WEEK ? "win" : ""}`}
          aria-label={`${used} of ${PICKS_PER_WEEK} picks selected — review your order`}
          title="Review your pick order"
        >
          {used}/{PICKS_PER_WEEK}
        </a>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {weekLocked
            ? `Week ${week} is locked`
            : dirty && used === PICKS_PER_WEEK
            ? "Check your order, then save"
            : dirty
            ? "Unsaved changes"
            : savedCount === PICKS_PER_WEEK
            ? "All picks saved"
            : "Tap teams to pick"}
        </span>
        <button
          className="btn-amber shrink-0"
          onClick={save}
          disabled={pending || !dirty || weekLocked}
          type="button"
        >
          {pending ? "Saving…" : weekLocked ? "Locked" : "Save picks"}
        </button>
      </div>
    </div>
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
      className={`relative block w-full min-w-0 rounded-lg border px-2 py-2 text-left transition-colors disabled:cursor-not-allowed ${
        selected
          ? "border-chosen bg-chosen/15"
          : "border-line hover:border-chosen/40"
      }`}
    >
      {/* Flex lives on an inner span: Safari mis-sizes flex children of <button>. */}
      <span className="flex min-w-0 items-center gap-2">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-8 w-8 shrink-0" loading="lazy" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-display text-xl font-bold leading-tight">{abbr}</span>
          <span className="block truncate text-xs text-muted">{name}</span>
        </span>
        {score !== null && <span className="score-cell">{score}</span>}
      </span>
      {slotNumber && (
        <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-chosen font-display text-sm font-bold text-pitch">
          {slotNumber}
        </span>
      )}
    </button>
  );
}
