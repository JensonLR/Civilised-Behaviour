/**
 * Which address a request comes from, for rate limits only (never stored, never logged). The FIRST entry of X-Forwarded-For is whatever the client wrote there: keying on
 * it let anyone dodge the join-code limiter with a fresh made-up address per request (security review, D-048; measured on the live server: thirteen forged lookups, none
 * limited). A proxy APPENDS the address it saw, so the trustworthy entry is the one added by the last proxy we trust: `trustHops` from the right. Or a header the trusted
 * edge sets and overwrites (`header`, e.g. a CDN's connecting-ip header). With neither, the transport's own peer address (development: one machine, one bucket).
 */
export interface ClientIpPolicy {
  /** A header the trusted edge always overwrites with the connecting address (lower case). Absent = not used. */
  header?: string;
  /** How many trusted proxies append to X-Forwarded-For in front of the server (0 = do not read it). */
  trustHops: number;
}

const ADDRESS = /^[0-9a-fA-F:.]{2,45}$/;

export function clientIp(headers: { get(name: string): string | null } | undefined, peer: string | undefined, p: ClientIpPolicy): string {
  if (p.header) {
    const v = headers?.get(p.header)?.trim();
    if (v && ADDRESS.test(v)) return v;
  }
  if (p.trustHops > 0) {
    const chain = (headers?.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const v = chain.length >= p.trustHops ? chain[chain.length - p.trustHops] : undefined;
    if (v && ADDRESS.test(v)) return v;
  }
  return peer && ADDRESS.test(peer) ? peer : "local";
}
