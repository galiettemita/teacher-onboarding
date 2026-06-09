import { NextResponse } from "next/server";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

/**
 * Turn a domain error into a JSON HTTP response. Anything not recognised
 * becomes a 500 with a generic message — we never leak stack traces to the
 * client.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ConflictError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  // Log server-side for ops visibility, but return a generic 500.
  console.error("Unhandled API error:", err);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}
