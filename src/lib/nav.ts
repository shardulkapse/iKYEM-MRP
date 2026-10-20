import type { Role } from "@/types/globals";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; roles: Role[] };

export const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z",
  today: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 15h3",
  orders: "M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2zM9 9h6M9 13h6",
  stock: "M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8",
  pay: "M9 4.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c1.8.8 3 2.6 3.5 5.2",
  money: "M6 4h12M6 9h12M10 4c3.5 0 5 2 5 5s-2.5 5-6 5l7 6",
  setup: "M12 9a3 3 0 110 6 3 3 0 010-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
} as const;

// Managers see stock, take orders and fill in the daily sheet. Pay, money and setup are owner only.
export const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "home", roles: ["owner", "manager"] },
  { href: "/today", label: "Today", icon: "today", roles: ["owner", "manager"] },
  { href: "/orders", label: "Orders", icon: "orders", roles: ["owner", "manager"] },
  { href: "/stock", label: "Stock", icon: "stock", roles: ["owner", "manager"] },
  { href: "/pay", label: "Pay", icon: "pay", roles: ["owner"] },
  { href: "/money", label: "Money", icon: "money", roles: ["owner"] },
  { href: "/setup", label: "Setup", icon: "setup", roles: ["owner"] },
];

export const OWNER_ONLY_PREFIXES = NAV.filter((n) => !n.roles.includes("manager")).map((n) => n.href);
