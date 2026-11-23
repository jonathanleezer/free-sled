# Free Sled

An original top-down downhill sledding game in the spirit of the classic 90s desktop ski games. It's pure HTML5 canvas with no build step and no dependencies. All art is pixel art generated in code at startup, and every sound is synthesized with WebAudio.

**Play:** open `index.html` in a browser.

## Modes

| Mode | Goal |
|---|---|
| **Race** | You against 5 computer sledders (Max, Zoe, Ollie, Pip, Bea) on a 1,200 m course. Grab gifts for items and finish first. |
| **Free Run** | An endless hill. See how far you get. At 2,000 m a runaway snowplow starts chasing you. |
| **Gate Run** | 800 m course with about 29 gates. Pass between each pair of flags; every miss adds 5 seconds. |
| **Big Air** | 1,000 m terrain park full of ramps and mogul fields. Land tricks to score points. |

Best scores are saved in `localStorage`.

## Controls

| Key | Action |
|---|---|
| ← → / A D | Steer in notches. Keep tapping to turn fully sideways and stop. When stopped sideways, tapping again scoots you over. |
| ↓ / S | Point straight downhill |
| ↑ / W | Drag your heels to brake |
| Space | Hop over rocks, stumps and flags |
| Shift / F | Tuck for extra speed (drains the stamina bar) |
| **In the air** | ← → spin · ↓ front flip · hold ↑ superman |
| Mouse / touch | Point to steer, click or tap to hop |
| E / X / Ctrl | Use your item (Race mode). Right-click also works; on touch screens there's an ITEM button. |
| P / Esc · R · M | Pause · restart · mute |

You have to land straight: if your spin finishes more than 40° off, a flip is unfinished, or you're still holding superman when you land, you bail.

### Scoring

* 360 spin: 150 pts · 720: 500 · 1080: 1050
* Front flip: 250 pts (a double flip scores 1,000)
* Superman: 60 pts plus more the longer you hold it
* Combining different trick types multiplies the total (×2, ×3)

## Race mode

* **Countdown:** press ↓ or Shift within half a second of GO for a **rocket start**. Press too early and you stall.
* **Gifts:** rows of wrapped presents sit across the course. Hit one to spin the item roulette. Gifts reappear 3 seconds after they're taken.
* **Items:** the further back you are, the better your odds:

| Item | Effect |
|---|---|
| Snowball | Thrown ahead and homes in on the nearest rival in front, who spins out |
| Snowball ×3 | Three throws |
| Slush | Dropped behind you; whoever hits it spins out |
| Turbo Wax | A burst of speed for 2.6 s that also cuts through deep powder |
| Snow Globe | A shield for 10 s that blocks one hit (including a tree) |
| Blizzard | Snows in every racer ahead of you: they slow to a crawl and steer sluggishly for 2.8 s |

* **Tricks:** landing a trick in a race gives a short speed burst.
* **Computer rivals:** each one looks ahead, chooses a line around obstacles, aims for ramps and gifts, avoids slush, tucks on straights and uses items sensibly. Each has its own skill level and makes the odd mistake. They have a mild catch-up adjustment: rivals far ahead of you ease off a little, and rivals far behind push a little harder.

## The hill

* **Pines, dead trees, big rocks, snowmen**: you crash. Snowmen also go splat.
* **Small rocks, stumps, flags**: you trip and tumble. Hop over them.
* **Ramps**: launch height scales with your speed.
* **Moguls**: small launches at speed.
* **Ice**: you can't steer, and you speed up a little.
* **Deep powder**: slows you down.
* **Locals**: a dog that chases you, kids spinning on saucers, and a cross-country skier who drifts across your line.

## Code layout

```
index.html        page shell
src/font.js       5x7 bitmap font and cached text renderer
src/sprites.js    pixel-art sprite factory (hand grids + procedural painters, RotSprite-style rotation)
src/audio.js      synthesized sound effects
src/game.js       world generation, racer physics (120 Hz fixed step), rival AI, items, NPCs, plow, rendering, UI
```
