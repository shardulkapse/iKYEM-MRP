import { ICONS } from "@/lib/nav";

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function BallMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill="var(--cherry)" />
      <path d="M8 9c7 6 7 16 0 22M32 9c-7 6-7 16 0 22" fill="none" stroke="var(--stitch)" strokeWidth="1.6" strokeDasharray="2.4 2" />
    </svg>
  );
}
