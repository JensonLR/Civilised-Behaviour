# Game Design Document - Civilised Behaviour (working title)

Living document. If code and this disagree, fix one of them deliberately and note it in DECISIONS.md.

## 1. Pitch
1-4 player online co-op (solo playable) third-person expedition sandbox. You are the Imperial Cartographic & Improvement
Society's least suitable explorers: grotesque Victorian/Edwardian caricatures in a beautiful, dangerous, politically alive
world. Physics-driven chaos on top of a compact faction/settlement simulation that remembers everything you did.
Mature (18-oriented): heavy violence, profanity, dark satire. **All cultures are fictional.** The satire understands more
than its characters do; local societies have agency, factions, leaders and humour, and manipulate the players back.

## 2. Pillars (every feature must serve at least one)
1. **Physical co-op chaos** - ride, shoot, fight, grab, carry, drag, climb, build, sabotage, rescue. Strategy becomes physical.
2. **Actions change the world** - settlements grow, factions remember, rivals exploit, routes open; return sessions later and see history.
3. **Systemic stories** - interacting systems over bespoke scripts (missing surveyor -> debt -> weapon demand -> accidental explosion -> crisis -> rival intervenes).
4. **Beautifully ugly characters** - iconic grotesque silhouettes against a gorgeous, tactile, dramatically lit world.
5. **Dark satire with teeth** - institutions, propaganda, bureaucracy, greed and player behaviour are targets; never a real protected group.
6. **Violence has impact** - physical, zone-based damage; Gore Full/Reduced/Off, Dismemberment On/Off; never required for readability.
7. **Solo-dev leverage** - 100 situations from one system; modular kits over bespoke assets; every system multiplies another.

## 3. v1 scope
- 1-4 players online, solo OK, friends-first private sessions (join code / invite link), reconnect.
- Campaign ~8-15 h; replay via world seed, faction relations, event combinations, decisions. Persistent saves.
- World: 1 colonial HQ hub + 4 large expedition regions (coast/jungle/river; savannah/highland kingdom; arid canyon/mineral
  frontier; delta/wetland trading region) + campaign map. No seamless continent. Only the active region simulates.
- Factions: >=4 major local powers (leader, structure, needs, rivalries, military, economy, attitudes, evolving relations,
  several systemic hooks), several sub-factions, 1 foreign rival expedition (physically present), merchants/company, bandits/deserters.
- >=12 reusable scenario templates that resolve multiple ways (missing expedition, river-crossing negotiation, convoy, survey,
  diplomatic audience, hunt, outpost defence, rival race, sabotage, hostage, border incident, siege, labour dispute,
  smuggling, succession dispute). Not all involve combat.
