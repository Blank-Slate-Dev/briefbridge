// app/(app)/_components/thread-practitioner-picker.tsx
//
// Compact practitioner selector in the chat composer, like a model picker.
// Re-shapes THIS thread without touching the user's profile or the firm's
// assignment.
//
// Resolution chain (lib/practitioner/resolve.ts):
//   thread override (this control) > user setting > firm assignment > default
//
// The selection is held locally and sent with each message. The chat route
// applies it to that request and persists it onto the conversation, so it
// works even before the conversation row exists.
//
// STYLING: deliberately INLINE. An earlier version relied on classes appended
// to shell.css and rendered completely unstyled (no background, no
// positioning, menu in the document flow). Inline styles remove the
// stylesheet-loading dependency entirely — the same fix used on the admin
// analytics page. Colours are literal rather than var(--bb-*) so nothing
// depends on which stylesheet happens to be in scope.

'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  PRACTITIONER_TYPES,
  PRACTITIONER_TYPE_LABELS,
  PRACTITIONER_TYPE_DESCRIPTIONS,
  type PractitionerType,
} from '@/lib/practitioner/types';

const NAVY = '#1a1f2e';
const SOFT = '#3a4256';
const MUTED = '#8a8577';
const BORDER = '#e7e0d2';
const CARD = '#ffffff';

export interface ThreadPractitionerPickerProps {
  value: PractitionerType | null;
  onChange: (next: PractitionerType | null) => void;
  /** What the chain resolves to with no thread override. */
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
  const [hovered, setHovered] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const itemStyle = (key: string, active: boolean): React.CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    width: '100%',
    textAlign: 'left',
    padding: '9px 10px',
    border: 'none',
    borderRadius: 9,
    background: active
      ? 'rgba(201, 162, 75, 0.14)'
      : hovered === key
        ? 'rgba(26, 31, 46, 0.05)'
        : 'transparent',
    font: 'inherit',
    cursor: 'pointer',
  });

  return (
    <div style={{ position: 'relative', flexShrink: 0 }} ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change how this thread is answered"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 10px',
          border: `1px solid ${open ? BORDER : 'transparent'}`,
          borderRadius: 8,
          background: open ? 'rgba(26, 31, 46, 0.04)' : 'transparent',
          font: 'inherit',
          fontSize: 12.5,
          fontWeight: 500,
          color: disabled ? MUTED : SOFT,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        <span>{buttonLabel}</span>
        <ChevronDown size={13} strokeWidth={2} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            right: 0,
            width: 320,
            maxHeight: '60vh',
            overflowY: 'auto',
            padding: 6,
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            boxShadow: '0 12px 32px rgba(26, 31, 46, 0.16)',
            zIndex: 100,
          }}
        >
          <div
            style={{
              padding: '8px 10px 6px',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: MUTED,
            }}
          >
            Answer this thread as…
          </div>

          <button
            type="button"
            role="menuitemradio"
            aria-checked={value === null}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            onMouseEnter={() => setHovered('__inherit')}
            onMouseLeave={() => setHovered(null)}
            style={itemStyle('__inherit', value === null)}
          >
            <span style={{ fontSize: 13.5, fontWeight: 500, color: NAVY }}>
              Follow my profile
              {inheritedLabel ? ` (${inheritedLabel})` : ''}
            </span>
            <span style={{ fontSize: 11.5, lineHeight: 1.45, color: MUTED }}>
              Use your saved practitioner settings.
            </span>
          </button>

          <div
            style={{
              height: 1,
              margin: '6px 10px',
              background: BORDER,
            }}
          />

          {PRACTITIONER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={value === t}
              onClick={() => {
                onChange(t);
                setOpen(false);
              }}
              onMouseEnter={() => setHovered(t)}
              onMouseLeave={() => setHovered(null)}
              style={itemStyle(t, value === t)}
            >
              <span style={{ fontSize: 13.5, fontWeight: 500, color: NAVY }}>
                {PRACTITIONER_TYPE_LABELS[t]}
              </span>
              <span style={{ fontSize: 11.5, lineHeight: 1.45, color: MUTED }}>
                {PRACTITIONER_TYPE_DESCRIPTIONS[t]}
              </span>
            </button>
          ))}

          <p
            style={{
              margin: '8px 10px 4px',
              fontSize: 11,
              lineHeight: 1.45,
              color: MUTED,
            }}
          >
            Changes the shape of the answer only — never which law is searched.
          </p>
        </div>
      )}
    </div>
  );
}