# Steam release plan

Status: DRAFT checklist. Facts about Steamworks fees, waiting periods and review timings are from memory and **must be verified
against current Steamworks documentation before acting** (they change). No App ID exists; all Steam code sits behind adapters.

## Human-only prerequisites
Steamworks partner account + tax/bank onboarding; Steam Direct app fee; App ID; code-signing certificate; final name clearance.

## Checklist (to be completed in M13/M14)
Coming Soon page and store assets (capsules, screenshots from the in-game capture tools, trailer of real gameplay only); build/depot
config + branches; Demo app; Playtest app; mature-content survey (accurate gore/violence/language disclosure); AI-content disclosure
from `AI_CONTENT_REGISTER.md`; system requirements; controller support declaration; cloud-save decision; achievements (if stable);
pricing from live market research (~GBP 14.99-19.99 initial range); release review; Next Fest only with a strong demo; Early Access only if
the paid build is already worth the price.

## Integration
Wrapper undecided (D-010). Electron main process owns Steam; the renderer sees only a narrow contextBridge API. Steam ticket validated
server-side (PlatformAuth); no publisher key in any client code.

## Identity adapter note (D-035)
Campaign resume is keyed by an HMAC identity KEY (`apps/server/src/persistence/identity.ts`): today the anonymous per-device UUID the browser client generates (`cb.identity`), never stored raw. `steam:<17 digits>` is accepted only through an injected `IdentityVerifier` (the Steam ticket check lands there, in the Electron/Steam adapter, server-side validation of the session ticket): until then a `steam:` token is simply not an identity and a campaign it creates is not persisted. When the verifier lands: (1) the Steam id is personal data (see `PRIVACY_DATA_MAP.md`), (2) the same human on the web and on Steam are two different keys (members), so a "link account" step is a future decision, (3) `IDENTITY_PEPPER` must be set in production and must never change.

## Platform adapter and the desktop shell (D-036)
The seam is built and proved with no App ID: `packages/shared/src/platform.ts` defines `PlatformAdapter` (`init`, `unlock`, `setPresence`, `onInvite`, `shutdown`) and the closed list of IPC channels; the web build uses `createNoopPlatform()`. In the desktop shell the MAIN process owns the adapter (`apps/desktop/src/steam`): `CB_STEAM=stub` selects `StubSteam` (records calls in a bounded ring, logs, keeps unlocked achievements, builds the rich-presence line and the `+join CODE` connect string, and `simulateInvite(code)` reaches `onInvite` only with a valid join code); `CB_STEAM=real` is **not implemented** (it needs an App ID, and `steamworks.js` is not a dependency) and falls back to the no-op with a warning. The renderer reaches it only through the preload's `window.cbDesktop` (exactly `info`, `platform`, `openWishlist`, `quit`); the main process validates every argument and refuses any sender that is not the `app://game` page. The renderer never sees a Steam id, ticket or key.
- **Achievements:** 12 ids (`ACHIEVEMENTS`), earned by one pure table over the saved campaign state (`achievements.ts`: `evaluateAchievements(campaign, powers, settlements, already)`); titles and blurbs are authored in `platformText.ts`. The storefront's own table is configured by hand later from those ids. `chair_settled` is Highmark's.
- **Rich presence:** `presenceText(state)` (deterministic, no join code in the text); the join code travels only as the connect string.
- **Invites:** a friend's Join Game (or a `+join CODE` launch argument, or a second launch while running) becomes a join code and NOTHING else; the client calls the existing `Session.join(code)`.
- **Demo / Playtest apps:** the web demo's server policy (`Demo.ts`) is the model for a Steam demo build, but a Steam Demo app and a Playtest app are separate store objects and are NOT built.

Human-only list (unchanged in kind): Steamworks partner account and tax/bank onboarding; Steam Direct fee; the App ID (and its Steamworks SDK/`steamworks.js` integration, which needs the Steam client to test); Windows code-signing certificate and macOS Developer ID + notarisation (`electron-builder.json` is deliberately `identity: null`, unsigned); final name clearance; the store page, capsule art and pricing; the decision to turn update checks on and where the feed lives; a real app icon; an operator-run `IdentityVerifier` for `steam:` identities (see D-035 above).
