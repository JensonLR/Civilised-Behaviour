# Notes for DECISIONS / BUILD_STATE: audio, settings, pause, captions, how-to (M11 presentation slice, 2026-09-30)

Proposed entry **D-0xx Audio is arithmetic, rendered once and played back.** All sound is synthesised in code (no audio files, nothing to license). Sound
effects are recipes (`apps/client/src/audio/sounds.ts`) that are rendered offline into `AudioBuffer`s at start-up (`bake.ts`, 125 buffers, ~1 s of render time,
~17 MB), normalised to a target peak per sound, and then *played* through a pooled, spatialised voice; music and ambience are live graphs built from the same
kit (`dsp.ts`). Rejected: recorded samples (licensing, files, no variation), live synthesis of every gunshot (15+ nodes per shot on the audio thread, and levels you
cannot measure), a library (Tone.js/Howler: a dependency for what is 1,500 lines here and could not share the offline path).

**I cannot hear anything in this sandbox.** Every level below is a measurement from an `OfflineAudioContext` in headless Chromium, not a judgement by ear. The
recipes follow how the real sounds are built (a gunshot is a broadband crack, a pitch-swept thump, a lowpass-swept blast and a long dull tail) but the *taste*
(is the cannon big enough, is the parlour tune charming) still needs a human with headphones. See "Weak spots".

## Files
```
apps/client/src/audio/
  index.ts          public API: playSfx, stopSfx, setListener, setMasterVolume/setChannelVolume, startAmbience/stopAmbience, startMusic/stopMusic,
                    resumeOnGesture, footstep, onCaption/previewCaption, attachUiSounds, audioState (+ __engine for tests)
  engine.ts         the graph (buses, reverb, limiter, soft clipper), the pooled voices, loops, ducking, captions, gesture handling
  dsp.ts            the kit: noise buffers (white/pink/brown, seeded), envelopes, layers (noise, tone, ring, voice) -> renderLayers()
  sounds.ts         every sound effect as a recipe + its mix data (peak dB, distances, reverb, priority, cap, gap, ducking)
  bake.ts           OfflineAudioContext renderer, normaliser (DC, click-free edges, target peak), SoundBank (variants, round-robin)
  spatial.ts        listener-relative pan / distance / air absorption / "behind" dullness / arrival delay (pure)
  voicePool.ts      polyphony accounting: per-sound caps, priorities, stealing (pure, allocation-free)
  captions.ts       which sounds get a caption, the bearing word, per-sound cool-down (pure)
  ambience.ts       beds (wind, rain, crickets, fire, stream, waterfall) + event scheduler (birds, fire pops, thunder); ambienceMix.ts = the pure targets
  atmosphereSource.ts  reads getAtmosphere() from render/world/atmosphere.ts
  music.ts          plays the score; musicScore.ts = the pure generator (scale, chord progressions, seeded melody)
  stride.ts         footstep cadence from distance travelled (same stride law as the animator);  surface.ts = what the foot lands on
  volume.ts         slider -> gain curve;  analyse.ts = offline measurement of every sound (used by the e2e test and by hand)
apps/client/src/game/GameAudio.ts   replicated state -> sounds (footsteps, jump/land, pickup/drop/throw, down, revive, hurt, sever)
apps/client/src/input/bindings.ts   rebindable keys (+ conflict rules); Controls.ts reads them
apps/client/src/settings.ts         new settings + onSettingChange + applyDisplaySettings
apps/client/src/ui/{Settings,Pause,HowTo,Captions,modal,controlsInfo,woundCues}.ts, PadNav.ts (extended), Menu.ts (Options / How to play / version)
```

## How the engine behaves
- **Lazy and safe.** Nothing is created until the first pointer/key/touch (`resumeOnGesture`, installed by `startAmbience`). With no `AudioContext` (Node, tests,
  a locked-down browser) every function is a no-op and never throws; **captions still work** with no sound at all. `audioState()` is `unsupported | idle | running | suspended`.
- **Graph.** `voice chain (gain -> lowpass -> stereo pan -> [send])` -> sfx bus; ambient one-shots use a second lane into the ambience bus; music and beds -> a *duck* gain ->
  their bus; all buses -> master -> `DynamicsCompressor` (-9 dB, 14:1, 1 ms) -> a soft clipper that cannot exceed full scale -> speakers. One generated stereo room (2.4 s, darker as it
  decays) is the reverb; each bus's send is scaled by that bus's volume so turning a channel down turns its reverb down.
