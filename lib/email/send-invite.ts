// lib/email/send-invite.ts
//
// Sends a firm-invitation email via Resend. Called from createInvitationAction
// after the invite row is created. Failures are logged but NOT thrown — a
// failed email shouldn't break invite creation (the owner can still copy the
// link manually).

import { Resend } from 'resend';

const FROM = 'BriefBridge <invites@briefbridge.com.au>';

export interface SendInviteEmailParams {
  to: string;
  firmName: string;
  role: string;
  inviteLink: string;
  inviterName?: string | null;
}

function roleLabel(role: string): string {
  switch (role) {
    case 'admin':
      return 'an Admin';
    case 'lawyer':
      return 'a Lawyer';
    case 'paralegal':
      return 'a Paralegal';
    default:
      return `a ${role}`;
  }
}

/**
 * Sends the invite email. Returns { ok } — never throws. If RESEND_API_KEY is
 * missing, logs and no-ops (so local dev without the key still works; the link
 * is copyable in the UI regardless).
 */
export async function sendInviteEmail(
  params: SendInviteEmailParams,
): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn('sendInviteEmail: RESEND_API_KEY not set — skipping email.');
    return { ok: false };
  }

  const resend = new Resend(apiKey);

  const inviter = params.inviterName?.trim();
  const introLine = inviter
    ? `${inviter} has invited you to join ${params.firmName} on BriefBridge.`
    : `You've been invited to join ${params.firmName} on BriefBridge.`;

  const subject = `You're invited to ${params.firmName} on BriefBridge`;

  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f4efe6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe6;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e0d2;border-radius:16px;padding:40px 36px;">
            <tr>
              <td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:#1a1f2e;padding-bottom:24px;">
                BriefBridge
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.55;color:#3a4256;padding-bottom:8px;">
                ${introLine}
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:1.55;color:#6b7280;padding-bottom:28px;">
                You'll join as ${roleLabel(params.role)}.
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:28px;">
                <a href="${params.inviteLink}" style="display:inline-block;background:#1a1f2e;color:#f4efe6;text-decoration:none;font-size:15px;font-weight:500;padding:13px 28px;border-radius:10px;">
                  Accept invitation
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;line-height:1.5;color:#9aa0ab;border-top:1px solid #e7e0d2;padding-top:20px;">
                Or paste this link into your browser:<br />
                <a href="${params.inviteLink}" style="color:#6b7280;word-break:break-all;">${params.inviteLink}</a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#9aa0ab;padding-top:20px;">
                This invitation expires in 14 days. If you weren't expecting it, you can ignore this email.
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;padding-top:20px;">
            <tr>
              <td align="center" style="font-size:12px;color:#9aa0ab;">
                BriefBridge — legal research &amp; case management
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  const text = `${introLine}

You'll join as ${roleLabel(params.role)}.

Accept your invitation:
${params.inviteLink}

This invitation expires in 14 days. If you weren't expecting it, you can ignore this email.

BriefBridge`;

  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: params.to,
      subject,
      html,
      text,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('sendInviteEmail: Resend error:', error);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('sendInviteEmail: threw:', err);
    return { ok: false };
  }
}