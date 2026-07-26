// app/(app)/firm/_components/firm-page-client.tsx
//
// Firm management UI (client component).
//
//   - Firm name header.
//   - Members list (name, email, role).
//   - Invite form (email + role) — only if the caller can manage (owner/admin).
//   - Pending invites list, each with "Copy invite link" + "Revoke".
//
// State: seeded from server props, then kept fresh by calling listFirmDataAction
// after a successful invite/revoke (re-pulls members + invites). We use that
// instead of router.refresh() so the invite form's just-created link stays
// visible without a full server round-trip wiping local UI state.
//
// Styling: uses bb-firm-* class names (new) + a couple of existing bb-shell-*
// patterns. Style bb-firm-* to match the design system.

'use client';

import './firm.css';
import { useEffect, useState } from 'react';
import type { FirmRole } from '@/lib/db/schema';
import type {
  FirmMemberRow,
  InvitableRole,
} from '@/lib/db/queries/firm-invitations';
import type { FirmInvitation } from '@/lib/db/schema';
import {
  createInvitationAction,
  revokeInvitationAction,
  listFirmDataAction,
  setMemberPractitionerAction,
  listMemberPractitionersAction,
} from '../../_actions/firm';
import {
  PRACTITIONER_TYPES,
  PRACTITIONER_TYPE_LABELS,
  PRACTICE_AREAS,
  PRACTICE_AREA_LABELS,
  MAX_PRACTICE_AREAS,
  type PractitionerType,
  type PracticeArea,
} from '@/lib/practitioner/types';

const INVITE_ROLES: InvitableRole[] = ['admin', 'lawyer', 'paralegal'];

function roleLabel(role: FirmRole): string {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'admin':
      return 'Admin';
    case 'lawyer':
      return 'Lawyer';
    case 'paralegal':
      return 'Paralegal';
    default:
      return role;
  }
}

export interface FirmPageClientProps {
  firmId: string;
  firmName: string;
  myUserId: string;
  myRole: FirmRole;
  canManage: boolean;
  initialMembers: FirmMemberRow[];
  initialInvitations: FirmInvitation[];
}

