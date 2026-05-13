// app/(app)/matters/[id]/_components/ai-access-panel.tsx
//
// The AI access control surface for a matter. Lives at the top of the
// Files tab, above the file list.
//
// States:
//
//   off-collapsed       Toggle is off. Single line: "Off — Claude can't
//                       read any files. Turn on →"
//
//   picking             Lawyer clicked the toggle. Panel expands showing:
//                         ◉ No exclusions — Claude reads all files
//                         ○ Exclude specific files
//                         [Cancel] [Confirm]
//                       If "Exclude specific files" is selected, a list
//                       of files with checkboxes appears.
//
//   on-committed        Lawyer confirmed. Shows mode label + summary line.
//                       Edit button reopens the picker.
//
//   on-pending          Lawyer had access committed but a new file was
//                       uploaded. ai_access_committed_at is now NULL.
//                       Panel auto-expands with the new file highlighted,
//                       prompting re-confirm.
//
// FIX: Previous version had literal "\u2014" escape sequences in JSX text,
// which JSX renders as the 6-character string rather than the em-dash.
// JSX text content needs the actual character (em-dash, apostrophe, etc.)
// or it can use JS string expressions like {'\u2014'} as a workaround.
// Here we use the actual characters directly.

'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  AI_ACCESS_MODES,
  AI_ACCESS_MODE_LABELS,
  AI_ACCESS_MODE_DESCRIPTIONS,
  type AiAccessMode,
} from '@/lib/files/ai-access-types';
import { useFiles } from './files-provider';

type PanelMode =
  | 'off-collapsed'
  | 'picking'
  | 'on-committed'
  | 'on-pending';

