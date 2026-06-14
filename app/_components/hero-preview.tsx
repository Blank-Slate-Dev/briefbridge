// app/_components/hero-preview.tsx
//
// Animated product preview for the homepage hero. Replaces the static
// .bb-preview-inner content in page.tsx with a looping demo that cycles
// through five real BriefBridge research queries:
//
//   type the question → brief "researching" pulse → reveal a one-line
//   answer + 2-3 source cards → hold → backspace → next query → repeat.
//
// All five queries, answers, and citations are REAL output captured from
// the running system — every case name, citation, and paragraph resolves
// to an actual judgment in the corpus. The answer lines are tightened
// one-sentence summaries of the model's longer answers.
//
// Design:
//   - Reuses the existing .bb-preview-* classes from homepage.css so it
//     looks identical to the old static preview, just animated.
//   - A small state machine drives the phases (see PHASE below).
//   - Loops forever; pauses while the pointer is over the preview so a
//     reader isn't yanked mid-card.
//   - Respects prefers-reduced-motion: shows the first query fully
//     revealed, static, no animation.
//
// This is a Client Component (uses timers + state). It renders ONLY the
// inner content; the outer .bb-preview-wrap / .bb-preview / .bb-preview
// chrome stays in page.tsx.

'use client';

import { useEffect, useRef, useState } from 'react';

interface Source {
  title: string;
  cite: string;
  kind: 'case' | 'statute';
  meta?: string;
}

interface Demo {
  question: string;
  answer: string;
  sources: Source[];
}

// All real, captured output. Citations are verbatim from the system.
const DEMOS: Demo[] = [
  {
    question: 'When can a default judgment be set aside?',
    answer:
      'The discretion turns on the interests of justice — chiefly an arguable defence, an explanation for the default, and the absence of undue delay.',
    sources: [
      {
        title: 'Uniform Civil Procedure Rules 2005 (NSW)',
        cite: 'r 36.16(2)(a)',
        kind: 'statute',
        meta: 'Statute · power to set aside',
      },
      {
        title: 'Dunwoodie v Teachers Mutual Bank Ltd',
        cite: '[2014] NSWCA 24',
        kind: 'case',
        meta: 'Court of Appeal · McColl JA · at [43]',
      },
      {
        title: 'Dai v Zhu',
        cite: '[2013] NSWCA 412',
        kind: 'case',
        meta: 'Court of Appeal · interests-of-justice test',
      },
    ],
  },
  {
    question: 'How is equitable compensation for breach of fiduciary duty assessed?',
    answer:
      'The plaintiff must establish a "but for" causal link; loss is then assessed as at the date of judgment, with the benefit of hindsight.',
    sources: [
      {
        title: 'In the matter of Empireal Ltd (in liq)',
        cite: '[2026] NSWSC 252',
        kind: 'case',
        meta: 'Supreme Court of NSW · at [631]',
      },
      {
        title: 'Denis Cassegrain v Gerard Cassegrain & Co',
        cite: '[2015] NSWSC 851',
        kind: 'case',
        meta: 'Supreme Court of NSW · at [64]',
      },
    ],
  },
  {
    question: 'When will a sentence be found manifestly excessive?',
    answer:
      'The sentence must be "plainly unjust" or "unreasonable" — error of the House v The King kind, even where the specific error cannot be identified.',
    sources: [
      {
        title: 'Hancock v R',
        cite: '[2025] NSWCCA 213',
        kind: 'case',
        meta: 'Court of Criminal Appeal · five-judge bench · at [99]',
      },
      {
        title: 'Brighton v Will',
        cite: '[2020] NSWSC 435',
        kind: 'case',
        meta: 'Supreme Court of NSW · at [199]',
      },
    ],
  },
  {
    question: 'What is the modern test for apprehended bias?',
    answer:
      'Whether a fair-minded lay observer, properly informed, might reasonably apprehend that the decision-maker might not bring an impartial mind to the question.',
    sources: [
      {
        title: 'MTH v State of New South Wales (No 2)',
        cite: '[2025] NSWCA 123',
        kind: 'case',
        meta: 'Court of Appeal · at [33]',
      },
      {
        title: 'Reid v Commercial Club (Albury) Ltd',
        cite: '[2014] NSWCA 98',
        kind: 'case',
        meta: 'Court of Appeal · Gleeson JA · at [75]',
      },
    ],
  },
  {
    question: 'What must an applicant show for an extension of time to appeal?',
    answer:
      'A satisfactory explanation for the delay and an arguable basis for the appeal — absent both, there is no purpose in granting an extension.',
    sources: [
      {
        title: 'Johnston v Boyd',
        cite: '[2024] NSWCA 75',
        kind: 'case',
        meta: 'Court of Appeal · at [3]',
      },
      {
        title: 'Supreme Court Act 1970 (NSW)',
        cite: 's 103',
        kind: 'statute',
        meta: 'Statute · appeal by leave',
      },
    ],
  },
];