export function FirmPageClient({
  firmId,
  firmName,
  myUserId,
  canManage,
  initialMembers,
  initialInvitations,
}: FirmPageClientProps) {
  const [members, setMembers] = useState<FirmMemberRow[]>(initialMembers);
  const [invitations, setInvitations] =
    useState<FirmInvitation[]>(initialInvitations);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('lawyer');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Firm-assigned practitioner defaults, keyed by userId. A FALLBACK only:
  // a member who sets their own profile keeps theirs. See the resolution
  // chain in lib/practitioner/resolve.ts.
  const [assignments, setAssignments] = useState<
    Record<string, { type: PractitionerType | null; areas: PracticeArea[] }>
  >({});
  const [editingMember, setEditingMember] = useState<string | null>(null);

  // Load assignments once. The member list comes from a SECURITY DEFINER
  // function that doesn't return these columns, so they're fetched separately.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listMemberPractitionersAction(firmId);
      if (cancelled || !result.ok) return;
      const map: Record<
        string,
        { type: PractitionerType | null; areas: PracticeArea[] }
      > = {};
      for (const a of result.data.assignments) {
        map[a.userId] = {
          type: (a.practitionerType as PractitionerType | null) ?? null,
          areas: (a.practiceAreas as PracticeArea[]) ?? [],
        };
      }
      setAssignments(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [firmId]);

  // Re-pull members + pending invites from the server.
  async function refresh() {
    const result = await listFirmDataAction(firmId);
    if (result.ok) {
      setMembers(result.data.members);
      setInvitations(result.data.invitations);
    }
  }

  async function handleInvite() {
    if (submitting) return;
    setError(null);

    const trimmed = email.trim();
    if (trimmed.length === 0) {
      setError('Enter an email address.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createInvitationAction(firmId, trimmed, role);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEmail('');
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(invitationId: string) {
    const result = await revokeInvitationAction(invitationId);
    if (result.ok) {
      await refresh();
    } else {
      setError(result.error);
    }
  }

  function inviteLink(token: string): string {
    if (typeof window === 'undefined') return `/invite/${token}`;
    return `${window.location.origin}/invite/${token}`;
  }

  async function handleCopyLink(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 2000);
    } catch {
      // Clipboard may be unavailable (insecure context); fall back to prompt.
      // eslint-disable-next-line no-alert
      window.prompt('Copy this invite link:', inviteLink(token));
    }
  }

  return (
    <div className="bb-firm-page">
      <header className="bb-firm-header">
        <h1 className="bb-firm-title">{firmName}</h1>
        <p className="bb-firm-subtitle">
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </p>
      </header>

      {/* Invite form — owner/admin only */}
      {canManage && (
        <section className="bb-firm-section">
          <h2 className="bb-firm-section-title">Invite a teammate</h2>
          <div className="bb-firm-invite-form">
            <input
              type="email"
              className="bb-firm-input"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              aria-label="Email to invite"
            />
            <select
              className="bb-firm-select"
              value={role}
              onChange={(e) => setRole(e.target.value as InvitableRole)}
              disabled={submitting}
              aria-label="Role"
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bb-firm-button"
              onClick={handleInvite}
              disabled={submitting}
            >
              {submitting ? 'Sending…' : 'Send invite'}
            </button>
          </div>
          {error && <p className="bb-firm-error">{error}</p>}
        </section>
      )}

      {/* Pending invites */}
      {canManage && invitations.length > 0 && (
        <section className="bb-firm-section">
          <h2 className="bb-firm-section-title">Pending invites</h2>
          <ul className="bb-firm-list">
            {invitations.map((inv) => (
              <li key={inv.id} className="bb-firm-list-item">
                <div className="bb-firm-list-main">
                  <span className="bb-firm-list-name">{inv.email}</span>
                  <span className="bb-firm-list-meta">
                    {roleLabel(inv.role)} · invited
                  </span>
                </div>
                <div className="bb-firm-list-actions">
                  <button
                    type="button"
                    className="bb-firm-link-button"
                    onClick={() => handleCopyLink(inv.token)}
                  >
                    {copiedToken === inv.token ? 'Copied!' : 'Copy invite link'}
                  </button>
                  <button
                    type="button"
                    className="bb-firm-link-button bb-firm-link-danger"
                    onClick={() => handleRevoke(inv.id)}
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Members */}
      <section className="bb-firm-section">
        <h2 className="bb-firm-section-title">Members</h2>
        <ul className="bb-firm-list">
          {members.map((m) => (
            <li key={m.userId} className="bb-firm-list-item">
              <div className="bb-firm-list-main">
                <span className="bb-firm-list-name">
                  {m.fullName ?? m.email}
                  {m.userId === myUserId && (
                    <span className="bb-firm-you-badge"> (you)</span>
                  )}
                </span>
                <span className="bb-firm-list-meta">
                  {m.email} · {roleLabel(m.role)}
                </span>
                <PractitionerSummary assignment={assignments[m.userId]} />
              </div>
              {canManage && (
                <button
                  type="button"
                  className="bb-firm-assign-btn"
                  onClick={() =>
                    setEditingMember(
                      editingMember === m.userId ? null : m.userId,
                    )
                  }
                >
                  {editingMember === m.userId ? "Close" : "Set default"}
                </button>
              )}
              {canManage && editingMember === m.userId && (
                <PractitionerAssigner
                  firmId={firmId}
                  memberUserId={m.userId}
                  initial={assignments[m.userId]}
                  onSaved={(next) => {
                    setAssignments((prev) => ({ ...prev, [m.userId]: next }));
                    setEditingMember(null);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// =============================================================================
// Practitioner assignment sub-components
// =============================================================================

/** Compact read-only line under a member's email showing what's assigned. */
function PractitionerSummary({
  assignment,
}: {
  assignment?: { type: PractitionerType | null; areas: PracticeArea[] };
}) {
  if (!assignment || (!assignment.type && assignment.areas.length === 0)) {
    return (
      <span className="bb-firm-list-assign bb-firm-list-assign-empty">
        No firm default set
      </span>
    );
  }
  const parts: string[] = [];
  if (assignment.type) parts.push(PRACTITIONER_TYPE_LABELS[assignment.type]);
  if (assignment.areas.length > 0) {
    parts.push(assignment.areas.map((a) => PRACTICE_AREA_LABELS[a]).join(', '));
  }
  return (
    <span className="bb-firm-list-assign">Firm default: {parts.join(' · ')}</span>
  );
}

/**
 * Inline editor for one member's firm-assigned defaults. Owner/admin only
 * (the parent gates on canManage, and RLS is the real guard).
 */
function PractitionerAssigner({
  firmId,
  memberUserId,
  initial,
  onSaved,
}: {
  firmId: string;
  memberUserId: string;
  initial?: { type: PractitionerType | null; areas: PracticeArea[] };
  onSaved: (next: {
    type: PractitionerType | null;
    areas: PracticeArea[];
  }) => void;
}) {
  const [type, setType] = useState<PractitionerType | null>(
    initial?.type ?? null,
  );
  const [areas, setAreas] = useState<Set<PracticeArea>>(
    () => new Set(initial?.areas ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atLimit = areas.size >= MAX_PRACTICE_AREAS;

  function toggleArea(a: PracticeArea) {
    setAreas((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else if (next.size < MAX_PRACTICE_AREAS) next.add(a);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await setMemberPractitionerAction(
      firmId,
      memberUserId,
      type,
      Array.from(areas),
    );
    setSaving(false);
    if (result.ok) {
      onSaved({ type, areas: Array.from(areas) });
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="bb-firm-assigner">
      <p className="bb-firm-assigner-help">
        A starting point for this member. If they set their own practitioner
        profile, theirs takes precedence — and any single research thread can
        still be changed on the fly.
      </p>

      <div className="bb-firm-assigner-row">
        <label className="bb-firm-assigner-label" htmlFor={`type-${memberUserId}`}>
          Practitioner type
        </label>
        <select
          id={`type-${memberUserId}`}
          className="bb-firm-select"
          value={type ?? ''}
          onChange={(e) =>
            setType(
              e.target.value === ''
                ? null
                : (e.target.value as PractitionerType),
            )
          }
        >
          <option value="">No default</option>
          {PRACTITIONER_TYPES.map((t) => (
            <option key={t} value={t}>
              {PRACTITIONER_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="bb-firm-assigner-row">
        <span className="bb-firm-assigner-label">
          Practice areas ({areas.size}/{MAX_PRACTICE_AREAS})
        </span>
        <div className="bb-firm-assigner-chips">
          {PRACTICE_AREAS.map((a) => {
            const selected = areas.has(a);
            return (
              <button
                key={a}
                type="button"
                className={`bb-firm-chip${selected ? ' bb-firm-chip-selected' : ''}`}
                onClick={() => toggleArea(a)}
                disabled={!selected && atLimit}
                aria-pressed={selected}
              >
                {PRACTICE_AREA_LABELS[a]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bb-firm-assigner-actions">
        <button
          type="button"
          className="bb-btn bb-btn-primary bb-btn-small"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save default'}
        </button>
        {error && <span className="bb-firm-error">{error}</span>}
      </div>
    </div>
  );
}