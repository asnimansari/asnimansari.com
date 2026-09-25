# asnimansari.dev

Personal site built with [Astro](https://astro.build/) as a fully static build (`npm run build` outputs to `dist/`). Deployed to GitHub Pages from `master` by `.github/workflows/deploy.yml`.

## Layout

- `src/content/posts/*.md`: blog posts (YAML front matter, see the `write-post` skill). Slug is the filename, URL is `/posts/<slug>/`.
- `src/content/data/*.toml`: `[[item]]` lists for books, bookmarks, and the resume sections (experience, projects, education). Newest entries go at the top. Schemas live in `src/content.config.ts`.
- `src/content/notes/`: unpublished notes, no route.
- `src/pages/`: routes. `index.astro` is the animated landing page (styles in `src/styles/landing.css`, script in `src/scripts/landing.js`). The other pages use `src/layouts/Base.astro` and `src/styles/global.css`.
- `src/consts.ts`: site name, bio, nav, social links.
- `public/`: static files copied as is (`CNAME`, `robots.txt`, `img/`).
- URLs and the Atom feed (`/posts/feed.xml`) are kept identical to the old Zola site, so don't rename routes.

## Commands

- `npm run dev`: dev server (shows drafts).
- `npm run build`: type check plus static build into `dist/`. `dist/` is not committed.
- `npm run preview`: serve `dist/`.

## Content writing style

- Never use em dashes (`—`) anywhere on this site. Use a period, comma, or colon instead. Em dashes are a strong tell of AI-written text, and content on this site should read like it wasn't generated.
- This applies to all prose: posts, notes, the resume, the home page bio, and blurbs/subtitles in any `src/content/data/*.toml` file (books, bookmarks, projects, experience, etc.), plus strings in `src/consts.ts` and `src/pages/`. Code comments and code blocks are exempt.

## Content monitoring

Before finishing any task that adds or edits content under `src/content/` (or prose in `src/pages/` or `src/consts.ts`), run:

```
grep -rn "—" src/
```

If it finds anything outside a fenced code block, rewrite that content to remove the em dash and re-run the check. Treat a clean grep as a required step, not an optional one, the writing-style rule above is not self-enforcing and has been violated by default before.

## Git commits

- Do not add a `Co-Authored-By: Claude` line (or any AI attribution line) to commit messages or PR descriptions in this repo. This overrides Claude Code's default attribution behavior for this project.
