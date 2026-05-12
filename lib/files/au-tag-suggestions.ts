// lib/files/au-tag-suggestions.ts
//
// Tag suggestions for the file tagger autocomplete.
//
// Two sources combine to suggest tags as the lawyer types:
//   1. The lawyer's previously-used tags (personal vocabulary, wins ties)
//   2. AU defaults — a small seed list of the highest-frequency tags
//      across AU litigation practice
//
// Why a small seed list (12 tags, not 35):
//   The point of seeded suggestions is to surface a handful of anchors
//   that get the lawyer started, NOT to teach them a legal taxonomy.
//   A 35-item list trains lawyers to pick from the list rather than tag
//   what's actually in the document. A 12-item list nudges them toward
//   the umbrella categories, and they specialise from there as needed.
//
//   "Pleadings" instead of separately listing Statement of Claim, Defence,
//   Reply, Cross-Claim — lawyers can add the specific ones as custom tags.
//   That's the desired behaviour: the system grows with the lawyer's
//   working vocabulary instead of dictating it.
//
// Architecture note for future internationalisation:
//   When BriefBridge expands beyond AU, this file becomes a routing point.
//   Rename to lib/files/tag-suggestions.ts and add:
//     getDefaultTagsForRegion(region: 'au' | 'uk' | 'nz' | 'ca'): string[]
//   The user's profiles.region column drives which set is seeded.
//   No DB migration needed — the existing free-form `file_tags` table just
//   gets fed a different default per user.

/**
 * The 12 highest-frequency tags in AU litigation practice.
 *
 * Sorted roughly by document-lifecycle order: things you'd encounter
 * early in a matter come first. Lawyers will scan the list, so ordering
 * matters for the cold-start case (no personal history yet).
 *
 * Display labels: these are what gets typed into `file_tags.tag_label`.
 * The normalised `file_tags.tag` is the lowercase form, computed at
 * insert time by the queries layer.
 */
export const AU_DEFAULT_TAGS: readonly string[] = [
  'Pleadings',
  'Affidavit',
  'Witness Statement',
  'Expert Report',
  'Exhibit',
  'Submissions',
  'Correspondence',
  'Memorandum of Advice',
  'Court Book',
  'Orders / Judgment',
  'Without Prejudice',
  'Subpoena',
];

/**
 * Maximum number of autocomplete suggestions to show at once.
 * 8 = enough that a typed prefix usually finds a match, few enough that
 * the dropdown isn't overwhelming.
 */
const MAX_SUGGESTIONS = 8;

/**
 * Returns autocomplete suggestions for the tag editor.
 *
 * @param prefix      What the lawyer has typed so far. Empty string = "show me defaults".
 * @param alreadyUsed Tags already attached to THIS file (deduped from suggestions).
 * @param personalHistory The lawyer's previously-used tags across all files
 *                        (from SELECT DISTINCT tag_label FROM file_tags WHERE ...
 *                        in the calling code). Wins ties against the AU seed list.
 * @returns Up to MAX_SUGGESTIONS labels, deduped, ranked.
 *
 * Ranking rules:
 *   1. Personal history (matches prefix) first
 *   2. AU defaults (matches prefix) next
 *   3. Filter out tags already on this file
 *   4. Case-insensitive matching
 *
 * If `prefix` is empty:
 *   - Show recent personal history (most-used first — caller pre-sorts)
 *   - Then AU defaults to fill remainder
 *   - Lawyer sees their working vocabulary AND the umbrella categories
 */
export function getSuggestions(
  prefix: string,
  alreadyUsed: string[],
  personalHistory: string[] = [],
): string[] {
  const normalisedPrefix = prefix.trim().toLowerCase();
  const usedSet = new Set(alreadyUsed.map((t) => t.toLowerCase()));

  // Helper: keep tags that match the prefix (or all, if no prefix).
  const matches = (tag: string) => {
    if (normalisedPrefix.length === 0) return true;
    return tag.toLowerCase().startsWith(normalisedPrefix);
  };

  // 1. Personal history first. Filter to prefix matches + not already on file.
  //    Dedupe within personal history (defensive — caller should already dedupe).
  const seenInPersonal = new Set<string>();
  const personalMatches: string[] = [];
  for (const tag of personalHistory) {
    const key = tag.toLowerCase();
    if (seenInPersonal.has(key)) continue;
    if (usedSet.has(key)) continue;
    if (!matches(tag)) continue;
    seenInPersonal.add(key);
    personalMatches.push(tag);
    if (personalMatches.length >= MAX_SUGGESTIONS) break;
  }

  // 2. AU defaults to fill remainder. Skip any that overlap with personal
  //    history (so "Affidavit" doesn't appear twice if the lawyer has used it).
  const slotsRemaining = MAX_SUGGESTIONS - personalMatches.length;
  if (slotsRemaining === 0) return personalMatches;

  const defaultsToAdd: string[] = [];
  for (const tag of AU_DEFAULT_TAGS) {
    const key = tag.toLowerCase();
    if (usedSet.has(key)) continue;
    if (seenInPersonal.has(key)) continue;
    if (!matches(tag)) continue;
    defaultsToAdd.push(tag);
    if (defaultsToAdd.length >= slotsRemaining) break;
  }

  return [...personalMatches, ...defaultsToAdd];
}
