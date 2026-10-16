# scm-sim

A library plugin for [scmJS](https://github.com/scm-js/scm-js), the browser-based StarCraft 1 /
Brood War map editor. It is the way from the editor to scm-sim, the game engine behind the
site's play page at [scmjs.dev/play](https://scmjs.dev/play/).

It adds one menu item, **Tools ▸ Test Map in Browser**, which plays the open map on the play
page in a tab of its own. Everything else is for other plugins, which use it to:

- **play a replay to its end** without showing it, and get back what happened: every unit
  made, finished and lost, with where and when; each player's minerals, gas, supply,
  workers and army through the game; what was researched; and where units stood;
- **start a map** on the play page, in a browser tab.

The plugin holds no engine. The engine is a separate program served beside the editor, and
the plugin talks to it by message inside your browser. A replay or a map handed over is not
stored and not sent anywhere.

## Where it works

Only where the editor is served beside the play page: at scmjs.dev, or on a stand-in for the
site on your own machine. In the desktop app, or an editor hosted somewhere else, the service
is there but says it is not present, and a plugin that uses it should fall back to what it
can do without.

The engine runs the game from your own copy of StarCraft. If the browser has none, give the
site your game on the Game Data page. **Edit ▸ Preferences ▸ Plugins ▸ scm-sim** says
whether the engine can run a game now.

## Test Map in Browser

**Tools ▸ Test Map in Browser** plays the open map on the play page, as Save would write it.
Testing again sends the new version to the same tab. How it is played is set on the
plugin's page under **Edit ▸ Preferences ▸ Plugins ▸ scm-sim**:

| Setting | What it does |
| --- | --- |
| Game type | *From the map* (the default): Use Map Settings when the map has computer players or units placed beyond the start locations, melee otherwise. *Use Map Settings* or *Melee*: always that. *Choose on the play page*: the map opens on the play page's setup screen and nothing starts until Start Game there. |
| Your race | Random, Terran, Protoss or Zerg. In Use Map Settings, only where the map leaves the race to the player. |
| Your slot | Use Map Settings only: the first slot open to a person, or a player you name (when the map opens that slot to a person). |
| Computers, Computer race | Melee only: how many computer players, up to the places the map has, and their race. |

A play page from before these settings plays every map with its own settings.

## Install

In scmJS: **Plugins ▸ Manage Plugins…**, paste

```
https://github.com/scm-js/plugin-scm-sim
```

and press **Add**. A plugin that needs it names it in its own manifest, and the editor
installs both together:

```json
{ "requires": ["github:scm-js/plugin-scm-sim"] }
```

## Use it from a plugin

Copy [`contract.d.ts`](contract.d.ts) into your plugin and import it as types only.

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

### `status()`

Asks the engine whether it can run a game now. `available` is false with a `reason` in words
when the browser has no copy of StarCraft, or the engine's page did not answer.

### `analyse(replay, options?)`

`replay` is a whole `.rep` file. A twenty-minute game takes about ten to fifteen seconds. One
replay runs at a time; further calls wait their turn. The engine uses about a gigabyte of
memory while it runs and gives it back when the replay ends.

The answer is a `ReplayTimeline`:

| Field | What it holds |
| --- | --- |
| `events` | One entry each time a unit is `born`, `done` (finished), `morph`s into another type, is `given` to another player, or `died`. Each has the frame, the unit's number, its type, owner and place in pixels. A `died` event also names the unit credited with the kill (`by`, `byType`, `byOwner`, `byX`, `byY`) where the game credited one. |
| `research` | Upgrades and technologies as they finish, per player. |
| `samples` | Every 48 frames by default (two seconds at Fastest): each player's minerals, gas, supply used and available, finished workers, army size, army cost and finished buildings. |
| `positions` | At the same frames, where every unit stood. Buildings and units inside a transport or bunker are left out. Typed arrays; `start[i]` to `start[i + 1]` are the rows of sample `i`. |
| `players`, `map`, `frames`, `total`, `ended` | The players as the replay names them, the map's size in tiles, how far the game was played and how it stopped. |
| `check` | Whether the game the engine played stayed the game in the replay. `parted` is null when it did, else the frame from which the timeline is no longer what happened. See below. |

A unit's number is the timeline's own, counted from 0 in the order units appear, and stays
with the unit for its whole life. Things to know when reading the events:

- A Zerg unit is a chain of morphs: a larva is born, morphs into an egg, the egg morphs into
  the unit, and then it is done. A drone morphs into the building it becomes.
- A refinery, extractor or assimilator is a morph of the geyser it stands on.
- A player who leaves gives every unit to a neutral player; these are `given` events, not
  deaths.
- A kill is the game's own credit: a reaver gets its scarab's kills, a carrier its
  interceptors'. Scarabs and spider mines that go off are deaths with no killer, and so is
  what a spider mine killed. When several units fall in the same instant the pairing of
  killer and victim is the likeliest one, not a certain one.

`sampleEvery` and `positionsEvery` change the two intervals; `positionsEvery: 0` leaves the
positions out.

### `play(map?)`

Starts a map on the play page in a tab of its own; the next call uses the same tab. Leave
`map` out to play the open map as Save would write it. It is played as the Preferences
page says (above); with *Choose on the play page* it is put on the setup screen and
resolves when it is shown there. Call it from the click that asks for
it, because a browser only lets a click open a tab. It resolves when the game is on the page.

### `pathing(scenario?, options?)`

Since 0.7.0, and only where the play page answers it: `status().pathing` is a number there
and null on an older page. Check for both before offering it.

The game's own pathing for a map. Leave `scenario` out for the open map, or pass a bare
scenario (`.chk` bytes). Nothing is shown and nobody plays: the engine starts the map on a
copy made for the purpose and only gives units move orders. That copy has a neutral Nexus
on every start location, the test units, and none of the map's triggers. A StarEdit copy of
the game is enough for it.

The answer is a `PathingResult`:

| Field | What it holds |
| --- | --- |
| `regions` | The regions the game divides the map into when it loads it, which is what it plans ground routes over. `grid` holds a region id for every 8 × 8 px cell of the map. Per region: whether it is `walkable`, its `group` (ground of one group is joined; different groups are not), its centre, its size in tiles and its neighbours. Typed arrays. |
| `walks` | One per unit and pair of places: the unit type, `from` and `to` (and the start locations' slots), the `outcome`, the `frames` it took (24 a second at Fastest), the pixels it `travelled`, how far from `to` it ended, how many regions it crossed, and its route (`x`, `y` every `every` frames). |
| `starts`, `map` | The map's start locations and its size in tiles. |

`outcome` is `arrived`, `stopped` (it stopped short: the game found no way all the way
there, or gave up on a long route), `stuck` (it stood still for ten seconds still meaning to
move), `limit` (still walking when `limit` ran out), `apart` (not walked: the two places
are on ground that does not join) or `unmoved`.

By default it walks a Probe, Zergling, Dragoon, Siege Tank and Ultralisk from each start
location to every later one. Each start location walked from is a game of its own, a few
seconds each: a 4-player map takes about eight seconds, an 8-player map about forty.
Options:

- `units`: other ground units (units.dat ids).
- `directed`: walk both ways between two start locations.
- `from` and `to`: walk between your own points instead of the start locations.
- `regions: false`: leave the regions out.
- `limit` and `every`: the frames a walk may take, and how often its position is kept.
- `signal` and `onProgress`: as for `analyse`.

### `view(element)`

Since 0.5.0. The game itself, drawn inside an element of yours and filling it: a replay
played with the game's own graphics (Remastered's where the person's copy has them) and
its console, which you drive. The engine is about a gigabyte of memory, so keep one view
and load replays into it in turn. Check that `view` is there before calling it; an older
copy of this plugin has none.

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

`camera(x, y)` looks at a point of the map in pixels and `player(slot)` picks whose eyes
the fog is drawn through. Since 0.6.0, `camera(x, y, height)` also sets how much of the map
shows top to bottom, from 240 to 960 pixels (the game's own view is 480), so the game can
match the scale of the map it replaces. This works only while the console is hidden, and it
is hidden unless you ask for it with `options({ console: true })`. `onUnits` hears the
squares the game's minimap would draw (each one's middle and size in map pixels, and its
colour) up to eight times a second, so you can draw a minimap of your own, such as the
editor's.

Also since 0.6.0, `follow(track)` hands the view a camera path for the whole game: where
the middle of the view is every few frames, with the points where it cuts. The game moves
its camera along it as it draws, by the frame it shows, so the camera keeps in step with the
picture and stays smooth at any speed. Moving the camera with `camera(x, y)` on every frame
report can't do that, because the reports come only ten times a second. The track holds
until `camera`, another track, `follow(null)`, or the person moving the view, which comes
to `onCamera` with `byUser`. Check `follows` on the loaded replay first, since an older page
ignores a track.

With the fog on, the squares come with the fog itself: `fog` has a byte per tile, row by row,
`wide` tiles to a row (0 never seen, 1 seen before, 2 seen now), so a minimap of your own can
darken its ground the way the game's does. `onHover` hears what the pointer is on, for a
tooltip of your own, since the view shows the game without its console: the unit's type,
owner, hit points, shields and energy, what it is making or researching and how far along it
is, its training queue, and where the pointer is. It comes up to thirty times a second while
the unit or the pointer moves, and null once the pointer is on nothing. In a replay this
covers every player's units, as the game's replay console does, but only what the eyes the
game is seen through can see.

A key pressed while the view has the keyboard and that it does
not use itself (all but the arrows, which scroll) comes to `onKey` and is pressed again on
the editor's window, so the editor's hotkeys and every plugin's still work. Inside the
editor, `api.ui.mapView` is the place for the element: it is never moved, so the game is
not started again when the person switches to the map and back.

## Replays it can play

The engine runs StarCraft 1.16.1's own game code. A replay written by 1.16.1 is given to it
as it is. A replay written by 1.18 or StarCraft: Remastered is first rewritten in 1.16.1's
form, inside the browser, and then played the same way.

Two kinds of Remastered game cannot be played, and `analyse` rejects with a message that
says which:

- **A map on Remastered's terrain, with a copy of StarCraft from 1.16.1.** Remastered added
  tiles to seven of the eight tilesets and its ladder maps use them. The game needs the
  tilesets the map was made for, so such a replay plays only when the copy of StarCraft in
  the browser was made from a Remastered installation.
- **A game that held more than 1,700 units at once.** Remastered raised that limit and
  1.16.1's game has no room for the rest.

A replay has no record of the game to compare against, only the players' commands. So the
engine checks each command as it runs: a command names the unit it is for, and a command
for a unit the game has not made yet means the game being played is no longer the one that
was recorded. `check.parted` is the frame of the first such command, or null. It has been
null to the last frame in every 1.16.1 and Remastered replay tried so far. If a game passes
one of 1.16.1's other limits (100 bullets in the air, 2,500 sprites), Remastered's game and
this one go different ways from there, and `parted` is how that shows.

## Development

```
npm install
npm run typecheck
npm test
npm run build      # dist/plugin.js, the bundle the editor loads
```

The conversation with the engine's pages is written at the top of `src/bridge.ts` (replay
analysis) and `src/play.ts` (playing a map). The timeline types in `contract.d.ts` are a copy
of the engine's own; `ReplayTimeline.version` says which form a timeline has.

## License

MIT. The engine itself is not part of this repository.
