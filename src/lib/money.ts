// Money is stored in paise (₹1 = 100). Convert only at the edges: form input and display.

export function toPaise(rupees: string): number {
  return Math.round(Number(rupees) * 100);
}

// For pre-filling a form field: 55000 -> "550", 950 -> "9.5"
export function paiseToInput(paise: number | null | undefined): string {
  return paise == null ? "" : String(paise / 100);
}

// For display: 55000 -> "₹550", 950 -> "₹9.50", 2600000 -> "₹26,000"
export function formatRupees(paise: number | null | undefined): string {
  const r = (paise ?? 0) / 100;
  const whole = Number.isInteger(r);
  return "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

// Accepts "550", "550.5", "550.50". Used by form validation.
export const RUPEES_PATTERN = /^\d+(\.\d{1,2})?$/;
