import { useState } from "react";
import { cn } from "../../lib/cn.js";

/**
 * The eight optimized boot tiles (public/boot/kira-01.webp … kira-08.webp).
 * Order is the contract with scripts/optimize-boot-art.py — do not reorder
 * without re-running that script so index N still maps to source N.
 */
export const BOOT_COLLAGE_ART = [
  "/boot/kira-01.webp",
  "/boot/kira-02.webp",
  "/boot/kira-03.webp",
  "/boot/kira-04.webp",
  "/boot/kira-05.webp",
  "/boot/kira-06.webp",
  "/boot/kira-07.webp",
  "/boot/kira-08.webp"
] as const;

/**
 * Pick 4–6 tiles at mount: Fisher-Yates shuffle the eight paths, take a random
 * slice. Randomness at mount is intentional — the memory wall is different each
 * boot. Not seeded; this is decorative UI, not a workflow.
 */
function pickTiles(): string[] {
  const pool = [...BOOT_COLLAGE_ART];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const count = 4 + Math.floor(Math.random() * 3); // 4, 5 or 6
  return pool.slice(0, count);
}

/**
 * One tile: eager <img> that starts invisible and fades to its faint target
 * opacity on its OWN load event — no timers. A tile whose file never loads just
 * stays at opacity-0 (no placeholder, never blocks). The Ken Burns drift lives
 * in styles.css (.boot-collage-tile--a/--b, killed by reduced-motion globally).
 */
function CollageTile({ src, index }: { src: string; index: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="h-full w-full overflow-hidden">
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="eager"
        onLoad={() => setLoaded(true)}
        className={cn(
          "boot-collage-tile h-full w-full object-cover transition-opacity duration-slow ease-out",
          index % 2 === 0 ? "boot-collage-tile--a" : "boot-collage-tile--b",
          loaded ? "opacity-[0.1]" : "opacity-0"
        )}
      />
    </div>
  );
}

/**
 * Full-viewport decorative background behind the BootLoader mark: a faint,
 * slowly-drifting memory wall of Kira art. A radial veil darkens the center to
 * the app ground so the breathing BrandMark stays the hero and the status text
 * stays readable. Pure decoration — the whole layer is aria-hidden.
 */
export function BootCollage() {
  const [tiles] = useState(pickTiles);
  return (
    <div aria-hidden="true" className="boot-collage pointer-events-none absolute inset-0">
      <div className="boot-collage-grid grid h-full w-full grid-cols-3">
        {tiles.map((src, index) => (
          <CollageTile key={src} src={src} index={index} />
        ))}
      </div>
      <div className="boot-collage-veil absolute inset-0" />
    </div>
  );
}
