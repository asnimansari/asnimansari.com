---
name: add-bookmark
description: Add a URL to this site's Bookmarks page. Use when the user asks to bookmark/save/add a link to the blog, e.g. "bookmark this url", "add this link to bookmarks", or pastes a URL and asks to save it.
---

# Add a bookmark to the Bookmarks page

This site's Bookmarks page is `content/bookmarks/_index.md` (a `prose.html`
page that renders a `collection` component) backed by
`content/bookmarks/bookmarks.toml` (`layout = "row"`, `flow = "stack"`). Each
entry looks like:

```toml
[[item]]
title = "Site or Article Name"
link = "https://..."
badge = "category"   # short one-word-ish category tag
```

No `subtitle`, entries on this page are just a title, a link, and a badge
(this project's convention, established explicitly).

## Workflow

1. **Resolve the URL.** The user gives a URL, sometimes with a short note on
   why they're saving it.
   - `WebFetch` the URL to get the page/site title, mainly to write a good
     `title` and pick an accurate `badge`.
   - If the fetch fails or the site blocks scripted requests, fall back to
     the URL's hostname as the title. Don't block on a failed fetch.

2. **Write the title.** Prefer the site or publication name over a full page
   title for a homepage/blog-root bookmark (matches the existing entries:
   "fasterthanli.me", "Dan Luu", "Tokio Blog"). Use the article title if the
   user is bookmarking one specific post rather than a whole site.

3. **Pick a `badge`.** A short category matching the style of existing
   entries (`"blog"`, `"research"`, `"rust"`, `"systems"`, `"essay"`, etc.).
   Reuse an existing badge from `bookmarks.toml` when the link fits one of
   those categories rather than inventing a near-duplicate.

4. **Prepend the entry.** Read `content/bookmarks/bookmarks.toml`, add the
   new `[[item]]` block right after the `layout`/`flow` header, before all
   existing entries. The list is newest-first, so the most recently added
   link is always on top. Keep existing entries untouched otherwise.

5. **Verify.** Run `zola build` from the project root, confirm it succeeds
   and the new title appears in `public/bookmarks/index.html`, then
   `rm -rf public` (build output isn't committed).

6. **Report** the title and badge added, and note if the fetch was blocked
   and the title had to fall back to the hostname.
