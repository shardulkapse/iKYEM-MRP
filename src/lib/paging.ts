// Page numbers for long lists. A list shows `size` rows at a time; the page lives in the address
// as ?page=N so it survives a refresh and can be shared, and changing a filter or period drops it
// (the links that change those don't carry it), so you start again at page 1.

export const PAGE_SIZE = 25;

export type Paging = { page: number; pageCount: number; offset: number; size: number; total: number };

// The page asked for, kept between 1 and the last page that exists (an old link past the end, or
// a page that emptied after deletes, shows the last page rather than nothing).
export function paging(param: unknown, total: number, size = PAGE_SIZE): Paging {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const asked = typeof param === "string" && /^\d{1,6}$/.test(param) ? Number(param) : 1;
  const page = Math.min(Math.max(1, asked), pageCount);
  return { page, pageCount, offset: (page - 1) * size, size, total };
}

// One page of a list that is already in memory.
export const pageOf = <T,>(rows: T[], p: Paging): T[] => rows.slice(p.offset, p.offset + p.size);

// Adds ?page=N (or &page=N) to a link, leaving page 1 as the plain address.
export function withPage(href: string, page: number): string {
  if (page <= 1) return href;
  return `${href}${href.includes("?") ? "&" : "?"}page=${page}`;
}
