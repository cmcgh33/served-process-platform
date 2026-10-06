/**
 * SERVED. brand color constants. The single source of truth for any code path
 * that has to pass a raw hex string to a third-party API (Clerk's `appearance`
 * variables, SVG `fill`/`stroke`, recharts series colors, etc.).
 *
 * Markup that can use Tailwind classes should always prefer the matching
 * `bg-brand-*` / `text-brand-*` utilities defined in `index.css` under
 * `@theme inline`. These constants exist so the *one* place per component that
 * still needs an actual hex literal mirrors the same palette.
 */
export const brand = {
  navy: "#0f1e3c",
  navyDeep: "#0a1530",
  amber: "#f59e0b",
  amberSoft: "rgba(245, 158, 11, 0.12)",
  canvas: "#f0f2f5",
  emerald: "#34d399",
  emeraldBright: "#4ade80",
  sky: "#38bdf8",
} as const;

export type BrandColor = keyof typeof brand;
