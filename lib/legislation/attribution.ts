// lib/legislation/attribution.ts
//
// CC BY 4.0 attribution per the Federal Register of Legislation terms.
//
// From https://www.legislation.gov.au/terms-of-use:
//
//   "Content from the Legislation Register must be attributed using a set
//    of words that include a reference to the Federal Register of
//    Legislation as the source.
//
//    If the content has not been changed you must use:
//      'Sourced from the Federal Register of Legislation at [full date of
//       download]. For the latest information on Australian Government law
//       please go to https://www.legislation.gov.au.'"
//
// We're sourcing content unchanged. We pre-format the attribution at
// ingest time with the retrieval date and store it in
// legislation.attribution_text. The renderer reads from there — so
// every display of content from an Act carries the exact required
// attribution.

import type { LegislationJurisdiction } from '@/lib/db/schema';

/**
 * Build the attribution string for content from a given source.
 *
 * For now, only Commonwealth is implemented (legislation.gov.au).
 * NSW (legislation.nsw.gov.au) uses a slightly different form per
 * their copyright page — we'll add that when we ingest NSW.
 */
export function buildAttribution(
  jurisdiction: LegislationJurisdiction,
  retrievalDate: Date,
): string {
  const dateString = formatRetrievalDate(retrievalDate);

  switch (jurisdiction) {
    case 'commonwealth':
      // Verbatim per the Federal Register terms of use, "If the content
      // has not been changed".
      return (
        `Sourced from the Federal Register of Legislation at ${dateString}. ` +
        `For the latest information on Australian Government law please go to ` +
        `https://www.legislation.gov.au.`
      );

    case 'nsw':
      // From https://legislation.nsw.gov.au/copyright (unchanged content).
      return (
        `Sourced from the New South Wales Legislation website at ${dateString}. ` +
        `For the latest information on New South Wales Government legislation ` +
        `please go to https://www.legislation.nsw.gov.au.`
      );

    // Other jurisdictions deferred until we ingest them.
    case 'vic':
    case 'qld':
    case 'wa':
    case 'sa':
    case 'tas':
    case 'act':
    case 'nt':
      throw new Error(
        `Attribution text not yet implemented for jurisdiction: ${jurisdiction}. ` +
          `Add it when this jurisdiction's ingestion is added.`,
      );

    default:
      const _exhaustive: never = jurisdiction;
      throw new Error(`Unknown jurisdiction: ${String(_exhaustive)}`);
  }
}

/**
 * Format a Date as "1 February 2025" — the convention used by
 * the Federal Register's compilation dates.
 */
function formatRetrievalDate(date: Date): string {
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}