# Incidents: chaos during play (D-052)

Status: spec, 2026-10-03. Gap analysis (D-051 session): the chaos director deals ONE complication as a contract starts and nothing happens during play; the GDD's
messenger, wounded traveller, deserter, envoy, argument, animal and fire are missing. One system here multiplies all twelve contracts.

## Rules
- At most ONE incident per contract run, dealt deterministically from the campaign seed, day and template (`hash3`), with a cooldown: never the same incident twice
  running (`sites.lastIncident`). About half of runs get one (a quiet run stays quiet).
- It happens DURING play: armed when the contract starts, it fires after a seeded delay (60..150 s of play) once the party has gone 20 s without hostilities, is not
  sailing, and stands in the region. A run that resolves first never sees it.
- It is placed near the party, out of the way of the fight: the first open nav cell at 22..32 m from the party's centre on one of eight bearings, preferring bearings away
  from every hostile group, and inside the region's bounds. No open spot: it does not fire (never in a wall).
- It is announced (a notice), its people carry name plates like anyone else, and it ends either by what the party does or by the contract ending (the people leave).
- Its result rides on the contract's outcome (`ScenarioOutcome.incident`), so it is committed with the contract, exactly once, and a dismissed run commits nothing.
- The campaign remembers the last one (`sites.lastIncident {id, result, day}`) and the next paper prints a line about it.
- Pure where it can be: the dealing, the placement choice, the machine and the copy live in `packages/shared/src/incidents.ts`; the server system
  (`apps/server/src/systems/Incidents.ts`) only spawns, observes and routes presses, like the scenario runner.

## The first three
| id | who | what the party can do | results | effect |
|----|-----|------------------------|---------|--------|
| `wounded_traveller` | a local (the region's own people), DOWNED on the spot | revive them (the ordinary hold-USE revive) | `helped` / `passed_by` | helped: +4 trust with the region's home power (Kessar: the Ward) and the paper's thanks; passed by: the paper notices |
| `courier` | a Society runner who walks to the nearest player | USE: take the dispatch | `delivered` / `missed` | delivered: £15 arrears into the purse |
| `deserter` | a garrison deserter, unarmed, hands up | USE: take him on | `enlisted` / `turned_away` | enlisted: a rifleman joins the roster for free if there is room (`FOLLOWER_CAP`), else he goes his way with thanks (`turned_away`) |

A shot at an incident's people ends it badly (`passed_by` / `missed` / `turned_away`) and their side remembers nothing special: the contract's own rules already count
the shot if it hit somebody's man.

## Acceptance
1. Pure: dealing is deterministic, honours the cooldown and the region/template filters, and yields "none" about half the time over many seeds; placement picks an
   open spot away from hostiles and refuses when there is none; each machine reaches each of its results; copy has no real-world terms.
2. Server: a room test drives a contract, waits for the incident, revives / uses, and the committed outcome carries the result; the campaign's purse, power trust,
   roster and `sites.lastIncident` change as the table says; a run dismissed before it fired commits nothing new.
3. Bots: the playtest routes still end as before with incidents dealt.
4. Looked at in a real browser: the incident's people, the notice, the plate.
