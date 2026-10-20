import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// HTTP driver: one round trip per query, nothing to keep open between requests on Vercel.
// Multi-statement writes that must succeed together (saving a day sheet) use db.batch([...]).
const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle({ client: sql, schema });
