import type { NextAuthConfig, DefaultSession } from "next-auth";

export type AppRole = "teacher" | "admin";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
    } & DefaultSession["user"];
  }
  interface User {
    role?: AppRole;
  }
}



/**
 * Edge-safe base config. NO providers that pull in Node-only deps (bcrypt),
 * NO database adapter. This is the config that runs inside middleware on
 * the Edge runtime. The full Node config (lib/auth/config.ts) extends this
 * and adds the Drizzle adapter + Credentials provider for route handlers
 * and server components.
 *
 * Why split: Auth.js v5 documents this pattern because adapters and
 * providers like Credentials with bcrypt cannot run on the Edge runtime
 * (Edge forbids `eval` / dynamic code generation).
 */
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  providers: [],
  callbacks: {
    // Used by middleware via `auth(req)` to determine signed-in state.
    authorized({ auth }) {
      // Always return true here; per-route gating is done explicitly in middleware.ts
      // because we need pathname-based + role-based decisions.
      return !!auth?.user;
    },
    async jwt({ token, user }) {
      const t = token as typeof token & { userId?: string; role?: AppRole };
      if (user) {
        t.userId = user.id as string;
        t.role = (user as { role?: AppRole }).role;
      }
      return t;
    },
    async session({ session, token }) {
      const t = token as typeof token & { userId?: string; role?: AppRole };
      if (t.userId) session.user.id = t.userId;
      if (t.role) session.user.role = t.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