- **Voices.** 28 sfx chains + 10 ambient chains are built once. `VoicePool` gives each sound a cap (footsteps 4, muskets 6, cannons 3 ...), a priority (cannon/explosion 4, guns/hurt/sever/down 3, ...,
  footsteps 0) and stealing (lowest priority, oldest first; a repeat replaces its own oldest; the stolen chain fades in 4 ms and the newcomer starts 30 ms later, so nothing clicks). A minimum gap per
  sound stops a single frame from playing it twice.
- **Allocation.** Per frame: `setListener` stores four numbers; `GameAudio.actor` is arithmetic; the stride tracker is a float. Per *sound*: one `AudioBufferSourceNode` (the platform makes it; the
  chain, its filter, panner and sends are reused). Not "zero allocation" in the WebAudio sense, but nothing per frame and one node per sound, versus 10-20 if effects were built live.
- **Spatial ("HRTF-lite").** `spatialise()`: level falls like 1/d beyond a per-sound reference distance (footstep 3 m, musket 14 m, cannon 45 m) and fades to exactly zero at its maximum; pan follows the
  bearing (forward = `(-sin yaw, -cos yaw)`, the CameraRig convention) and collapses to centre inside 1.5 m; air absorption and "behind the head" both lower a lowpass (20 kHz down to 600 Hz); far sounds
  get more reverb; guns and blasts arrive late over 20 m (`(d-20)/343`, capped at 0.9 s). Vertical position only affects distance.
- **Ducking.** A cannon/explosion pushes music and ambience down (by up to 0.8, 20 ms attack, ~0.5 s hold, slow release); small arms barely.
- **Loops.** `revive_hold` is a 1.6 s heartbeat-and-bandage loop; calling `playSfx("revive_hold", {pitch})` each frame keeps it alive and rises in pitch with progress; it fades ~0.4 s after the calls stop; `stopSfx` ends it at once.
- **Mute when unfocused.** Window blur / tab hidden -> master to 0 and the context is suspended; focus resumes it.

