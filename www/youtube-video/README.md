# Universal MediaSync — YouTube video (Remotion)

Remotion recreation of `Universal Mediasync For Youtube.mp4` (133 s, 1080p30) with
every on-screen text localizable. Compositions: `MediaSync-en` and `MediaSync-ca`.

## How it is built

| Time | Content | Source |
|------|---------|--------|
| 0–76 s | TV, phone, channels, MPEG-DASH diagram, features | Redrawn in React (`src/scenes/Story.tsx`) |
| — | Photographic content inside the screens (Sagrada Família, sign language, eclipse, planets) | Original render, clipped to the device screen (`OriginalInset`) |
| 76–115 s | Event footage, UHD Spain article, store badges | Original render (no text to translate) |
| 115–130 s | Logo animation | Original render; only the tagline is covered and redrawn |
| 130–133 s | End card | Redrawn |

The soundtrack is the original audio track. Every timing lives in `src/timeline.ts`
(frames measured on the original), so the cut matches the music.

## Usage

```sh
npm ci
npm run prepare-media          # copies the original video and brand icons into public/
npm run studio                 # preview
npm run render:ca              # out/universal-mediasync-ca.mp4
node scripts/compare.mjs --lang=en 105 1580   # original vs. recreation, out/compare/
```

`prepare-media` takes the original from `www/ibc_demostrations/` by default, or from a
path given as an argument.

## Adding or editing a language

Edit or copy a block in `src/i18n.ts`; `Root.tsx` registers one composition per
language. Long feature headings and the outro tagline shrink automatically to fit.

## Notes

- Fonts: Trebuchet MS (Windows system font) for the scenes and Figtree (OFL, bundled
  in `public/fonts`) for the outro, so rendering works without internet access.
- Behind the corporate proxy, Remotion cannot download Chrome Headless Shell. Download
  `chrome-headless-shell-win64.zip` for the version Remotion requests with `curl` and
  unzip it into `node_modules/.remotion/chrome-headless-shell/win64/`, with a `VERSION`
  file containing that version.
