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