## Sound list and how each is built (all peaks are after normalisation, dBFS; "aud" = audible length)
| Sound | Built from | Peak | aud |
|---|---|---|---|
| `musket_shot` | broadband crack (hp 2.2 k, 50 ms) + blast (white noise, lowpass swept 4.2 k -> 320 Hz) + 165 -> 48 Hz thump + pink body 700 Hz + dull tail + powder fizz; light saturation | -1.0 | 1.4 s |
| `pistol_shot` | sharper crack (hp 2.8 k) + shorter blast + 230 -> 85 Hz thump + tail | -2.0 | 0.9 |
| `blunderbuss_shot` | wide crack + long blast + delayed second blast + 118 -> 32 Hz boom + 60 Hz sub + scattered pellet whines + tail; saturation 0.9 | -0.5 | 2.2 |
| `cannon_shot` | crack + 380 Hz body + blast (2.6 k -> 110 Hz over 0.9 s) + 72 -> 26 Hz and 44 -> 22 Hz subs + brown rumble + cliff slap 0.38 s later; saturation 1.2; ducks 0.8 | -0.3 | 3.9 |
| `explosion` | flash + blast 3 k -> 140 Hz over 1.1 s + 60 -> 22 Hz sub + 320 Hz body + 14 debris pops over 1.3 s + rumble + reflection; saturation 1.4 | -0.3 | 4.3 |
| `sabre_swing` | pink whoosh sweeping 0.6 -> 2.4 k, then a falling white whoosh, a faint steel shimmer | -9 | 0.4 |
| `sabre_hit` | tick + two inharmonic partial sets (1.2 k x 1/2.76/5.4/8.93 and 620 Hz) for steel, + thud | -3 | 0.9 |
| `reload_click` | click, three ratchet ticks, ramrod slide, final clack | -10 | 0.3 |
| `impact_flesh / wood / earth / iron` | thump + slap + wet band / pitched knock + hollow resonance + splinter tick / soil (brown lowpass) + grit + pebbles / tick + four inharmonic ring partials + ricochet whine | -5 / -5.5 / -6 / -4 | 0.2-0.9 |
| `footstep_grass / dirt / stone / wood / water` | pink swish + blades + thump / scuff + grit + pebbles / click + ring + tail / knock + board + rare creak / splash + bubbles. 4 variants each, cadence from `Stride` | -16 .. -14 | 0.2-0.4 |
| `jump`, `land`, `pickup`, `drop`, `throw` | cloth rustle + push / thud + dust + buckle jingle (louder with fall speed) / leather rustle + tick / thud + clack / whoosh + breath | -14 .. -8 | 0.2-0.3 |
| `ui_click / hover / confirm / error` | typewriter tick + low tap / paper tick / rubber-stamp thunk + brass ting / two descending buzzes + thunk | -18 / -28 / -12 / -14 | 0.1-0.8 |
| `revive_hold` (loop) | heartbeat (62 Hz sine + 130 Hz triangle so laptops hear it) x2 per loop, under bandage rustle | -14 | 1.6 loop |
| `revive_done` | C5 + G5 chime with triangle overtones, exhale, sparkle | -8 | 1.7 |
| `hurt` | 12 baked characters: a sawtooth glottal source (88-187 Hz) gliding down, three formant filters per vowel (oh / uh / ah / eh), vibrato, breath; chosen by `seedFromString(look)` so a face keeps its voice | -6 | 0.5 |
| `down` | 78 -> 38 Hz thud + brown body + cloth + gear clatter + exhale | -7 | 0.7 |
| `limb_sever` | **full**: bone snap (bp 2.3 k) + triangle crack + wet rip (band 350 -> 1100 Hz) + squelch bubbles + dull thud; **reduced**: same, wet part halved, no bubbles; **off**: a comic xylophone "plink" (E6 + octave) and boing, nothing wet. The engine picks the key from the gore setting | -5 | 0.5 |
| `notice`, `telegram_bell` | brass counter bell struck twice (2.09 kHz, partials 1/2.02/2.98/4.2) + telegraph key clatter + a last ting | -9 | 1.8 |
| `thunder` | crack + brown roll (500 -> 120 Hz over 3.5 s) + 48 Hz sub + three rolling re-bursts | -6 | 5.7 |
| `bird` (8 variants) | tweet-tweet-tweet chirps / a seven-note trill / a woodpigeon coo | -20 | 0.4 |
| `fire_pop`, `fire_snap` | tiny bandpassed clicks with the odd pop / a bigger crack with sparks | -24 / -18 | <0.2 |

Ambience beds (`ambience.ts`): wind = pink noise, lowpass 700 Hz with slow gust LFOs + a thin whistle that only rises in a gale; rain = white noise 0.9-6.5 kHz + pink drumming at 350 Hz;
crickets = three 4.3-5.1 kHz sines gated into chirps by a 26-31 Hz pulse and a 2-3 Hz phrase LFO, panned apart; fire = brown-noise roar + hiss, *positional* at `CAMP.fire`, with pops
and snaps scheduled at random; stream = three wandering bandpass bands, positional at the nearest reach of the channel; waterfall = broad rush, positional at `RIVER.a`. Birds by day
(`daylight()` ramps 5-7.2 h and 17.8-20.5 h), crickets at dusk and night, both silenced by rain; weather from `getAtmosphere()`; thunder plays at `thunderAt` (already the arrival time).

Music (`musicScore.ts`, `music.ts`): menu = a parlour waltz in F major, 104 bpm (bass on 1, chord stabs on 2 and 3, a music-box tune on top); field = a calm 56 bpm 4/4 in C major (pad, harp-like arpeggio,
sparse bell melody). Chord progressions are four hand-picked eight-bar patterns; the melody is a seeded random walk that snaps to chord tones on strong beats, repeats its rhythm from the first half of a
phrase in the second, and always lands on the tonic; every fourth phrase brings the first tune home. Fixed seed, so the same music on every machine. Instruments are a handful of decaying sine
partials plus a hammer of filtered noise (piano-ish), detuned pairs (music box), and a slow triangle pad. Fades between menu and field over ~1 s.

