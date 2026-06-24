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
import { useState } from 'react';
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
} from '../../_actions/firm';

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
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}