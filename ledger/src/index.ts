/** The Durable Object class must be exported from the Worker entry so the ACCOUNTS binding resolves. */
export { LedgerAccount } from "./account-object";

/** Minimal Worker; the routes arrive with the routes task. */
export default {
  async fetch(): Promise<Response> {
    return new Response("not found", { status: 404 });
  },
};
