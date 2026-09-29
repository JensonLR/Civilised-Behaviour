# Privacy data map

Status: reflects the code as of 2026-09-29. Draft for a future privacy policy; final legal review is advisable before release.

| Data | Where | Purpose | Retention |
|------|-------|---------|-----------|
| Display name (<=20 chars, sanitised) | Room state (memory); browser localStorage `cb.name` | Show players to each other | Room lifetime / until user clears storage |
| Random identity token (UUID) | Browser localStorage `cb.identity`; sent on join (unused server-side yet) | Future stable player identity | Until user clears storage |
| IP address | Transient in-memory rate-limiter key for `/campaign/:code`; HTTP/proxy logs of the hosting provider | Abuse prevention | Limiter: minutes; host logs per provider policy |
| Gameplay state (positions, etc.) | Server memory only | Play the game | Room lifetime (no persistence until M10) |
| Server logs | stdout JSON (room ids, session ids, names) | Operations | Per hosting provider |

Not collected: DOB, address, email, voice, payment data (storefronts handle payment). Persistence (M10) will add: platform ID,
display name, campaign data; deletion process to be documented then.
