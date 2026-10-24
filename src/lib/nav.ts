import type { Role } from "@/types/globals";

// short: a shorter label for the phone tab bar, where eight tabs leave little room.
export type NavItem = { href: string; label: string; short?: string; icon: keyof typeof ICONS; roles: Role[] };

export const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z",
  today: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 15h3",
  orders: "M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2zM9 9h6M9 13h6",
  // a shop front: awning, walls, door
  customers: "M4.5 11v9.5h15V11M3 9.5L5 4h14l2 5.5M3 9.5a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0M10 20.5V15h4v5.5",
  stock: "M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8",
  team: "M9 4.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c1.8.8 3 2.6 3.5 5.2",
  pay: "M3 6.5h18v11H3zM12 9.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM6.5 9.5v5M17.5 9.5v5",
  money: "M6 4h12M6 9h12M10 4c3.5 0 5 2 5 5s-2.5 5-6 5l7 6",
  // a gear: eight teeth around a hub
  setup: "M10.22 4.82L10.42 2.53L13.58 2.53L13.78 4.82A7.4 7.4 0 0 1 15.82 5.66L17.58 4.19L19.81 6.42L18.34 8.18A7.4 7.4 0 0 1 19.18 10.22L21.47 10.42L21.47 13.58L19.18 13.78A7.4 7.4 0 0 1 18.34 15.82L19.81 17.58L17.58 19.81L15.82 18.34A7.4 7.4 0 0 1 13.78 19.18L13.58 21.47L10.42 21.47L10.22 19.18A7.4 7.4 0 0 1 8.18 18.34L6.42 19.81L4.19 17.58L5.66 15.82A7.4 7.4 0 0 1 4.82 13.78L2.53 13.58L2.53 10.42L4.82 10.22A7.4 7.4 0 0 1 5.66 8.18L4.19 6.42L6.42 4.19L8.18 5.66A7.4 7.4 0 0 1 10.22 4.82ZM12 9.0a3.0 3.0 0 110 6 3.0 3.0 0 010-6z",
} as const;

// Managers see stock, take orders and fill in the daily sheet. Team (it shows pay rates), pay, money
// and setup are owner only.
export const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "home", roles: ["owner", "manager"] },
  { href: "/today", label: "Today", icon: "today", roles: ["owner", "manager"] },
  { href: "/orders", label: "Orders", icon: "orders", roles: ["owner", "manager"] },
  { href: "/customers", label: "Customers", short: "Clients", icon: "customers", roles: ["owner", "manager"] },
  { href: "/stock", label: "Stock", icon: "stock", roles: ["owner", "manager"] },
  { href: "/team", label: "Team", icon: "team", roles: ["owner"] },
  { href: "/pay", label: "Pay", icon: "pay", roles: ["owner"] },
  { href: "/money", label: "Money", icon: "money", roles: ["owner"] },
  { href: "/setup", label: "Setup", icon: "setup", roles: ["owner"] },
];

export const OWNER_ONLY_PREFIXES = NAV.filter((n) => !n.roles.includes("manager")).map((n) => n.href);