export function AiAccessPanel() {
  const {
    files,
    aiAccess,
    setAiAccess,
  } = useFiles();

  // Derive panel state from provider state.
  const computedMode = useMemo<PanelMode>(() => {
    if (!aiAccess) return 'off-collapsed';
    if (aiAccess.mode === 'off') return 'off-collapsed';
    if (!aiAccess.isCommitted) return 'on-pending';
    return 'on-committed';
  }, [aiAccess]);

  const [uiMode, setUiMode] = useState<PanelMode>(computedMode);

  useEffect(() => {
    if (uiMode !== 'picking') {
      setUiMode(computedMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedMode]);

  const [pickingMode, setPickingMode] = useState<AiAccessMode>('all');
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (uiMode === 'picking') {
      if (aiAccess) {
        setPickingMode(
          aiAccess.mode === 'off' ? 'all' : aiAccess.mode,
        );
        setExcludedIds(new Set(aiAccess.excludedFileIds));
      } else {
        setPickingMode('all');
        setExcludedIds(new Set());
      }
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiMode]);

  const handleToggleOn = () => {
    setUiMode('picking');
  };

  const handleToggleOff = async () => {
    setIsSaving(true);
    setError(null);
    const result = await setAiAccess({ mode: 'off', excludedFileIds: [] });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error);
    }
  };

  const handleEdit = () => {
    setUiMode('picking');
  };

  const handleCancel = () => {
    setUiMode(computedMode);
    setError(null);
  };

  const handleConfirm = async () => {
    setIsSaving(true);
    setError(null);
    const result = await setAiAccess({
      mode: pickingMode,
      excludedFileIds:
        pickingMode === 'subset' ? Array.from(excludedIds) : [],
    });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUiMode(computedMode);
  };

  const toggleFileExclusion = (fileId: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Render branches
  // ---------------------------------------------------------------------------

  if (uiMode === 'off-collapsed') {
    return (
      <div className="bb-ai-access bb-ai-access--off">
        <div className="bb-ai-access__row">
          <div className="bb-ai-access__main">
            <div className="bb-ai-access__title">AI access</div>
            <div className="bb-ai-access__subtitle">
              Off — Claude can’t read any files in this case.
            </div>
          </div>
          <button
            type="button"
            className="bb-button bb-button--primary"
            onClick={handleToggleOn}
          >
            Turn on
          </button>
        </div>
      </div>
    );
  }

  if (uiMode === 'on-committed') {
    const mode: AiAccessMode = aiAccess?.mode ?? 'all';
    const excludedCount = aiAccess?.excludedFileIds.length ?? 0;
    return (
      <div className="bb-ai-access bb-ai-access--on">
        <div className="bb-ai-access__row">
          <div className="bb-ai-access__main">
            <div className="bb-ai-access__title">
              <span className="bb-ai-access__dot" aria-hidden />
              AI access — {AI_ACCESS_MODE_LABELS[mode]}
            </div>
            <div className="bb-ai-access__subtitle">
              {mode === 'subset' && excludedCount > 0
                ? `Claude can read this case’s files except ${excludedCount} excluded file${excludedCount === 1 ? '' : 's'}.`
                : AI_ACCESS_MODE_DESCRIPTIONS[mode]}
            </div>
          </div>
          <div className="bb-ai-access__actions">
            <button
              type="button"
              className="bb-button bb-button--ghost"
              onClick={handleEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className="bb-button bb-button--ghost bb-button--danger"
              onClick={handleToggleOff}
              disabled={isSaving}
            >
              Turn off
            </button>
          </div>
        </div>
        {error && <div className="bb-ai-access__error">{error}</div>}
      </div>
    );
  }

  if (uiMode === 'on-pending') {
    return (
      <div className="bb-ai-access bb-ai-access--pending">
        <div className="bb-ai-access__row">
          <div className="bb-ai-access__main">
            <div className="bb-ai-access__title">
              <span className="bb-ai-access__dot bb-ai-access__dot--pending" aria-hidden />
              AI access — needs your confirmation
            </div>
            <div className="bb-ai-access__subtitle">
              You’ve added new files since AI access was set up. Confirm
              which files Claude can read before continuing.
            </div>
          </div>
          <button
            type="button"
            className="bb-button bb-button--primary"
            onClick={() => setUiMode('picking')}
          >
            Review
          </button>
        </div>
        {error && <div className="bb-ai-access__error">{error}</div>}
      </div>
    );
  }

  // uiMode === 'picking'
  return (
    <div className="bb-ai-access bb-ai-access--picking">
      <div className="bb-ai-access__head">
        <div className="bb-ai-access__title">AI access — set up</div>
        <p className="bb-ai-access__help">
          Claude will read files from this case to answer your questions.
          Choose what to allow.
        </p>
      </div>

      <fieldset className="bb-ai-access__fieldset">
        <legend className="bb-ai-access__legend">Scope</legend>
        {AI_ACCESS_MODES.filter((m) => m !== 'off').map((m) => (
          <label key={m} className="bb-ai-access__radio">
            <input
              type="radio"
              name="ai-access-mode"
              value={m}
              checked={pickingMode === m}
              onChange={() => setPickingMode(m)}
            />
            <span className="bb-ai-access__radio-label">
              <strong>
                {m === 'all'
                  ? 'No exclusions — Claude reads all files'
                  : 'Exclude specific files'}
              </strong>
              <span className="bb-ai-access__radio-help">
                {m === 'all'
                  ? 'Every file in this case will be readable.'
                  : 'Choose which files Claude shouldn’t read (e.g. privileged correspondence).'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {pickingMode === 'subset' && (
        <fieldset className="bb-ai-access__fieldset bb-ai-access__exclusions">
          <legend className="bb-ai-access__legend">
            Exclude from Claude’s view
          </legend>
          {files.length === 0 ? (
            <p className="bb-ai-access__empty">
              No files in this case yet.
            </p>
          ) : (
            <ul className="bb-ai-access__file-list">
              {files.map((f) => (
                <li key={f.id} className="bb-ai-access__file-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={excludedIds.has(f.id)}
                      onChange={() => toggleFileExclusion(f.id)}
                    />
                    <span className="bb-ai-access__file-name">
                      {f.filename}
                    </span>
                    {f.aiBlockedByUser && (
                      <span className="bb-ai-access__file-badge">
                        Protected
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="bb-ai-access__hint">
            Tip: files marked “Protected” (via a file’s menu) are excluded
            automatically and can’t be made readable here.
          </p>
        </fieldset>
      )}

      <div className="bb-ai-access__actions bb-ai-access__actions--picking">
        <button
          type="button"
          className="bb-button bb-button--ghost"
          onClick={handleCancel}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="bb-button bb-button--primary"
          onClick={handleConfirm}
          disabled={isSaving}
        >
          {isSaving ? 'Saving…' : 'Confirm'}
        </button>
      </div>

      {error && <div className="bb-ai-access__error">{error}</div>}
    </div>
  );
}