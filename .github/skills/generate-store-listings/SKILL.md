---
name: generate-store-listings
description: Generate Google Play Store (and other market) listing texts — title, short description and full description — for every language supported by the app, wrapped in per-language tags. Use when preparing or updating store metadata for a release.
---

# generate-store-listings

## Purpose

Use this skill to produce the marketing texts required for the Google Play Console
store listing (and, by extension, the App Store) for **every language the app
supports**. The output is a single document where each language block is wrapped
in the corresponding Play Store locale tag, ready to copy‑paste into the console.

## Fit

Use this skill when:
- Preparing a new release that needs updated store metadata.
- Adding a new supported UI language and needing its store copy.
- Rewriting the title / short description / full description.

Do NOT use for:
- In‑app UI strings (those live in `src/i18n/translations.js`).
- Screenshots, feature graphics or other visual assets.

## Inputs — where the source of truth lives

1. **Supported languages** — the keys of the resources object in
   [`src/i18n/translations.js`](../../../src/i18n/translations.js). Today:
   `ca`, `es`, `eu`, `en`, `de`, `it`, `fr`.
2. **App name / brand** — [`src/brand/brand.config.js`](../../../src/brand/brand.config.js)
   (`appName`, `shortName`, `supportUrl`, `version`).
3. **Feature list & value proposition** — [`README.md`](../../../README.md)
   ("Vision", "Value Proposition", "How It Works") and the in‑app help/discovery
   strings in `translations.js` (accessibility tracks, private listening, DVB‑CSS
   sync, DIAL/SSDP discovery, background playback).

Always re‑read these files before generating, so the copy stays in sync with the
actual feature set and the current language list.

## Google Play field limits (hard limits — never exceed)

| Field | Max length |
|-------|-----------|
| Title (`Title`) | **30 characters** |
| Short description (`Short description`) | **80 characters** |
| Full description (`Full description`) | **4000 characters** |
| Release notes / "What's new" | **500 characters** |

Count characters (not bytes); accents count as one character.

## Language → Play Store locale tag mapping

Wrap each language block in the Play Console locale code:

| App code | Language | Play Store locale tag |
|----------|----------|-----------------------|
| `ca` | Catalan | `ca` |
| `es` | Spanish | `es-ES` |
| `eu` | Basque | `eu-ES` |
| `en` | English | `en-GB` |
| `de` | German | `de-DE` |
| `it` | Italian | `it-IT` |
| `fr` | French | `fr-FR` |

If a new language is added to `translations.js`, add its Play Store locale tag
here and generate a matching block.

## Output format

Produce (or update) the file [`store/play-store-listings.md`](../../../store/play-store-listings.md).
For **each** supported language, emit a block using the locale tag, in this exact
shape:

```
<es-ES>
Title: <= 30 chars
Short description: <= 80 chars
Full description:
<multi-line, <= 4000 chars>
</es-ES>
```

Order the blocks with the app's default/fallback language first (`en`), then the
rest. Keep the structure and feature bullets consistent across languages; only the
prose is translated — do not add or drop features between languages.

### Release notes ("What's new")

When a release also needs "What's new" text, produce (or update) the file
`store/release-notes-<version>.md` (e.g. `store/release-notes-1.0.0.md`), one
locale block per language, each **≤ 500 characters**:

```
<es-ES>
<short changelog, <= 500 chars>
</es-ES>
```

Derive the version from `src/brand/brand.config.js` (`version`). Base the content
on the git history since the previous tag (`git log <prev-tag>..HEAD`); for the
first release, summarise the headline features instead of a diff.

## Workflow

1. Read `src/i18n/translations.js` and confirm the current list of language codes.
2. Read `src/brand/brand.config.js` for the app name and support URL.
3. Read `README.md` for the up‑to‑date feature set and value proposition.
4. For each language:
   - Write a **Title** (≤30). Prefer the brand `appName`; only add a tagline if it
     still fits in 30 characters.
   - Write a **Short description** (≤80) summarising the core benefit
     (synchronised second‑screen audio/video with an HbbTV TV).
   - Write a **Full description** (≤4000) with: one‑line hook, a "KEY FEATURES"
     bullet list, a "HOW IT WORKS" numbered list, the open‑source/community note,
     and a compatibility requirement note.
   - Translate natively — do not machine‑translate technical terms like *HbbTV*,
     *DVB‑CSS*, *DIAL*, *MediaSync*, *Wi‑Fi* (keep them as‑is).
5. Verify every field is within its character limit before writing the file.
6. Write the blocks to `store/play-store-listings.md`, wrapped in the locale tags.

## Verification checklist

- [ ] One block per language in `translations.js` (no missing, no extra).
- [ ] Each Title ≤ 30, Short ≤ 80, Full ≤ 4000 characters.
- [ ] Locale tags match the mapping table.
- [ ] Feature set matches README / current app behaviour.
- [ ] Technical terms kept untranslated and spelled consistently.
