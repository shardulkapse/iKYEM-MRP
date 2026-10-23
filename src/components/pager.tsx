import Link from "next/link";
import { type Paging, withPage } from "@/lib/paging";

// "Showing 26–50 of 163 · ‹ 1 2 [3] 4 … 7 ›" under a long list. Shows nothing when everything
// fits on one page. href is the list's address without a page number.
export function Pager({ p, href, noun = ["row", "rows"] }: { p: Paging; href: string; noun?: [string, string] }) {
  if (p.total <= p.size) return null;
  const first = p.offset + 1;
  const last = Math.min(p.offset + p.size, p.total);
  return (
    <nav className="pager" aria-label="Pages">
      <span className="muted">Showing {first}–{last} of {p.total} {p.total === 1 ? noun[0] : noun[1]}</span>
      <span className="pages">
        {p.page > 1 ? <Link className="btn sm" href={withPage(href, p.page - 1)} aria-label="Previous page">‹</Link> : <span className="btn sm" aria-disabled="true">‹</span>}
        {numbers(p.page, p.pageCount).map((n, i) =>
          n === null ? <span key={`gap${i}`} className="gap" aria-hidden="true">…</span>
            : n === p.page ? <span key={n} className="btn sm current" aria-current="page">{n}</span>
            : <Link key={n} className="btn sm" href={withPage(href, n)} aria-label={`Page ${n}`}>{n}</Link>,
        )}
        {p.page < p.pageCount ? <Link className="btn sm" href={withPage(href, p.page + 1)} aria-label="Next page">›</Link> : <span className="btn sm" aria-disabled="true">›</span>}
      </span>
    </nav>
  );
}

// 1 … 4 5 [6] 7 8 … 20: the first and last page, and two either side of the current one.
function numbers(page: number, count: number): (number | null)[] {
  const keep = new Set([1, count, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= count));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push(n - sorted[i - 1] === 2 ? n - 1 : null);
    out.push(n);
  });
  return out;
}
