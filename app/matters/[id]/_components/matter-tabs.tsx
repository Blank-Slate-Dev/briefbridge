// app/matters/[id]/_components/matter-tabs.tsx
//
// Client component for the tabbed view inside a matter workspace.
// Tabs: Chat | Files | Conversations | Authorities | Notes
//
// All content is layout-only mock data. The Chat tab renders a fake
// conversation styled like the live /chat UI to show what an in-context
// conversation looks like inside a matter.

'use client';

import { useState, type FormEvent } from 'react';
import type { MockMatter } from '../../_data/mock-matters';

type TabKey = 'chat' | 'files' | 'conversations' | 'authorities' | 'notes';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'files', label: 'Files' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'authorities', label: 'Authorities' },
  { key: 'notes', label: 'Notes' },
];

export function MatterTabs({ matter }: { matter: MockMatter }) {
  const [active, setActive] = useState<TabKey>('chat');

  return (
    <div className="bb-matter-tabs">
      <nav className="bb-matter-tablist" role="tablist" aria-label="Case sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            className={`bb-matter-tab ${active === tab.key ? 'bb-matter-tab-active' : ''}`}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
            {tab.key === 'files' && (
              <span className="bb-matter-tab-count">{matter.files.length}</span>
            )}
            {tab.key === 'conversations' && (
              <span className="bb-matter-tab-count">{matter.conversations.length}</span>
            )}
            {tab.key === 'authorities' && (
              <span className="bb-matter-tab-count">{matter.authorities.length}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="bb-matter-tabpanel" role="tabpanel">
        {active === 'chat' && <ChatTab matter={matter} />}
        {active === 'files' && <FilesTab matter={matter} />}
        {active === 'conversations' && <ConversationsTab matter={matter} />}
        {active === 'authorities' && <AuthoritiesTab matter={matter} />}
        {active === 'notes' && <NotesTab matter={matter} />}
      </div>
    </div>
  );
}

// =============================================================================
// Chat tab
// =============================================================================

function ChatTab({ matter }: { matter: MockMatter }) {
  const [draft, setDraft] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Placeholder — real chat persistence + streaming arrives with auth.
  }

  // Pick the most recent mock conversation as the visible chat content.
  const featuredConversation = matter.conversations[0];

  return (
    <div className="bb-matter-chat">
      <div className="bb-matter-chat-context">
        <span className="bb-matter-chat-context-label">In context</span>
        <span className="bb-matter-chat-context-name">{matter.name}</span>
        <span className="bb-matter-chat-context-meta">
          {matter.fileCount} files · {matter.citedAuthorities} authorities
        </span>
      </div>

      {featuredConversation ? (
        <div className="bb-matter-chat-messages">
          <UserMessage>
            What English cases have considered whether anti-avoidance
            endorsements in ATE policies provide adequate security for costs?
          </UserMessage>
          <AssistantMessage matter={matter} />
        </div>
      ) : (
        <div className="bb-matter-chat-empty">
          <h3>Ask a question in this case&apos;s context</h3>
          <p>
            BriefBridge will use the case files, authorities, and prior
            conversations from this case to ground its answer.
          </p>
        </div>
      )}

      <form className="bb-matter-chat-input" onSubmit={handleSubmit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask anything about this case..."
          rows={2}
          aria-label="Your question"
        />
        <button type="submit" disabled className="bb-btn bb-btn-primary">
          Send
        </button>
      </form>
      <p className="bb-matter-chat-disclaimer">
        Generated research assistance. Verify authorities against official
        sources before reliance.
      </p>
    </div>
  );
}

function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="bb-matter-msg bb-matter-msg-user">
      <div className="bb-matter-msg-bubble">{children}</div>
    </div>
  );
}

