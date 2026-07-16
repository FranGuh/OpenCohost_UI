import { BrandMark } from "./BrandMark.js";

export interface BootLoaderProps {
  /** Live phase copy from the gate (e.g. "Preparando motor local…"). Announced
   * politely; also shown as a quiet caption under the mark. */
  statusLabel: string;
}

/**
 * The single boot loader. A dark, brand-first splash: Kira's mark breathes
 * (scale + opacity, looping) over a soft accent glow while the BackendGate
 * waits. Motion is a continuous loop — there is NO fixed duration and NO exit
 * timer; the gate unmounts this the instant it flips ready, so the loader's
 * lifetime IS the real load. Reduced-motion is neutralised by the global kill
 * switch in styles.css (the breathing collapses to a static frame).
 *
 * Keeps the gate's a11y contract: role="status" + aria-live="polite" +
 * aria-busy, with the phase label as the accessible text (BrandMark is
 * aria-hidden so it isn't announced twice).
 */
export function BootLoader({ statusLabel }: BootLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={true}
      className="flex h-full w-full flex-col items-center justify-center gap-7 bg-background text-foreground"
    >
      <div className="relative flex items-center justify-center">
        {/* Soft accent glow that breathes with the mark. */}
        <span
          aria-hidden="true"
          className="boot-glow pointer-events-none absolute h-40 w-40 rounded-full"
          style={{ background: "radial-gradient(closest-side, var(--accent-soft), transparent 70%)" }}
        />
        <span className="boot-mark relative">
          <BrandMark size={76} aria-hidden />
        </span>
      </div>
      <p className="mono text-xs uppercase tracking-[0.14em] text-muted-foreground">{statusLabel}</p>
    </div>
  );
}