// Phases of one cycle.
type Phase = 'typing' | 'researching' | 'revealing' | 'holding' | 'deleting';

// Timing constants (ms). Tuned so a full cycle reads comfortably.
const TYPE_SPEED = 15; // per character while typing
const DELETE_SPEED = 18; // per character while backspacing
const RESEARCH_MS = 1100; // "researching" pulse duration
const HOLD_MS = 3200; // how long the answer stays up before deleting
const GAP_MS = 320; // small pause between queries

export function HeroPreview() {
  const [demoIndex, setDemoIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<Phase>('typing');
  const [reducedMotion, setReducedMotion] = useState(false);

  // Pause-on-hover. We hold the "paused" flag in a ref so the timer loop
  // reads the latest value without re-subscribing.
  const pausedRef = useRef(false);

  // Detect reduced-motion preference once on mount.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const demo = DEMOS[demoIndex];

  // The animation driver. A single effect re-runs whenever the phase or
  // demo changes, scheduling the next transition. Each branch sets a timer
  // (or interval) and clears it on cleanup, so changing phase/index cancels
  // any pending work cleanly.
  useEffect(() => {
    // Reduced motion: skip all animation. Show the question fully typed and
    // the answer revealed, statically. No timers, no cycling.
    if (reducedMotion) {
      setTyped(demo.question);
      setPhase('revealing');
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    let interval: ReturnType<typeof setInterval>;

    // Helper: wait, but if paused, keep re-checking until unpaused.
    const waitThen = (ms: number, next: () => void) => {
      const start = Date.now();
      const tick = () => {
        if (pausedRef.current) {
          timer = setTimeout(tick, 120);
          return;
        }
        const elapsed = Date.now() - start;
        if (elapsed >= ms) next();
        else timer = setTimeout(tick, ms - elapsed);
      };
      timer = setTimeout(tick, ms);
    };

    if (phase === 'typing') {
      let i = typed.length;
      interval = setInterval(() => {
        if (pausedRef.current) return;
        i += 1;
        setTyped(demo.question.slice(0, i));
        if (i >= demo.question.length) {
          clearInterval(interval);
          waitThen(GAP_MS, () => setPhase('researching'));
        }
      }, TYPE_SPEED);
    } else if (phase === 'researching') {
      waitThen(RESEARCH_MS, () => setPhase('revealing'));
    } else if (phase === 'revealing') {
      // Cards fade in via CSS; we just hold, then move on.
      waitThen(HOLD_MS, () => setPhase('deleting'));
    } else if (phase === 'deleting') {
      let i = demo.question.length;
      interval = setInterval(() => {
        if (pausedRef.current) return;
        i -= 1;
        setTyped(demo.question.slice(0, Math.max(0, i)));
        if (i <= 0) {
          clearInterval(interval);
          waitThen(GAP_MS, () => {
            setDemoIndex((idx) => (idx + 1) % DEMOS.length);
            setPhase('typing');
          });
        }
      }, DELETE_SPEED);
    }

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, demoIndex, reducedMotion]);

  const showResults = phase === 'researching' || phase === 'revealing';
  const showResearching = phase === 'researching';
  const showAnswer = phase === 'revealing';

  return (
    <div
      className="bb-preview-inner"
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
    >
      <div className="bb-preview-search">
        <svg
          className="bb-preview-search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="16" y1="16" x2="21" y2="21" />
        </svg>
        <span className="bb-preview-search-text">
          {typed}
          {!reducedMotion && <span className="bb-preview-cursor" />}
        </span>
      </div>

      {showResults && (
        <div className="bb-preview-results">
          {showResearching ? (
            <div className="bb-preview-researching">
              <span className="bb-preview-researching-dots" aria-hidden>
                <span />
                <span />
                <span />
              </span>
              Researching across cases…
            </div>
          ) : (
            <>
              {showAnswer && (
                <p className="bb-preview-answer">{demo.answer}</p>
              )}
              {demo.sources.map((s, i) => (
                <div
                  key={`${demoIndex}-${i}`}
                  className="bb-preview-card bb-preview-card-enter"
                  style={{ animationDelay: `${i * 90}ms` }}
                >
                  <div className="bb-preview-card-head">
                    <div className="bb-preview-card-title">{s.title}</div>
                    <div className="bb-preview-card-cite">{s.cite}</div>
                  </div>
                  <div className="bb-preview-card-meta">
                    {s.kind === 'statute' && (
                      <span className="bb-preview-card-kind">Statute</span>
                    )}
                    {s.meta}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}