import { useId } from 'react';

// Voltix mark: negative-space "V" with a lightning bolt cut into its throat.
// The V is a true cutout, so it takes on the page background in light or dark.
export default function Logo({ size = 100 }: { size?: number }) {
  const uid = useId().replace(/[^\w]/g, '');
  const g = `vg${uid}`;
  const m = `vm${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="logo-mark" aria-hidden>
      <defs>
        <linearGradient id={g} x1="8" y1="4" x2="92" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="0.5" stopColor="#6d6bf0" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <mask id={m}>
          <rect width="100" height="100" rx="26" fill="#fff" />
          <path d="M20 22 L38 22 L50 64 L62 22 L80 22 L56 86 L44 86 Z" fill="#000" />
          <path d="M55 29 L42 51 L50 51 L45 73 L60 47 L51 47 Z" fill="#fff" />
        </mask>
      </defs>
      <rect width="100" height="100" rx="26" fill={`url(#${g})`} mask={`url(#${m})`} />
    </svg>
  );
}
