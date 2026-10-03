import { describe, expect, it } from "vitest";
import { clientIp } from "./clientIp.ts";

const h = (o: Record<string, string>): Headers => new Headers(o);

describe("clientIp (rate-limit keys; security review D-048)", () => {
  it("behind one trusted proxy, the address it appended (right-most) is the client: anything the client wrote in front is ignored", () => {
    const p = { trustHops: 1 };
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.7" }), undefined, p)).toBe("198.51.100.7");
    for (const forged of ["203.0.113.1", "203.0.113.2, 10.0.0.1", "1.2.3.4,5.6.7.8"]) {
      expect(clientIp(h({ "x-forwarded-for": `${forged}, 198.51.100.7` }), undefined, p), forged).toBe("198.51.100.7");
    }
    // two trusted hops: the second from the right
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9, 198.51.100.7, 172.16.0.3" }), undefined, { trustHops: 2 })).toBe("198.51.100.7");
  });

  it("a trusted edge header wins when it holds an address; garbage is never a key; no proxy trusted means the peer, or one shared bucket", () => {
    expect(clientIp(h({ "cf-connecting-ip": "2001:db8::1", "x-forwarded-for": "9.9.9.9" }), undefined, { header: "cf-connecting-ip", trustHops: 1 })).toBe("2001:db8::1");
    expect(clientIp(h({ "cf-connecting-ip": "<script>", "x-forwarded-for": "9.9.9.9" }), undefined, { header: "cf-connecting-ip", trustHops: 1 })).toBe("9.9.9.9");
    expect(clientIp(h({ "x-forwarded-for": "not an address" }), "127.0.0.1", { trustHops: 1 })).toBe("127.0.0.1");
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.1" }), "10.1.2.3", { trustHops: 0 })).toBe("10.1.2.3");
    expect(clientIp(undefined, undefined, { trustHops: 0 })).toBe("local");
    expect(clientIp(h({}), undefined, { trustHops: 3 })).toBe("local");
  });
});
