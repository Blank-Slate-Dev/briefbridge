// app/(app)/settings/_components/practitioner-settings-form.tsx
//
// The practitioner-profile form. Client Component: local selection state,
// then one server action call on save.
//
// Seeded with server-fetched values (initialType / initialAreas) so it renders
// correctly on first paint with no client fetch.

'use client';

import { useState, useTransition } from 'react';
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

interface Props {
  initialType: PractitionerType | null;
  initialAreas: PracticeArea[];
}

export function PractitionerSettingsForm({ initialType, initialAreas }: Props) {
  const [type, setType] = useState<PractitionerType | null>(initialType);
  const [areas, setAreas] = useState<Set<PracticeArea>>(
    () => new Set(initialAreas),
  );
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const atLimit = areas.size >= MAX_PRACTICE_AREAS;

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

  function handleSave() {
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const result = await savePractitionerProfileAction({
        practitionerType: type,
        practiceAreas: Array.from(areas),
      });
      setStatus(
        result.ok
          ? { kind: 'saved' }
          : { kind: 'error', message: result.error },
      );
    });
  }

  return (
    <div className="bb-settings-body">
      {/* ---------------- Practitioner type ---------------- */}
      <section className="bb-settings-card">
        <h2 className="bb-settings-card-title">How do you practise?</h2>
        <p className="bb-settings-card-help">
          Determines the shape of every answer — what leads, how much doctrine
          is assumed, and whether counter-arguments are surfaced.
        </p>

        <div className="bb-settings-options">
          {PRACTITIONER_TYPES.map((t) => {
            const selected = type === t;
            return (
              <button
                key={t}
                type="button"
                className={`bb-settings-option${selected ? ' bb-settings-option-selected' : ''}`}
                onClick={() => {
                  setStatus({ kind: 'idle' });
                  setType(selected ? null : t);
                }}
                aria-pressed={selected}
              >
                <span className="bb-settings-option-label">
                  {PRACTITIONER_TYPE_LABELS[t]}
                </span>
                <span className="bb-settings-option-desc">
                  {PRACTITIONER_TYPE_DESCRIPTIONS[t]}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---------------- Practice areas ---------------- */}
      <section className="bb-settings-card">
        <h2 className="bb-settings-card-title">Your practice areas</h2>
        <p className="bb-settings-card-help">
          Up to {MAX_PRACTICE_AREAS}. These add emphasis — authority from your
          areas leads where it's on point.{' '}
          <strong>
            Nothing is ever excluded from the search: cross-disciplinary
            authority is often decisive and will always be surfaced.
          </strong>
        </p>

        <div className="bb-settings-chips">
          {PRACTICE_AREAS.map((a) => {
            const selected = areas.has(a);
            const disabled = !selected && atLimit;
            return (
              <button
                key={a}
                type="button"
                className={`bb-settings-chip${selected ? ' bb-settings-chip-selected' : ''}`}
                onClick={() => toggleArea(a)}
                disabled={disabled}
                aria-pressed={selected}
                title={
                  disabled
                    ? `Deselect one to choose another (max ${MAX_PRACTICE_AREAS})`
                    : undefined
                }
              >
                {PRACTICE_AREA_LABELS[a]}
              </button>
            );
          })}
        </div>
        <p className="bb-settings-count">
          {areas.size} of {MAX_PRACTICE_AREAS} selected
        </p>
      </section>

      {/* ---------------- Save ---------------- */}
      <div className="bb-settings-actions">
        <button
          type="button"
          className="bb-btn bb-btn-primary"
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? 'Saving…' : 'Save preferences'}
        </button>
        {status.kind === 'saved' && (
          <span className="bb-settings-status bb-settings-status-ok">
            Saved — your next research session will use this.
          </span>
        )}
        {status.kind === 'error' && (
          <span className="bb-settings-status bb-settings-status-error">
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}