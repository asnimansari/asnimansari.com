---
name: add-book
description: Find a book on the internet by title, author, or a Goodreads/Open Library link, and add it to this site's Books page. Use when the user asks to add/find/look up a book for the blog, e.g. "add book <title>", "find this book and add it to the site", or pastes a Goodreads/Open Library link and asks to add it as a book.
---

# Add a book to the Books page

This site's Books page is `content/books/_index.md` (a `prose.html` page that
renders a `collection` component) backed by `content/books/books.toml`
(`layout = "card"`, `flow = "stack"`). Each entry looks like:

```toml
[[item]]
title = "Book Title"
subtitle = "Author Name"
content = "One or two sentence blurb. No em dashes."
image = "https://..."     # direct hyperlink to the cover, not a local file
link = "https://..."      # Goodreads or Open Library page for the book
badge = "fiction"          # short genre/category tag
tags = ["fiction"]
```

## Workflow

1. **Resolve the book.** The user gives either a title/author, or a
   Goodreads/Open Library URL.
   - If given a URL, try `WebFetch` on it directly to pull title, author, and
     a one-sentence description.
   - Goodreads frequently blocks scripted requests with an AWS WAF challenge
     (a 202 response with an empty body, both via `WebFetch` and `curl`).
     When that happens, don't fight it — fall back to the Open Library search
     API instead:
     ```
     curl -s "https://openlibrary.org/search.json?q=<title>+<author>&fields=title,author_name,cover_i,first_publish_year&limit=5"
     ```
     Pick the best-matching result.

2. **Get the cover image URL.** From Open Library's `cover_i`:
   ```
   https://covers.openlibrary.org/b/id/<cover_i>-L.jpg
   ```
   This is a stable, public hotlinking API, verify it resolves with
   `curl -sI` before using it (expect a `302` to an archive.org asset, that's
   fine). **Always use the direct external URL for `image`** (this project's
   convention, established explicitly), never download the cover into
   `static/`.

   If neither source has a usable cover, omit the `image` field entirely
   rather than link something broken — every collection field except `title`
   is optional.

3. **Write the blurb.** One or two sentences in `content`, in your own words:
   what the book is, or what's notable about it. Follow this repo's
   `CLAUDE.md` rule: **no em dashes**, use a period, comma, or colon instead.

4. **Pick `badge` and `tags`.** A short genre/category string (`"fiction"`,
   `"memoir"`, `"non-fiction"`, `"business"`, `"sre"`, etc.), matching the
   style of existing entries in `books.toml`.

5. **Prepend the entry.** Read `content/books/books.toml`, add the new
   `[[item]]` block right after the `layout`/`flow` header, before all
   existing entries. The list is newest-first, so the most recently added
   book is always on top. Keep existing entries untouched otherwise.

6. **Verify.** Run `zola build` from the project root, confirm it succeeds
   and the new title appears in `public/books/index.html`, then
   `rm -rf public` (build output isn't committed).

7. **Report** the title/author added and the cover source used (Open Library
   vs. the original site), so the user can swap it if they'd rather have a
   different edition's cover.
