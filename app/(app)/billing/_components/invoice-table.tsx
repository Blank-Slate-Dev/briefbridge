// app/(app)/billing/_components/invoice-table.tsx
//
// Invoice history.
//
// A TABLE, not a grid of cards. Invoices are homogeneous records that get
// scanned down a column — date against date, amount against amount — which is
// what a table is for and what Stripe's own dashboard uses. Cards would force
// the eye to re-find each field on every row.
//
// Amounts use tabular figures so decimal points line up; a right-aligned
// money column with proportional digits looks subtly broken.
//
// Server Component: rows are already fetched during page render, so there is
// nothing to do on the client.

import type { InvoiceRow } from '@/lib/billing/invoices';
import { formatAuDate, formatAuMoney } from '@/lib/billing/copy';

function statusClass(status: string): string {
  if (status === 'paid') return 'bb-invoice-status-paid';
  if (status === 'open') return 'bb-invoice-status-open';
  return 'bb-invoice-status-other';
}

export function InvoiceTable({ invoices }: { invoices: InvoiceRow[] }) {
  if (invoices.length === 0) {
    return (
      <p className="bb-account-empty">
        No invoices yet. Your first one appears after the trial converts.
      </p>
    );
  }

  return (
    <table className="bb-invoice-table">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Invoice</th>
          <th scope="col">Status</th>
          <th scope="col" className="bb-invoice-amount">Amount</th>
          <th scope="col" className="bb-invoice-action">Receipt</th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((inv) => (
          <tr key={inv.id}>
            <td>{formatAuDate(new Date(inv.created * 1000))}</td>
            <td className="bb-invoice-num">{inv.number ?? '—'}</td>
            <td>
              <span className={`bb-invoice-status ${statusClass(inv.status)}`}>
                {inv.status}
              </span>
            </td>
            <td className="bb-invoice-amount">
              {formatAuMoney(inv.amountPaid, inv.currency)}
            </td>
            <td className="bb-invoice-action">
              {inv.pdfUrl ? (
                <a className="bb-invoice-link" href={inv.pdfUrl} target="_blank" rel="noopener noreferrer">PDF</a>
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}