import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, accounts, sessions, verificationTokens } from "@/lib/db/schema";
import { authConfig, type AppRole } from "./config.edge";

export type { AppRole };

/**
 * Full Node-runtime Auth.js config. Extends the edge-safe base with:
 *  - Drizzle adapter (pulls in postgres driver — Node only)
 *  - Credentials provider (pulls in bcryptjs — Node only)
 *
 * Use this in route handlers, server components, and the [...nextauth]
 * route. DO NOT import this from `middleware.ts` (edge runtime). The
 * middleware imports from `./config.edge` instead.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Credentials({
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!row || !row.passwordHash) return null;

        const ok = await bcrypt.compare(password, row.passwordHash);
        if (!ok) return null;

        return {
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role as AppRole,
        };
      },
    }),
  ],
});