## Levels (measured offline, default volumes, through the real bus/reverb/limiter graph)
Single sounds, peak / RMS in dBFS at the speakers: musket -3.3 / -27, pistol -3.7 / -34, blunderbuss -4.3 / -22, cannon -3.4 / -15, explosion -1.7 / -14, footstep -23 / -52, flesh impact -9.8,
hurt -13, UI click -25. Worst case (six muskets, six pistols, cannon, explosion, two blunderbusses, thunder, hurt, impact and sever at once, all within 12 m): **peak -1.2 dBFS** (the soft clipper is what
keeps it under 0; the same pile without it peaked at +0.4). Beds RMS: calm day at the spawn -39, beside the fire at night -30, storm -26, at the pond -35, at the falls -32. Music RMS -31 (menu), -34 (field).
Nothing is NaN, nothing has DC that matters, nothing is silent (`tests/e2e/settings.spec.ts` asserts this for all 125 buffers; `analyse.ts` prints the table).

## Settings map (`settings.ts`; every one persists in `localStorage`, `?param` overrides for the session and never touches the saved value)
| Setting | Key / URL | Default | Applied |
|---|---|---|---|
| Master / Music / Effects / Ambience volume | `cb.vol.{master,music,sfx,ambience}` / `?vol= ?musicvol= ?sfxvol= ?ambvol=` (0-1) | 0.8 / 0.6 / 0.9 / 0.8 | live (squared curve) |
| Silent when unfocused | `cb.muteUnfocused` / `?muteblur=` | on | live |
| Graphics low/medium/high | `cb.gfx` / `?gfx=` | medium | live: `Stage.setPreset()` rebuilds the world, shadow map, pixel ratio (characters keep the outline choice they were created with) |
| Interface scale 80-150% | `cb.uiScale` / `?ui=` | 100% | live (`--ui-scale`, root font-size, capped at 5.2 vh so a short window is never outgrown) |
| Reduce motion | `cb.reduceMotion` / `?reducemotion=` | system preference | live (`data-motion`), caps camera shake at 20% |
| Field of view 50-100 | `cb.fov` / `?fov=` | 65 | live (first person shifts with it) |
| Gore, severed limbs, camera view, head bob | existing keys | full / shown / third / on | live |
| Mouse / stick sensitivity 25-300% | `cb.sensitivity`, `cb.padSensitivity` / `?sens= ?padsens=` | 100% | live |
| Invert Y, sprint hold/toggle | `cb.invertY`, `cb.holdToSprint` | off / hold | live |
| Key bindings | `cb.bindings` (only differences from the defaults) | see `bindings.ts` | live |
| Colour-blind safe marks | `cb.cvd` / `?cvd=1` | off | live (`data-cvd`: hatching + a shape mark per zone) |
| High contrast | `cb.highContrast` / `?contrast=1` | off | live (`data-contrast`) |
| Larger text | `cb.largeText` / `?largetext=1` | off | live (x1.2 on the interface scale) |
| Captions | `cb.captions` / `?captions=1` | off | live |
| Screen shake 0-100% | `cb.shake` / `?shake=` | 100% | live |
| Field Manual seen | `cb.seenHowTo` | unseen | stops the NEW stamp |

Screens: menu -> **Options**, **How to play**, version line (`Pre-alpha 0.0.1`); in the field **Esc** (or the pad's **Start**, or anything that takes the mouse pointer back, which is what Esc does
while the pointer is locked) opens the pause sheet (Resume, How to play, Settings, Copy invite, Leave expedition - two presses); **F1** opens the Field Manual anywhere. Sheets are `role=dialog aria-modal`,
trap Tab, close on Esc / pad B / a click on the backdrop, and hold the game's controls off (`Controls.blocked`) while the world carries on for everyone else. Pad: D-pad/stick move focus, left/right
adjust sliders, selects and switches, A activates, LB/RB change tab, B closes.

The Field Manual does not open by itself on a first run: it would swallow the first keystrokes of every automated test and, honestly, of most players. Instead the menu's *How to play* button wears a NEW stamp
until the manual has been read once, and the in-game hint line starts "Esc pause, F1 manual".

