# scm-sim

A library plugin for [scmJS](https://github.com/scm-js/scm-js), the browser-based StarCraft 1 /
Brood War map editor. It connects the editor to scm-sim, the game engine behind the site's
play page at [scmjs.dev/play](https://scmjs.dev/play/).

It adds two commands: **Test in Browser**, which plays the open map on the play page in a tab of
its own, and **Debug Triggers in Browser**, which plays it under the map and shows what its
triggers do. Everything else is for other plugins. They use it to:

- play a replay to its end without showing it, and get back what happened in it;
- start a map on the play page;
- work out a map's pathing as the game walks it;
- measure groups through chokes and each base's mining;
- play a replay's fights again;
- show a replay inside the editor with the game's own graphics.

The plugin holds no engine. The engine is a separate program served beside the editor, and
the plugin talks to it by message inside your browser. A replay or a map handed over is not
stored and not sent anywhere.

## Install

scm-sim comes with the editor and starts on. If you removed it, open
**Plugins ▸ Manage Plugins…**, paste

```
https://github.com/scm-js/plugin-scm-sim
```

and press **Add**. A plugin that needs scm-sim names it in its own manifest, and the editor
installs both together:

```json
{ "requires": ["github:scm-js/plugin-scm-sim"] }
```

## Where it works

It works only where the editor is served beside the play page: at
[scmjs.dev/editor](https://scmjs.dev/editor/), or on a stand-in for the site on your own
machine. In the desktop app, or an editor hosted somewhere else, the service is there but
says it is not present. A plugin that uses it should then fall back to what it can do
without it.

The engine runs the game from your own copy of StarCraft. If the browser has none, give the
site your game on the Game Data page. **Edit ▸ Preferences ▸ Plugins ▸ scm-sim** says
whether the engine can run a game now.

## Test in Browser

**Tools ▸ Test in Browser** plays the open map on the play page, as Save would write it.
Testing again sends the new version to the same tab. On **Edit ▸ Preferences ▸ Testing**,
*Send the map to* chooses between this and StarCraft for **Tools ▸ Test Map**, Ctrl+F5 and the
toolbar's Test button; at scmjs.dev it is this one until you choose. How the map is played
is set on the same page:

- Game type: *From the map* (the default), *Use Map Settings*, *Melee*, or *Choose on the play
  page*. *From the map* plays Use Map Settings when the map has computer players or units
  placed beyond the start locations, and melee otherwise.
- Your race, and your slot for Use Map Settings.
- For melee, the number of computer players and their race.

The [user guide](https://docs.scmjs.dev/guide/checking-testing-and-saving/#test-map) has
more on each setting. An editor from before 0.8.6 has no *Send the map to*: there the item is
**Tools ▸ Test Map in Browser**, and its settings are under **Edit ▸ Preferences ▸ Plugins ▸
scm-sim**.

## Debug Triggers in Browser

**Tools ▸ Debug Triggers in Browser** plays the open map, as Save would write it, in a panel
under the map, always with Use Map Settings (a melee game runs the game's own melee triggers,
not the map's). You play it there as on the play page. Beside the game:

- **Pause** / **Play**, **Step Frame**, **Next Pass** (on to the next time the game runs the
  triggers) and **Previous Pass** (back to the one before). Going back replays your own orders,
  so stepping forward again comes to the same game; giving a new order after going back plays
  on from there instead.
- A timeline with a column for each pass of the triggers: how many fired (green), were held at
  an action such as a Wait (amber), or stopped at a condition (grey). Click a column to see that
  pass.
- The triggers of the selected pass, each with what happened to it: fired, held at action 2
  (Wait), condition 3 did not hold (Bring), went on from an earlier pass and finished. The game
  stops asking a trigger's conditions at the first that does not hold, so that is the one named.
  Click one to open it in the Trigger Editor. Triggers a build step added, such as a TrigScript
  program's, are listed but have no row of their own to open.

Run the command again to rebuild the map and start over in the same panel. It needs a play page
from the same release or later; an older one plays the map and sends nothing back, and the
panel says so.

## Use it from a plugin

Copy [`contract.d.ts`](contract.d.ts) into your plugin and import it as types only. It has
every type and option, with comments. This section is an overview.

```ts
import type { ScmSimService } from "./vendor/scm-sim";

api.services.watch<ScmSimService>("scm-sim.engine", (sim) => {
  if (!sim?.present) return;            // no engine beside this editor: do without
  button.onclick = async () => {
    const status = await sim.status();
    if (!status.available) { api.ui.status(status.reason ?? ""); return; }
    const timeline = await sim.analyse(replayBytes, {
      onProgress: (p) => bar.set(p.frames ? p.frame / p.frames : 0),
      signal: controller.signal,
    });
    // timeline.events, timeline.samples, timeline.positions
  };
});
```

Some methods came in later versions of the plugin or need a newer play page. Each section
below says what to check before offering one.

### `status()`

Asks the engine whether it can run a game now. `available` is false, with a `reason` in
words, when the browser has no copy of StarCraft or the engine's page did not answer.

### `analyse(replay, options?)`

`replay` is a whole `.rep` file. A twenty-minute game takes about ten to fifteen seconds. One
replay runs at a time, and further calls wait their turn. The engine uses about a gigabyte of
memory while it runs and gives it back when the replay ends.

The answer is a `ReplayTimeline`:

| Field | What it holds |
| --- | --- |
| `events` | One entry each time a unit is `born`, `done` (finished), `morph`s into another type, is `given` to another player, or `died`. Each has the frame, the unit's number, its type, owner and place in pixels. A `died` event also names the unit credited with the kill (`by`, `byType`, `byOwner`, `byX`, `byY`) where the game credited one. |
| `research` | Upgrades and technologies as they finish, per player. |
| `samples` | Every 48 frames by default (two seconds at Fastest): each player's minerals, gas, supply used and available, finished workers, army size, army cost and finished buildings. |
| `positions` | At the same frames, where every unit stood. Buildings and units inside a transport or bunker are left out. Typed arrays: `start[i]` to `start[i + 1]` are the rows of sample `i`. |
| `sight` | When each player could see each unit of the other players, as the game decides it: fog hides a unit, and a cloaked or burrowed unit is seen only by players who detect it. Each row is one stretch: a unit, the player who saw it, the frames from and to, and `by`, the player's unit nearest to having it in sight (or 0xFFFFFFFF). The game does not record which unit sees what, so `by` is the likeliest seer. Typed arrays. From timeline version 5 (scm-sim 0.11.0). |
| `players`, `map`, `frames`, `total`, `ended` | The players as the replay names them, the map's size in tiles, how far the game was played and how it stopped. |
| `check` | Whether the game the engine played stayed the game in the replay. `parted` is null when it did. Otherwise it is the frame from which the timeline no longer matches what happened. See [Replays it can play](#replays-it-can-play). |

`sampleEvery` and `positionsEvery` change the two intervals. `positionsEvery: 0` leaves the
positions out.

A unit's number is the timeline's own. It is counted from 0 in the order units appear and
stays with the unit for its whole life. When reading the events:

- A Zerg unit is a chain of morphs: a larva is born, morphs into an egg, the egg morphs into
  the unit, and then it is done. A drone morphs into the building it becomes.
- A refinery, extractor or assimilator is a morph of the geyser it stands on.
- A player who leaves gives every unit to a neutral player. These are `given` events.
- A kill is the game's own credit: a reaver gets its scarab's kills, a carrier its
  interceptors'. Scarabs and spider mines that go off are deaths with no killer, and so is
  what a spider mine killed. When several units fall in the same instant, the pairing of
  killer and victim is the likeliest one.

### `play(map?)`

Starts a map on the play page in a tab of its own. The next call uses the same tab. Leave
`map` out to play the open map as Save would write it. It is played as the plugin's
preferences say. With *Choose on the play page*, it resolves when the map is on the setup
screen. Otherwise it resolves when the game is on the page.

Call it from the click that asks for it, because a browser only lets a click open a tab.

### `playReplay(replay, at)`

Opens a replay on the play page, in the same tab as `play`, at frame `at.frame` and through
the eyes of `at.player` (a replay player's slot). The page pauses there with its Watch Replay
menu open, so the person can play on from that moment: alone, against a community bot, or
with others. `replay` is a whole `.rep` file. It resolves when the replay is on the page.
Added in 0.15.0, so check that it is there before offering it. A play page from before it
answers "No map came with the request."

Call it from the click that asks for it.

### `pathing(scenario?, options?)`

Since 0.7.0. Check that `pathing` exists and that `status().pathing` is a number (it is null
on an older play page).

The game's own pathing for a map. Leave `scenario` out for the open map, or pass a bare
scenario (`.chk` bytes). Nothing is shown and nobody plays. The engine starts the map on a
copy made for the purpose, with a neutral Nexus on every start location, the test units and
none of the map's triggers, and gives the units move orders. A StarEdit copy of the game is
enough for it.

The answer is a `PathingResult`:

| Field | What it holds |
| --- | --- |
| `regions` | The regions the game divides the map into when it loads it, which it plans ground routes over. `grid` holds a region id for every 8 × 8 px cell. Per region: whether it is `walkable`, its `group` (ground of one group is joined), its centre, its size in tiles and its neighbours. Typed arrays. |
| `walks` | One per unit and pair of places: the unit type, `from` and `to` (and the start locations' slots), the `outcome`, the `frames` it took (24 a second at Fastest), the pixels it `travelled`, how far from `to` it ended, how many regions it crossed, and its route (`x`, `y` every `every` frames). |
| `starts`, `map` | The map's start locations and its size in tiles. |

`outcome` is one of:

- `arrived`.
- `stopped`: it stopped short. The game found no way all the way there, or gave up on a
  long route.
- `stuck`: it stood still for ten seconds while still meaning to move.
- `limit`: still walking when `limit` ran out.
- `apart`: not walked, because the two places are on ground that does not join.
- `unmoved`.

By default it walks a Probe, Zergling, Dragoon, Siege Tank and Ultralisk from each start
location to every later one. Each start location walked from is a game of its own, a few
seconds each. A 4-player map takes about eight seconds, an 8-player map about forty.
Options:

- `units`: other ground units (units.dat ids).
- `directed`: walk both ways between two start locations.
- `from` and `to`: walk between your own points instead of the start locations.
- `regions: false`: leave the regions out.
- `limit` and `every`: the frames a walk may take, and how often its position is kept.
- `signal` and `onProgress`: as for `analyse`.

### `measure(scenario?, options?)`

Since 0.8.0. Check that `measure` exists and that `status().measure` is a number.

Measures of a map taken by the game itself. Leave `scenario` out for the open map, or pass a
bare scenario. As with `pathing`, nothing is shown, nobody plays, and a StarEdit copy of the
game is enough.

- Groups (`groups`): `count` units of a type (at most 12, one selection) are made at `from`.
  The one nearest `to` walks there alone, then the whole group walks there together. Each is
  timed as it gets through: two tiles past the middle of the way, which is the choke when
  `from` and `to` are its two ends. You get the frames for the one alone (`alone`), for the
  first and last of the group (`first`, `last`), and how many got through or got stuck.
  `last − alone` is the time the group spent queueing. Groups near each other run in
  separate games, so an idle group never blocks another.
- Bases (`bases`, and `starts: true` for every start location): a Nexus on the hall spot and
  24 Probes a few tiles away. For each worker count (`workers`, default 8, 16 and 24), that
  many Probes go to the base's mineral fields, nearest first. After 25 seconds, the minerals
  taken from the base's own fields are counted for two game minutes. The result is
  `perMinute` at each count. A spot the game will not take a Nexus on is reported
  (`hallMade: false`). Gas is not measured, because a trigger cannot build an Assimilator.

A 4-player map's start locations plus two groups take about ten seconds.

### `test(scenario, module, payload, options?)` and `testCopies(scenario, module, payload, options)`

Since 0.13.0, and only where the play page answers them: check `status().tests` and
`status().copies`. TrigScript uses these to run a script's tests in the game itself.

`test` starts the map as Save builds it (a whole `.scx`) in the game, with EUD allowed and
nothing drawn. It then imports `module`, the text of an ES module, and calls its
`runGameTests(game, payload)`. The promise resolves with what that returns. The module
runs with the play page's rights, so the page takes it only from an editor on the same
site.

`testCopies` is for a test of several players. It runs one copy of the game for each slot
in `options.players`, each copy seated as that player. The copies are kept in step as in a
real multiplayer game: each frame, every copy's commands reach all of them. Each copy
calls the module's `drive(game, payload)`. Through `game.copy`, a test can read what every
player was shown, and can find the frame at which the copies stopped agreeing (a desync),
with the lines that caused it when `options.triggers` gives the build's map of triggers.

You get back one answer per copy, in the order of `players`. Each copy uses about a
gigabyte of memory. The copies share memory with each other, which Chrome and Edge allow on
the play page from version 137. On other browsers `status().copies` is null.

### `fights(replay, fights, options?)`

Since 0.11.0. Check that `fights` exists and that `status().fights` is a number.

Plays a replay's fights again in the game, from just before each. Pass the whole replay
file, and for each fight its frames (`from`, the first loss, and `to`, the last) and the box
around what fell, in pixels, as your own analysis found them. Each fight is played in two
versions, measured the same way so they compare:

- `played`: the replay's own commands, as recorded.
- `attackMove`: the units that can attack, and the Medics, attack-move to the middle of the
  box. Nobody gives any other command anywhere until the fight ends. Production already
  queued finishes and walks to its rally point, and nothing new is started.

Ask for `versions: ["played", "attackMove", "handsOff"]` to add a version with no commands
at all.

The game decides which units took part: every unit of the sides that came into the box while
the fight was played, wherever it stood at the start. For each side you get:

- those units and their cost;
- the ones dead at the end, and their cost;
- the cost of what the side has inside the box at the end, units that arrived later
  included.

The replay is played once from its start and stops at each fight. That takes about as long
as `analyse` takes to reach the last fight, plus a second or two per fight. Two fights late
in a 22-minute game take about eleven seconds.

### `view(element)`

Since 0.5.0. Check that `view` exists before calling it.

The game itself, drawn inside an element of yours and filling it. It plays a replay with the
game's own graphics (Remastered's, where the person's copy has them), and you drive it. The
engine takes about a gigabyte of memory, so keep one view and load replays into it in turn.
Inside the editor, put the element in `api.ui.mapView`. That element is never moved, so the
game does not restart when the person switches to the map and back.

```ts
const view = sim.view(element);
const ready = await view.ready;              // { files, reason }: reason says why when files is null
const replay = await view.load(bytes, "game.rep");   // paused at frame 0
view.speed(4); view.play(true);
view.onFrame(({ frame, playing }) => timeline.move(frame));
view.onCamera(({ x, y, byUser }) => { if (byUser) stopFollowing(); });
view.seek(12000);                            // quick backwards too, when replay.rewinds
await view.options({ remastered: true, lighting: false, fog: false });
view.dispose();
```

The rest of the view, in short (`contract.d.ts` has the details):

- `camera(x, y, height?)` looks at a point of the map, in pixels. `height` (since 0.6.0) is
  how much of the map shows top to bottom, from 240 to 1920 pixels (960 before 0.9.0). It
  works only while the console is hidden, which it is unless you ask for
  `options({ console: true })`.
- `follow(track)` (since 0.6.0) moves the camera along a path for the whole game, in step
  with the frames the game draws. Use it for a smooth camera: frame reports come only ten
  times a second. Check `follows` on the loaded replay first.
- `player(slot)` picks whose eyes the fog is drawn through.
- `onUnits` gives the squares the game's minimap would draw, up to eight times a second, and
  with the fog on, the fog per tile (0 never seen, 1 seen before, 2 seen now).
- `onHover` (since 0.6.0) gives the unit under the pointer, for a tooltip of your own.
- `onKey` gives the keys the game does not use (all but the arrows). Each is also pressed
  again on the editor's window, so the editor's and other plugins' hotkeys still work.
- `onWheel` (since 0.9.0) gives the wheel over the view. Hand it to the editor's map view
  (`view.wheel(w)`) and the game zooms the way the map does.
- `onPointer` (since 0.10.0) gives the map pixel under the pointer, for the editor's status
  bar (`view.setPointer(p)`).

## Live edit: `scm-sim.live`

A second service, for a mod changed while a test game runs (the Mod Editor uses it). Its shape is `ScmSimLiveService`
in `contract.d.ts`; reach it with `api.services.watch<ScmSimLiveService>("scm-sim.live", …)`.

- `play({ map, mod: { name, hash, files }, useMapSettings? })` hands the mod's files (those that differ from the game's,
  by the game's paths) and a map to the play page's tab — the same tab `play` uses. The page keeps the files as a mod
  dropped on it would be, loads again with it and starts the map. With `map` null it only shows the mod. Call it from a
  click.
- `playing()` says whether a game played alone runs in the tab now; `state()` says more (the frame, the mod, the files
  waiting for a start), and `onState(listener)` hears it whenever a game starts there.
- `patch(fields, files)` sends changes into the running game. A field is `{ table, id, field, part?, value }` in PyMS's
  names, as the file stores it (hit points in 256ths); a file is `{ path, bytes }` by the game's path. The answer lists
  each item as `applied` (written into the game between two turns, a picture loaded and drawn, a graft's buttons or
  requirements written), `deferred` (kept, and taken at the next start: animation scripts, the sound table, strings and
  everything else the game reads once) or in `errors` with the reason. A game between people refuses every item.
- `grafts()` reads the running game's button sets and requirement lists as `.graft` files, for a mod that has none.

## Replays it can play

The engine runs StarCraft 1.16.1's own game code. A replay written by 1.16.1 is played as it
is. A replay written by 1.18 or StarCraft: Remastered is first rewritten in 1.16.1's form,
inside the browser, and then played the same way.

Two kinds of Remastered game cannot be played, and `analyse` rejects with a message that
says which:

- A map on Remastered's terrain, with a copy of StarCraft from 1.16.1. Remastered added
  tiles to seven of the eight tilesets, and its ladder maps use them. Such a replay plays
  only when the browser's copy of StarCraft was made from a Remastered installation.
- A game that held more than 1,700 units at once. Remastered raised that limit, and 1.16.1's
  game has no room for the rest.

A replay holds only the players' commands, with no record of the game to compare against.
So the engine checks each command as it runs. A command for a unit the game has not made yet
means the game being played has drifted from the one recorded. `check.parted` is the frame
of the first such command, or null. It has been null to the last frame in every 1.16.1 and
Remastered replay tried so far. A game that passes one of 1.16.1's other limits (100 bullets
in the air, 2,500 sprites) would drift there, and `parted` shows where.

## Development

```
npm install
npm run typecheck
npm test
npm run build      # dist/plugin.js, the bundle the editor loads
```

The messages exchanged with the engine's pages are listed at the top of `src/bridge.ts`
(replay analysis) and `src/play.ts` (playing a map). The timeline types in `contract.d.ts`
are a copy of the engine's own. `ReplayTimeline.version` says which form a timeline has.

## License

MIT. The engine itself is not part of this repository.