function AssistantMessage({ matter }: { matter: MockMatter }) {
  // Render a stylised mock answer matching the i-Prosperity test conversation.
  const answer = matter.id === 'smith-jones-2026'
    ? buildSmithJonesAnswer()
    : buildGenericAnswer(matter);

  return (
    <div className="bb-matter-msg bb-matter-msg-assistant">
      <div className="bb-matter-msg-prose">{answer}</div>

      <details className="bb-matter-citations">
        <summary>
          <span className="bb-matter-citations-arrow">›</span>
          {matter.authorities.length} sources cited
        </summary>
        <ul className="bb-matter-citations-list">
          {matter.authorities.slice(0, 4).map((a, i) => (
            <li key={i}>
              <span className="bb-matter-citations-num">[{i + 1}]</span>
              <span className="bb-matter-citations-name">{a.name}</span>
              <span className="bb-matter-citations-cite">{a.citation}</span>
              <p className="bb-matter-citations-prop">{a.proposition}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function buildSmithJonesAnswer() {
  return (
    <>
      <h3>English Cases on Anti-Avoidance Endorsements in ATE Policies</h3>
      <p>
        Five English authorities are directly relevant to the question of
        whether an anti-avoidance endorsement renders an ATE policy adequate
        as security for costs.
      </p>
      <p>
        <strong>Cases where the policy was accepted as adequate:</strong> In{' '}
        <em>Musst Holdings v Astra Asset Management</em> [2024] EWHC 2310 (Ch)
        and <em>Saxon Woods Investments v Costa</em> [2023] EWHC 850 (Ch), the
        terms of the policy — including the anti-avoidance endorsement — were
        analysed and accepted. The latter articulates the analytical framework
        commonly applied [2].
      </p>
      <p>
        <strong>Cases where the policy was found inadequate:</strong>{' '}
        <em>Asertis v Bloch</em> [2024] EWHC 2393 (Ch) confirms that direct
        enforceability is critical — a policy is unsatisfactory where the
        defendant has no ability to enforce it directly [3].{' '}
        <em>Premier Motor Auctions v PwC</em> [2018] 1 WLR 2955 stands for the
        baseline proposition that the absence of an anti-avoidance clause is
        fatal to adequacy [4].
      </p>
      <p>
        <strong>Application to this case:</strong> Given the plaintiff is in
        liquidation, direct enforceability is the threshold concern. Even if
        an anti-avoidance endorsement exists, the policy is inadequate unless
        we (as defendant) can enforce against the syndicates without depending
        on the insured.
      </p>
    </>
  );
}

function buildGenericAnswer(matter: MockMatter) {
  return (
    <>
      <h3>Research summary</h3>
      <p>
        Based on the authorities and files in <em>{matter.name}</em>, the most
        relevant principle is captured in{' '}
        <em>{matter.authorities[0]?.name ?? 'the leading authority'}</em>{' '}
        [{matter.authorities[0]?.citation ?? '...'}], which establishes that{' '}
        {matter.authorities[0]?.proposition.toLowerCase() ?? 'the relevant test applies.'}
      </p>
      <p>
        Cross-referencing this against the case files, several practical
        considerations follow. Detailed reasoning and a recommended position
        appear in the conversation thread.
      </p>
    </>
  );
}

// =============================================================================
// Files tab
// =============================================================================

function FilesTab({ matter }: { matter: MockMatter }) {
  return (
    <div className="bb-matter-files">
      <div className="bb-matter-section-head">
        <div>
          <h2>Files</h2>
          <p>Upload pleadings, evidence, advices, and correspondence.</p>
        </div>
        <button type="button" className="bb-btn bb-btn-primary">
          + Upload file
        </button>
      </div>

      {matter.files.length === 0 ? (
        <div className="bb-matter-empty">
          <h3>No files yet</h3>
          <p>Add the first document to this case to get started.</p>
        </div>
      ) : (
        <ul className="bb-matter-file-list">
          {matter.files.map((f) => (
            <li key={f.id} className="bb-matter-file">
              <div className="bb-matter-file-icon" aria-hidden>
                {fileGlyph(f.name)}
              </div>
              <div className="bb-matter-file-body">
                <div className="bb-matter-file-name">{f.name}</div>
                <div className="bb-matter-file-meta">
                  <span className="bb-matter-file-cat">{f.category}</span>
                  <span>{f.size}</span>
                  <span>Uploaded {f.uploadedAt}</span>
                </div>
              </div>
              <button type="button" className="bb-matter-file-action" aria-label="More actions">
                ⋯
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fileGlyph(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'PDF';
  if (ext === 'docx' || ext === 'doc') return 'DOC';
  if (ext === 'xlsx' || ext === 'xls') return 'XLS';
  if (ext === 'pptx' || ext === 'ppt') return 'PPT';
  return 'FILE';
}

// =============================================================================
// Conversations tab
// =============================================================================

function ConversationsTab({ matter }: { matter: MockMatter }) {
  return (
    <div className="bb-matter-conversations">
      <div className="bb-matter-section-head">
        <div>
          <h2>Conversations</h2>
          <p>Each thread keeps its own context. Pick up where you left off.</p>
        </div>
        <button type="button" className="bb-btn bb-btn-primary">
          + New conversation
        </button>
      </div>

      {matter.conversations.length === 0 ? (
        <div className="bb-matter-empty">
          <h3>No conversations yet</h3>
          <p>Start the first thread by asking a question in the Chat tab.</p>
        </div>
      ) : (
        <ul className="bb-matter-conv-list">
          {matter.conversations.map((c) => (
            <li key={c.id} className="bb-matter-conv">
              <div className="bb-matter-conv-head">
                <h3 className="bb-matter-conv-title">{c.title}</h3>
                <span className="bb-matter-conv-time">{c.updatedAt}</span>
              </div>
              <p className="bb-matter-conv-preview">{c.preview}</p>
              <div className="bb-matter-conv-foot">
                <span>{c.messageCount} messages</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =============================================================================
// Authorities tab
// =============================================================================

function AuthoritiesTab({ matter }: { matter: MockMatter }) {
  return (
    <div className="bb-matter-authorities">
      <div className="bb-matter-section-head">
        <div>
          <h2>Cited authorities</h2>
          <p>
            Cases and legislation surfaced across this matter&apos;s research,
            ranked by frequency.
          </p>
        </div>
      </div>

      {matter.authorities.length === 0 ? (
        <div className="bb-matter-empty">
          <h3>No authorities cited yet</h3>
          <p>
            As you research within this case, BriefBridge will track every
            authority you rely on.
          </p>
        </div>
      ) : (
        <ul className="bb-matter-auth-list">
          {matter.authorities.map((a, i) => (
            <li key={i} className="bb-matter-auth">
              <div className="bb-matter-auth-rank">{i + 1}</div>
              <div className="bb-matter-auth-body">
                <div className="bb-matter-auth-head">
                  <h3 className="bb-matter-auth-name">{a.name}</h3>
                  <span className="bb-matter-auth-cite">{a.citation}</span>
                </div>
                <p className="bb-matter-auth-prop">{a.proposition}</p>
              </div>
              <div className="bb-matter-auth-stat">
                <span>{a.citedTimes}×</span>
                <span>cited</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =============================================================================
// Notes tab
// =============================================================================

function NotesTab({ matter }: { matter: MockMatter }) {
  return (
    <div className="bb-matter-notes">
      <div className="bb-matter-section-head">
        <div>
          <h2>Notes</h2>
          <p>Free-form working notes for this matter.</p>
        </div>
        <button type="button" className="bb-btn bb-btn-ghost">
          Edit
        </button>
      </div>

      {matter.notes ? (
        <div className="bb-matter-note-body">
          <p>{matter.notes}</p>
        </div>
      ) : (
        <div className="bb-matter-empty">
          <h3>No notes yet</h3>
          <p>Add working notes, instructions, or strategy reminders here.</p>
        </div>
      )}
    </div>
  );
}
