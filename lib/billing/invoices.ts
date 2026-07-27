// lib/billing/invoices.ts
//
// Server-side invoice list for the billing page.
//
// NOT a server action: the billing page is a Server Component, so it can call
// this directly during render. Making it an action would mean the client
// fetching on mount — a second round trip after paint, which is the pattern
// the matters page was recently rewritten to remove.
//
// Stripe is the source of truth for invoices; we deliberately do not mirror
// them locally. They are read rarely (only when someone opens billing), they
// change shape over time, and a stale local copy of a financial record is
// worse than a slightly slower fetch.

import { stripe } from '@/lib/stripe';

export interface InvoiceRow {
  id: string;
  /** Stripe's human-readable number, e.g. B1C2D3E4-0001. */
  number: string | null;
  /** Unix seconds, so the component can format in the user's locale. */
  created: number;
  amountPaid: number;
  currency: string;
  status: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

/**
 * Recent invoices for a customer, newest first.
 *
 * Never throws: billing is still useful without the history, so a Stripe
 * outage degrades this section to empty rather than failing the whole page.
 */
export async function listInvoices(
  stripeCustomerId: string | null,
  limit = 12,
): Promise<InvoiceRow[]> {
  if (!stripeCustomerId) return [];

  try {
    const result = await stripe.invoices.list({
      customer: stripeCustomerId,
      limit,
    });

    return result.data.map((inv) => ({
      id: inv.id ?? '',
      number: inv.number ?? null,
      created: inv.created,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      status: inv.status ?? 'unknown',
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[billing] listInvoices failed:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}