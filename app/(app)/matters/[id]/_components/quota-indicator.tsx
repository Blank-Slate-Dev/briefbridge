// app/(app)/matters/[id]/_components/quota-indicator.tsx
//
// Two-mode storage usage indicator:
//
//   variant="full"    — used in the Files tab header. Full-width bar with
//                       "47 MB of 250 MB used" label and percentage.
//   variant="compact" — used in the matter sidebar's "At a glance" card.
//                       Smaller bar, tighter label.
//
// Reads from FilesProvider so updates are instant when uploads land or
// files are deleted. No props needed for the data.
//
// The 250MB cap is duplicated here as a display constant — sourced from
// lib/files/types.ts, MAX_MATTER_BYTES. If you change the cap there,
// also update the displayed "of 250 MB" label here (or refactor to read
// the constant directly — kept inline as a label string for now since
// 250 MB is unlikely to change without conscious effort).

'use client';

import { MAX_MATTER_BYTES } from '@/lib/files/types';
import { useFiles } from './files-provider';

export function QuotaIndicator({
  variant = 'full',
}: {
  variant?: 'full' | 'compact';
}) {
  const { currentUsageBytes } = useFiles();

  const used = currentUsageBytes;
  const total = MAX_MATTER_BYTES;
  const ratio = Math.min(1, used / total);
  const percentDisplay = Math.round(ratio * 100);

  // Visual state: gold when comfortable, amber when nearing, red when at cap.
  // Thresholds chosen to give lawyers a clear visual heads-up before they
  // hit the wall.
  let state: 'normal' | 'high' | 'full' = 'normal';
  if (ratio >= 1) state = 'full';
  else if (ratio >= 0.85) state = 'high';

  const usedLabel = formatBytes(used);
  const totalLabel = formatBytes(total);

  return (
    <div
      className={`bb-files-quota bb-files-quota--${variant} bb-files-quota--${state}`}
      role="group"
      aria-label="Case storage usage"
    >
      <div className="bb-files-quota__row">
        <span className="bb-files-quota__label">
          {variant === 'compact' ? 'Storage' : 'Case storage'}
        </span>
        <span className="bb-files-quota__value">
          {usedLabel} <span className="bb-files-quota__of">of</span> {totalLabel}
        </span>
      </div>
      <div
        className="bb-files-quota__bar"
        role="progressbar"
        aria-valuenow={percentDisplay}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${usedLabel} of ${totalLabel} used`}
      >
        <div
          className="bb-files-quota__fill"
          style={{ width: `${Math.max(2, ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Local byte formatter. Matches the conventions agreed in the design doc:
 *   <1 KB  → "873 B"
 *   <1 MB  → "873 KB"
 *   <10 MB → "9.4 MB"  (one decimal — useful precision for small files)
 *   <1 GB  → "47 MB"   (integer — the lawyer doesn't care about decimals here)
 *   >=1 GB → "1.3 GB"  (one decimal)
 *
 * Decimal units (1 MB = 1,000,000 bytes), matching Supabase Storage display.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 10_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
