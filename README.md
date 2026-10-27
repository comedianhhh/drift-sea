# Drift Sea

A shared pixel aquarium. Every visitor's sentence becomes a real ocean species that swims in the sea for everyone to see.
Click a creature to read its sentence, learn about the species (with its IUCN Red List status), and add it to your field guide.

Live at https://drift-sea.pages.dev

## How it works

- `public/index.html` — the whole front end: three.js (r128) low-poly creatures and seabed, rendered into pixel tiles by a post-process shader.
- `functions/api/fish.js` — `GET` lists creatures, `POST` releases one (length check, link/phone filter, 15 s cooldown, 30 per day).
- `functions/api/report.js` — one report per person per creature; 3 reports take it out of the sea.
- `lib/moderation.js` — refused patterns; extra words via the `BLOCKED_WORDS` variable (comma-separated).
- `schema.sql` — the Cloudflare D1 tables.

## Run locally

```bash
npm install
npm run db:local
npm run dev
```

Then open http://127.0.0.1:8788.

## Deploy

```bash
npx wrangler pages deploy --branch=main
```

Schema changes go to the live database with `npm run db:remote`.
