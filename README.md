# {Shan, Shui}*
Procedurally-generated vector-format infinitely-scrolling Chinese landscape for the browser.
Generate your own on https://lingdong-.github.io/shan-shui-inf/ (or [Alternative link](https://shan-shui-inf.glitch.me)).

Some examples:
![Screenshot1](/screenshots/screen001.jpg?raw=true "")
![Screenshot2](/screenshots/screen002.jpg?raw=true "")

{Shan, Shui}\* is inspired by [traditional Chinese landscape scrolls](https://en.wikipedia.org/wiki/Shan_shui) (such as [this](https://en.wikipedia.org/wiki/Dwelling_in_the_Fuchun_Mountains) and [this](https://en.wikipedia.org/wiki/Wang_Ximeng)) and uses noises and mathematical functions to model the mountains and trees from scratch. It is written entirely in javascript and outputs Scalable Vector Graphics (SVG) format.

## Development

The 2018 original is a single HTML file, kept untouched in [`legacy/index.html`](legacy/index.html). The current version is the same drawing code split into TypeScript modules and built with Vite.

```
npm install
npm run dev      # local server with hot reload
npm test         # equivalence, determinism and snapshot tests
npm run build    # static site in dist/
```

How it fits together:

- `src/gen/` generates the world. `tree`, `mount`, `arch`, `man`, `water` and `brush` are the original drawing code; `planner` decides what goes where; `engine` turns a seed and a chunk index into SVG elements. Randomness is passed in rather than taken from `Math.random`, and each 512-unit chunk has its own random stream, so a chunk looks the same no matter where you started scrolling from.
- `src/gen/world.ts` splits the world into two layers (distant ranges, and everything else) that scroll at different speeds; `season.ts` holds the foliage colours.
- `src/app/worker.ts` runs generation in a Web Worker, paints bitmap tiles, and renders PNG/SVG exports.
- `src/app/view.ts` composes a frame: paper, sky (`sky.ts`), ink tiles, and the things that move on their own (`ambient.ts`: mist, birds, petals, leaves, snow). `motion.ts` is the camera; `sound.ts` synthesises the optional soundscape.
- `public/` holds the web app manifest, icons and the service worker that makes the built site work offline.

The address bar always holds a link to the current spot: `#seed=<seed>&x=<position>`, plus `&sky=dawn|day|dusk|night` and `&season=spring|summer|autumn|winter|ink` when those are pinned. Adding `&drift` opens straight into drift mode (controls hidden, slowly scrolling).

Keys: `←` `→` scroll, `space` toggles auto-scroll, `f` toggles drift mode, `esc` leaves it.

`tests/equivalence.test.ts` runs the legacy page's scripts next to the new modules with the same random numbers and requires identical SVG output.
