// app/(app)/settings/_components/practitioner-settings-form.tsx
//
// The practitioner-profile form. Client Component: local selection state,
// then one server action call on save.
//
// Seeded with server-fetched values (initialType / initialAreas) so it renders
// correctly on first paint with no client fetch.
//
// =============================================================================
// TWO CONTROLS, TWO SHAPES OF INDICATOR
// =============================================================================
//
// Practitioner type is SINGLE-select: .bb-opt-card with a ROUND dot, the plan
// chooser's treatment at about a third of the size.
//
// Practice areas are MULTI-select: .bb-multi-item with a SQUARE checkbox, in
// a fixed grid. They were pills, which wrapped into a ragged block — four on
// one line, three on the next, one stranded — with no alignment anywhere.
// Beside the neat card grid above, that read as scattered. A grid gives every
// option the same box and a straight edge down each column.
//
// The round/square distinction is the whole affordance: it tells the user
// whether choosing one thing will unchoose another, before they click.
//
// DIRTY TRACKING + STICKY SAVE. The save bar appears only when something has
// actually changed, and follows the viewport. A permanently visible Save
// button gives no signal about whether it needs pressing.

'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  PRACTITIONER_TYPES,
  PRACTITIONER_TYPE_LABELS,
  PRACTITIONER_TYPE_DESCRIPTIONS,
  PRACTICE_AREAS,
  PRACTICE_AREA_LABELS,
  MAX_PRACTICE_AREAS,
  type PractitionerType,
  type PracticeArea,
} from '@/lib/practitioner/types';
import { savePractitionerProfileAction } from '../_actions';

/** Save-button state. Named rather than inlined so the useState call fits on
 *  a single line — an inline union here spans three lines and is fragile. */
type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

interface Props {
  initialType: PractitionerType | null;
  initialAreas: PracticeArea[];
}

/** Order-insensitive comparison — selection order is not meaningful. */
function sameAreas(a: PracticeArea[], b: Set<PracticeArea>): boolean {
  if (a.length !== b.size) return false;
  return a.every((x) => b.has(x));
}

export function PractitionerSettingsForm({ initialType, initialAreas }: Props) {
  const [type, setType] = useState<PractitionerType | null>(initialType);
  const [areas, setAreas] = useState<Set<PracticeArea>>(
    () => new Set(initialAreas),
  );
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });

  const atLimit = areas.size >= MAX_PRACTICE_AREAS;

  const dirty = useMemo(
    () => type !== initialType || !sameAreas(initialAreas, areas),
    [type, areas, initialType, initialAreas],
  );

  function toggleArea(a: PracticeArea) {
    setStatus({ kind: 'idle' });
    setAreas((prev) => {
      const next = new Set(prev);
      if (next.has(a)) {
        next.delete(a);
      } else if (next.size < MAX_PRACTICE_AREAS) {
        next.add(a);
      }
      return next;
    });
  }

  function handleReset() {
    setStatus({ kind: 'idle' });
    setType(initialType);
    setAreas(new Set(initialAreas));
  }

  function handleSave() {
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const result = await savePractitionerProfileAction({
        practitionerType: type,
        practiceAreas: Array.from(areas),
      });
      setStatus(
        result.ok ? { kind: 'saved' } : { kind: 'error', message: result.error },
      );
    });
  }

  return (
    <div>
      <div className="bb-set-list">
        {/* ---------------- Practitioner type (single-select) ------------- */}
        <div className="bb-set-row">
          <div className="bb-set-label">
            <p className="bb-set-label-title">How you practise</p>
            <p className="bb-set-label-help">
              Sets the shape of every answer — what leads, how much doctrine is
              assumed, and whether counter-arguments are surfaced.
            </p>
          </div>

          <div className="bb-set-control">
            <div
              className="bb-opt-grid"
              role="radiogroup"
              aria-label="How you practise"
            >
              {PRACTITIONER_TYPES.map((t) => {
                const selected = type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`bb-opt-card${selected ? ' bb-opt-card-selected' : ''}`}
                    onClick={() => {
                      setStatus({ kind: 'idle' });
                      setType(selected ? null : t);
                    }}
                  >
                    <span className="bb-opt-head">
                      <span className="bb-choice-dot" aria-hidden="true" />
                      <span className="bb-opt-name">
                        {PRACTITIONER_TYPE_LABELS[t]}
                      </span>
                    </span>
                    <span className="bb-opt-desc">
                      {PRACTITIONER_TYPE_DESCRIPTIONS[t]}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="bb-set-control-note">
              Click a selected option again to clear it.
            </p>
          </div>
        </div>

        {/* ---------------- Practice areas (multi-select) ----------------- */}
        <div className="bb-set-row">
          <div className="bb-set-label">
            <p className="bb-set-label-title">Practice areas</p>
            <p className="bb-set-label-help">
              Up to {MAX_PRACTICE_AREAS}. Adds emphasis only.{' '}
              <strong>
                Nothing is excluded from the search — cross-disciplinary
                authority is often decisive and is always surfaced.
              </strong>
            </p>
          </div>

          <div className="bb-set-control">
            <div className="bb-multi-grid" role="group" aria-label="Practice areas">
              {PRACTICE_AREAS.map((a) => {
                const selected = areas.has(a);
                const disabled = !selected && atLimit;
                return (
                  <button
                    key={a}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    className={`bb-multi-item${selected ? ' bb-multi-item-selected' : ''}`}
                    onClick={() => toggleArea(a)}
                    disabled={disabled}
                    title={
                      disabled
                        ? `Deselect one to choose another (max ${MAX_PRACTICE_AREAS})`
                        : undefined
                    }
                  >
                    <span className="bb-check-box" aria-hidden="true" />
                    <span>{PRACTICE_AREA_LABELS[a]}</span>
                  </button>
                );
              })}
            </div>
            <p className="bb-settings-count">
              {areas.size} of {MAX_PRACTICE_AREAS} selected
            </p>
          </div>
        </div>
      </div>

      {/* ---------------- Save bar ---------------- */}
      {(dirty || status.kind !== 'idle') && (
        <div className="bb-savebar">
          <span className="bb-savebar-text">
            {status.kind === 'saved' && !dirty
              ? 'Saved — your next research session will use this.'
              : 'You have unsaved changes.'}
          </span>
          <div className="bb-savebar-actions">
            {status.kind === 'error' && (
              <span className="bb-savebar-error">{status.message}</span>
            )}
            {dirty && (
              <button
                type="button"
                className="bb-btn bb-btn-small bb-btn-ghost"
                onClick={handleReset}
                disabled={isPending}
              >
                Discard
              </button>
            )}
            {dirty && (
              <button
                type="button"
                className="bb-btn bb-btn-small bb-btn-primary"
                onClick={handleSave}
                disabled={isPending}
              >
                {isPending ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}