# ironwake

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/MuhammadRizki133/ironwake-2/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/MuhammadRizki133/ironwake-2/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**IRONWAKE** is a round-based tactical FPS for the browser, in the Counter-Strike shape but entirely its own: an original dusk-foundry map (the Furnace hall and the Depot, a walled mid with an S-bend, two connectors), two teams of five, and a Charge to plant or defuse. The Breakers attack; the Wardens hold the plant. First to 7 of 12 rounds, with an economy between rounds — five guns (Sparrow P9, Breacher-12, Ripper-9, Longbow AR, Needle DMR), armour, and frag/flash/smoke grenades bought from a supply menu.

Gunplay rewards stopping to aim: spread blooms with movement and sustained fire and settles when you plant your feet or crouch; damage is hitscan against head and body spheres with a headshot multiplier, armour reduction and range falloff. The nine bots perceive only what they can see (facing cone, real sightlines, smoke blocks vision) or hear (gunfire and footsteps are noises in the world), follow a navigation graph over the map, hold posts and return to them, work a team plan each round — and plant, defend, retake and defuse the Charge.

The simulation runs on a fixed 60 Hz step kept apart from rendering, in small single-job modules under `game/src/` (state, world, weapons, bots, round, player, fx, audio, hud). All sound is synthesized with WebAudio; there are no asset files beyond the vendored three.js. `main.ts` hands the entry in (copies `game/` and `screenshots/` to the output and writes the dossier); the screenshots are staged, deterministic scenes of the real game (`?shot=play&seed=7` and friends).

## Run it

```sh
node serve.ts
# then open http://localhost:8080 — click to play: WASD + mouse, B buys, hold E plants
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=3t681ag0&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
