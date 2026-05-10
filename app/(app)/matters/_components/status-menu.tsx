// app/(app)/matters/_components/status-menu.tsx
//
// Status pill that doubles as a dropdown trigger.
//
// Default state:
//   [● Active]
//
// On hover:
//   The dot shape slides aside and a ⋯ icon fades in, signalling
//   "this is interactive". The pill background also lightens slightly
//   to reinforce affordance.
//
// On click:
//   A dropdown opens below the pill with all six status options. Each
//   shows its colored dot and label, and the currently-selected status
//   gets a subtle check mark. Click outside or press Escape to close.
//
// Click handling note:
//   When this component sits inside a <Link> (the matter cards on /matters
//   are clickable cards), clicks on the pill must NOT bubble up and trigger
//   navigation. We stopPropagation + preventDefault on the trigger and the
//   menu items.
//
// Accessibility:
//   - Trigger is a <button> with aria-haspopup="listbox" and aria-expanded
//   - Dropdown is a <ul role="listbox"> with each option as a role="option"
//   - Escape closes the menu
//   - Tab/Shift+Tab cycle through options once open

'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  MATTER_STATUSES,
  STATUS_DESCRIPTIONS,
  STATUS_LABELS,
  type MatterStatus,
} from '../_data/mock-matters';
import { useMatters } from './matters-provider';

interface StatusMenuProps {
  matterId: string;
  /**
   * Visual size of the pill.
   *   'card' = compact, used on matter cards
   *   'header' = larger, used in the matter detail page header
   */
  size?: 'card' | 'header';
}

export function StatusMenu({ matterId, size = 'card' }: StatusMenuProps) {
  const { findMatter, updateStatus } = useMatters();
  const matter = findMatter(matterId);
  const status = matter?.status ?? 'active';

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ---- Close on outside click ----
  // Use pointerdown (unified across mouse/touch/pen) instead of mousedown,
  // which on iOS Safari can fire inconsistently relative to touch events.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // ---- Close on Escape ----
  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // ---- Stop the parent <Link> from navigating ----
  const stopParent = useCallback(
    (e: ReactMouseEvent | ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    [],
  );

  // Use pointerdown to open the menu instead of click. On iOS Safari, when
  // an element has :hover styling, the FIRST tap fires :hover but suppresses
  // click — requiring a second tap. pointerdown fires on every tap, so this
  // bypasses the suppression entirely.
  function handleTriggerPointerDown(e: ReactPointerEvent) {
    stopParent(e);
    setOpen((v) => !v);
  }

  // Also keep onClick as a fallback for non-pointer environments and to
  // ensure the parent Link's click is suppressed on every browser.
  function handleTriggerClick(e: ReactMouseEvent) {
    stopParent(e);
  }

  function handleSelectPointerDown(e: ReactPointerEvent, next: MatterStatus) {
    stopParent(e);
    if (next !== status) {
      updateStatus(matterId, next);
    }
    setOpen(false);
  }

  function handleSelectClick(e: ReactMouseEvent) {
    stopParent(e);
  }

  // Keyboard navigation inside the menu.
  function handleMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`bb-status-menu bb-status-menu-${size}`}
      // Stop ALL pointer events from bubbling — the parent <Link> shouldn't
      // even get hover-styling from interactions inside this component.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`bb-status-trigger bb-status-${status}`}
        onPointerDown={handleTriggerPointerDown}
        onClick={handleTriggerClick}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Change status (currently ${STATUS_LABELS[status]})`}
        title="Click to change status"
      >
        <span className="bb-status-dot" aria-hidden />
        <span className="bb-status-label">{STATUS_LABELS[status]}</span>
        <span className="bb-status-dots" aria-hidden>
          ⋯
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="bb-status-menu-list"
          onKeyDown={handleMenuKey}
          aria-label="Select status"
        >
          {MATTER_STATUSES.map((s) => (
            <li
              key={s}
              role="option"
              aria-selected={s === status}
            >
              <button
                type="button"
                className={`bb-status-option ${s === status ? 'bb-status-option-active' : ''}`}
                onPointerDown={(e) => handleSelectPointerDown(e, s)}
                onClick={handleSelectClick}
              >
                <span
                  className={`bb-status-option-dot bb-status-${s}-dot`}
                  aria-hidden
                />
                <span className="bb-status-option-body">
                  <span className="bb-status-option-label">
                    {STATUS_LABELS[s]}
                  </span>
                  <span className="bb-status-option-desc">
                    {STATUS_DESCRIPTIONS[s]}
                  </span>
                </span>
                {s === status && (
                  <span className="bb-status-option-check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