- **Region two is Highmark (D-036), the savannah and highland kingdom**: five terraces climbed by a switchback Processional Road, a grassland of herds, a river quay, a stepped palace; its contract family is the Succession Dispute "The Vacant Chair" (an heir by Seniority, an heir by Acclamation, a Chamberlain, the Thornfield Reapers' Assembly voting at the harvest bell, a Syndicate cheque), resolving six ways (backed elder, backed younger, regency, usurped, crown sold, abandoned). Its second contract (D-042) is the labour dispute, the Reapers' Strike: the Compact out over a royal bushel a third too large, the Crown's Steward, a barge of the Syndicate's strike-breakers and the rain, resolving five ways (honest measure, bought back, strike broken, barley lost, abandoned). Regions three and four (D-037) are built and on the chart, so all four expedition regions exist: Vesper Gorge, the arid canyon and mineral frontier (home power the Low Vesper Lamentation Guild; the Lower Gallery, a mine rescue, and the Claim Race, a rival race), and the Saltmarket Delta, the wetland trading region (home power the Brine Houses; the Quiet Barge, a smuggling run, and the Auction at High Water, a flooded-market negotiation), each template with four endings besides abandoned. Vesper's third contract (D-044) is the sabotage, the Winding Engine: the Syndicate's leased engine on the headframe terrace driving a cross-cut at the vein, resolving five ways (fouled with grit unseen, blown with the Company's keg, bought through the engineer's inspection, the vein struck, abandoned). Kessar's fifth (D-045) is the outpost defence, the Raid on the Post: while the Syndicate's raid on the Society's post is due, the party is there when it lands, resolving four ways (held, burned, protection paid, abandoned). That makes twelve templates; the GDD's remaining kinds (missing expedition, survey, audience, hunt, siege) are unbuilt. Outposts, roads, the telegraph and the launch are still Kessar-only. Unplayed; every number is a first pass.
- Tech emerges from campaign state: horses/wagons/canoes/dirt roads/messengers/basic firearms/tents -> better roads,
  artillery, telegraph, steam launches -> railway, better guns, early machine weapons, industrial extraction. No tech-tree UI.

## 4. Core loop (30-60 min)
Spawn at HQ/outpost -> see opportunities in-world and on campaign map -> pick one or ignore -> quick prep (no 10-min
inventory) -> enter region -> travel produces interaction -> objective collides with faction/world systems -> complication ->
players improvise physically -> outcome mutates campaign state -> return/continue/found a foothold -> HQ and newspaper acknowledge it.

## 5. Systems
### Characters (major USP)
Rigid modular articulated hierarchy (pelvis, torso, head, upper/lower arms, hands, upper/lower legs, feet, facial attachments)
- not a skinned pipeline. Body controls: height, head scale, torso width/depth, belly, shoulders, arm/leg length, hand/foot
scale, nose style/scale, ears, jaw, posture. Cosmetics: hair, moustaches, beards, sideburns, hats, jackets, shirts, trousers,
boots, belts, medals, eyewear, sashes, equipment. Expressive eyes/brows/mouth, head look, reactions (pain, drunk, fear,
triumph). Collision envelope is fixed (`CHARACTER` in shared constants) regardless of customisation. Persistent history:
scars, missing/gold teeth, eyepatch, burnt clothes, medals, prosthetics, nickname/title. No stat-heavy levelling.
### Movement & interaction
Walk/run/sprint/crouch, jump/vault only where useful, slopes, steps, shallow water, knockback, stumble, contextual climb, ragdoll.
One context interaction system: pick up/drop/carry/drag body/revive/mount/enter vehicle/open/close/operate/talk/loot/inspect/place/use/ignite.
Physics props: carts, barrels, crates, bells, cannons, chairs, bottles, doors, simple ropes. No soft-body or voxel destruction.
### Combat
Feel first, scale second: 10-30 NPCs normal, controlled peaks higher. Weapons: revolver, rifle, shotgun, sabre, dynamite, cannon.
Recoil, smoke, meaningful reload, great audio, bloom by movement, camera response, surface impacts, server-authoritative ammo/damage,
immediate local cosmetics. Melee: directional/contextual, hit tracing, knockback. Artillery must feel enormous. Friendly fire default ON (host can disable).
Downed/wounded/revivable rather than instant death: drag, shoulder carry, wagon, revive, retreat.
### Damage & gore
Zones: head, torso, arms, legs. Source + force + zone drive presentation. Pooled effects with deterministic caps: blood spray,
wounds, pooling, clothing blood, dirt/mud accumulation, torn states, detachable limbs with wound caps, ragdoll to capped Rapier bodies.
### Expedition
Readable loadout (ammo, medical, provisions, gifts, explosives, tools). Transport: horse, wagon, canoe, steam launch (later).
Followers: modest party, command wheel (follow/hold/defend/attack/regroup/retreat/mount/operate artillery). Not an RTS.
### World architecture
Campaign map -> regions -> streamed chunks. Deterministic seeded generation for vegetation/rocks/props/minor encounters;
authored placement for capitals, forts, outposts, villages, bridges, mines, story sites. Baked/cacheable region data.
### Settlements
camp -> trading post -> fortified outpost -> settlement -> town. Broad priorities (trade/military/growth/extraction/transport)
evolve from supply, security, prosperity, faction relations, route access, resources, events. Modular kits + deterministic layouts.
### Factions
Compact state: trust, fear, grievance, localAuthority, playerInfluence, rivalInfluence, dependency, prosperity, militaryStrength,
currentNeed, relationship. Surfaced through behaviour, dialogue, events, rumours, newspapers, maps, scouts - not dashboards.
Same action, different faction reaction. High fear = short-term compliance, long-term fragility. Every leader has their own goals.
### Negotiation
Short, situational: NPC wants X, player wants Y, both have leverage (reputation, blood/dirt, armed followers, victories,
gifts, rival influence, needs, past lies). Other players remain physically present (move, gesture, show gear, cause incidents).
### Chaos director
Restrained, cooldown/weight/compatibility-driven collision of existing systems (patrol, messenger, weather, rival expedition,
animal disturbance, blockage, wounded traveller, envoy, supply complication, argument, fire, deserter). Amplifies stories; not a spawner.
### Missions
Reusable nodes (travel, find, meet, escort, defend, retrieve, deliver, investigate, negotiate, capture, sabotage, survive,
escape, choose side, establish outpost). Scenario templates bind faction+location+need+complication+objective+resolution.
Infer outcomes from world state; never fail because the solution was unexpected but valid.
### Rival power
Physically present expeditions that move, camp, negotiate, survey, escort, build and compete for concessions; can be met,
raced, spied on, sabotaged, cooperated with, attacked. Uses the same systems as everyone else.
### HQ
Shared social hub: customisation, armoury, map room, trophy/history room, stable, dock, tavern, range, prep, newspaper,
recruitment. Decorated by campaign history. Newspaper = satirical imperial propaganda from authored templates (no live LLM).
### Tone
Comedy from physics, mistakes, institutional absurdity, propaganda, competing incentives, ridiculous people, unexpected consequences.
"A disastrous retreat becomes a decisive strategic repositioning." Quiet moments so chaos has contrast. No constant quips.

## 6. Presentation
Stylised high-contrast miniature world: strong silhouettes, dramatic sun, atmospheric fog, rich sky, tactile clay-like
materials, wet/muddy surfaces, restrained grading. Procedural/code-generated art first; every external asset is registered
with licence. Restrained post-processing (tone map, subtle bloom, contact AO, fog, grade). Clean HTML/CSS UI in an
"imperial field document" idiom (stamps, brass, leather) that still reads as a 2026 game. Audio is half the impact:
layered/procedural spatial Web Audio with buses, attenuation, occlusion approximation, subtitles.

## 7. Accessibility
Full subtitles + size, separate audio buses, keyboard and controller remapping, sensitivities, invert Y, camera shake slider,
motion blur off, FOV slider, hold/toggle options, colour-independent indicators, gore Reduced/Off, dismemberment Off, UI scale + safe zone.

## 8. Commercial
Premium, no ads/energy/P2W/loot boxes. Steam first (Playtest -> bounded Demo -> Next Fest when strong), itch.io + free web demo
as marketing. Price to be set from market research at launch (initial range ~GBP 14.99-19.99). Storefront copy must accurately
state mature content and AI-content disclosures.

## 9. Vertical-slice acceptance
1-4 players connect reliably; movement feels great on pad and KBM; four customised characters coexist; accidental friendly fire;
damage/gore respond; carry/revive; horse; one attractive region; one local faction; a leader who negotiates; a rival expedition;
establish an outpost; the scenario "secure the river crossing" resolves >=3 materially different ways; campaign remembers;
rejoin restores; acceptable performance. If it is not fun, fix the slice before multiplying content.
