# Free Sled

An original top-down downhill sledding game in the spirit of the classic 90s desktop ski games. It's pure HTML5 canvas with no build step and no dependencies. All art is pixel art generated in code at startup, and every sound is synthesized with WebAudio.

**Play:** open `index.html` in a browser.

## Modes

| Mode | Goal |
|---|---|
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
| P / Esc · R · M | Pause · restart · mute |

You have to land straight: if your spin finishes more than 40° off, a flip is unfinished, or you're still holding superman when you land, you bail.

### Scoring

* 360 spin: 150 pts · 720: 500 · 1080: 1050
* Front flip: 250 pts (a double flip scores 1,000)
* Superman: 60 pts plus more the longer you hold it
* Combining different trick types multiplies the total (×2, ×3)

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
src/game.js       world generation, physics (120 Hz fixed step), NPCs, plow, rendering, UI
```
