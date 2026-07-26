// app/(app)/_components/thread-practitioner-picker.tsx
//
// Compact practitioner selector that lives in the chat composer, like a model
// picker. Lets a user re-shape THIS research thread without touching their
// own profile or the firm's assignment.
//
// Resolution chain (lib/practitioner/resolve.ts):
//   thread override (this control) > user setting > firm assignment > default
//
// The selection is held in local state and sent with each message. The chat
// route uses it for that request and persists it onto the conversation, so it
// works even before the conversation row exists (first message in a new
// thread).

'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  PRACTITIONER_TYPES,
  PRACTITIONER_TYPE_LABELS,
  PRACTITIONER_TYPE_DESCRIPTIONS,
  type PractitionerType,
} from '@/lib/practitioner/types';

export interface ThreadPractitionerPickerProps {
  /** Currently selected override, or null to follow the user's own setting. */
  value: PractitionerType | null;
  onChange: (next: PractitionerType | null) => void;
  /**
   * What the chain resolves to when there is no thread override — shown as
   * the label on the "Follow my profile" option so the user knows what
   * they'd fall back to.
   */
  inheritedLabel?: string | null;
  disabled?: boolean;
}

export function ThreadPractitionerPicker({
  value,
  onChange,
  inheritedLabel,
  disabled,
}: ThreadPractitionerPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const buttonLabel = value
    ? PRACTITIONER_TYPE_LABELS[value]
    : (inheritedLabel ?? 'Default');

  return (
    <div className="bb-prac-picker" ref={rootRef}>
      <button
        type="button"
        className="bb-prac-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change how this thread is answered"
      >
        <span className="bb-prac-picker-value">{buttonLabel}</span>
        <ChevronDown size={13} strokeWidth={2} aria-hidden />
      </button>

      {open && (
        <div className="bb-prac-picker-menu" role="menu">
          <div className="bb-prac-picker-menu-head">Answer this thread as…</div>

          <button
            type="button"
            role="menuitemradio"
            aria-checked={value === null}
            className={`bb-prac-picker-item${value === null ? ' bb-prac-picker-item-active' : ''}`}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <span className="bb-prac-picker-item-label">
              Follow my profile
              {inheritedLabel ? ` (${inheritedLabel})` : ''}
            </span>
            <span className="bb-prac-picker-item-desc">
              Use your saved practitioner settings.
            </span>
          </button>

          <div className="bb-prac-picker-divider" />

          {PRACTITIONER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={value === t}
              className={`bb-prac-picker-item${value === t ? ' bb-prac-picker-item-active' : ''}`}
              onClick={() => {
                onChange(t);
                setOpen(false);
              }}
            >
              <span className="bb-prac-picker-item-label">
                {PRACTITIONER_TYPE_LABELS[t]}
              </span>
              <span className="bb-prac-picker-item-desc">
                {PRACTITIONER_TYPE_DESCRIPTIONS[t]}
              </span>
            </button>
          ))}

          <p className="bb-prac-picker-foot">
            Changes the shape of the answer only — never which law is searched.
          </p>
        </div>
      )}
    </div>
  );
}