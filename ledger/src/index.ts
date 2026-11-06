import { DurableObject } from "cloudflare:workers";

/** Placeholder; the reserve, settle and today methods arrive with the account object task. */
export class LedgerAccount extends DurableObject {}

/** Minimal Worker; the routes arrive with the routes task. */
export default {
  async fetch(): Promise<Response> {
    return new Response("not found", { status: 404 });
  },
};