## Colour-blind mode (what `data-cvd` does)
Injury chart: fills become ink hatching (one hatch for a scratch, cross-hatch for a gash, dense cross-hatch for a grievous wound, dashed outline for a lost limb) **and** each zone gets a mark whose shape says the same
(one slash, two slashes, a cross, a bar). The vitality gauge's red arc becomes an ink dot-dash; the revive bar's fill is a coarse ink hatch. Nothing in the base interface was colour alone (each state also has words, a number, a "!"
or an outline weight); this mode makes the difference visible at a glance.

## Contract with other work
- Combat calls `playSfx(name, {x, y, z, volume?, pitch?, seed?})`. Names: `musket_shot pistol_shot blunderbuss_shot cannon_shot sabre_swing sabre_hit reload_click impact_flesh impact_wood impact_earth impact_iron explosion`
  (plus everything above). Unknown names are ignored. Add a new gun by adding a recipe to `sounds.ts` (the registry test and the e2e level check pick it up).
- `GameAudio` already plays `hurt` (from `onHit`), `limb_sever`, footsteps, jump/land, pickup/drop/throw, down, revive; **combat should not also play `hurt`/`down`**.
- New keyboard actions: add a row to `ACTIONS` in `input/bindings.ts` (id, label, default keys, wire `button`, `tap`); the settings list, the how-to card, conflict detection and Controls all follow. Mouse buttons are fixed.
- Environment: `getAtmosphere()` is read at 10 Hz; `thunderAt` is treated as the *arrival* time of the clap.

## Tests
`audio/{volume,voicePool,spatial,captions,musicScore,ambienceMix,stride,sounds,engine}.test.ts` (curve; caps and stealing; pan/distance/behind; caption selection and gate; determinism, scale membership, register and tonic ending of the score;
targets by hour/weather/position; cadence and surface; registry completeness, mix ordering and recipe sanity; the whole engine against a fake Web Audio, including "no AudioContext at all" and "constructor throws"), `input/bindings.test.ts`
(conflicts, swap/replace, reserved keys, last-key rule, sanitising, persistence, live lookups), `settings.options.test.ts`, `ui/{woundCues,controls}.test.ts`, and `tests/e2e/settings.spec.ts` (settings by mouse and keyboard, persistence,
accessibility attributes, scale, rebinding with conflict, the manual, the real audio engine baking and measuring every sound, captions, the pause sheet in a real expedition).

## Weak spots / not done
- **Nobody has listened to any of it.** Levels and spectra are measured; timbre, taste and balance are not. Expect to retune: the cannon's low end, the hurt voices (formant synthesis can sound like a kazoo), fire pops, bird chirps, and the music, which is
  competent-but-generic parlour pastiche. The numbers to turn are all in `sounds.ts` (`peakDb`, layer peaks) and the gains in `ambience.ts`.
- Music is the least developed part: no stingers, no dynamic layers for danger, one seed. The fade between menu and field is a crossfade, not beat-matched.
- Footstep cadence is distance-based, not the animator's private phase: within a few cm of the feet landing, but a limp, a peg leg or a drunk's lurch will drift out of sync.
- `drop` and `throw` cannot be told apart for remote players (only the local player's Throw press is known), and `pickup`/`drop` fire on the CARRYING flag, so a prop snatched by the server also sounds.
- No occlusion (walls do not muffle), no doppler, no interior reverb; "behind you" is a lowpass, not a head-related filter.
- Baked effects are ~17 MB of float samples in RAM at 44.1 kHz; a 22 kHz bake or shorter tails would halve it if that matters.
- A browser that blocks audio until a gesture means the front door is silent until the first click (there is no "click to unmute" hint yet). Electron can start the context unlocked (`autoplay-policy`).
- Captions cover key sounds only; there is no size slider of their own (larger text and interface scale scale them) and no speaker names. Positional captions do not yet include vertical direction.
- The gamepad cannot rebind (layout is fixed and shown); keyboard rebinding is two slots per action and does not cover mouse buttons.
- Graphics preset changes rebuild the world (a visible hitch); characters already spawned keep their old outline/LOD choices until the next session.
- `tests/e2e/settings.spec.ts` ran once at the end of the session: 8/8 passed (including the pause sheet in a real expedition). The audio graph was checked in a real headless Chromium `AudioContext` (starts on a click, bakes 125 buffers, plays, no errors) but not through speakers.
