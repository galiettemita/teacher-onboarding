import NextAuth from "next-auth";
import { authConfig } from "./config.edge";

/**
 * Edge-runtime Auth.js entry. Exports `auth` for use in middleware.ts only.
 * No adapter, no Credentials provider — safe for the Edge runtime.
 */
export const { auth } = NextAuth(authConfig);
