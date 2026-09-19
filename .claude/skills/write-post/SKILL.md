---
name: write-post
description: Write a new blog post for this site's Posts section, plus a three-part LinkedIn series built from the same post for posting on different days. Use when the user asks to write/draft/create a blog post or article, e.g. "write a post about X", "turn these notes into a blog", "draft a blog on the bug we fixed", or asks for LinkedIn posts from a blog post. If they only want the LinkedIn series for a post that already exists, skip to step 6.
---

# Write a blog post and its LinkedIn series

Posts live in `content/posts/` as one Markdown file each. The section is
sorted by date and rendered with `post.html`. A post's URL is
`https://asnimansari.dev/posts/<slug>/`, where `<slug>` is the filename
without `.md`.

Each post gets a companion LinkedIn series at `linkedin/<slug>.md` in the
repo root. Zola only builds `content/`, `templates/`, `static/`, `sass/` and
`themes/`, so this folder is never published to the site.

## The voice

Read both existing posts in `content/posts/` before writing. They set the
voice, and a new post should read like the same person wrote it:

- First person, "I" or "we" (use "we" for work done with a team). Plain,
  direct sentences. No throat-clearing opener, no "In this post, we'll
  explore".
- Open on the concrete situation, then say in one short paragraph what the
  post covers.
- Specifics over adjectives: real numbers, real error text, real code
  reduced to its shape. If the user didn't give a number, ask for it or
  leave it out. Never make one up.
- `##` sections with plain, descriptive headings ("The bug", "Why not
  `Vec<T>` plus a check"). Code in fenced blocks with a language tag.
- Close with the takeaways as short paragraphs, each led by a **bold
  sentence**, not a bulleted list of platitudes.
- Wrap prose at about 78 columns, like the existing files.

Avoid the tells of generated text: em dashes (banned outright, see
`CLAUDE.md`), "delve", "leverage", "robust", "seamless", "game-changer",
"it's worth noting", "in today's fast-paced world", "let's dive in",
rhetorical questions as section openers, triplets of adjectives, and a
closing paragraph that restates the whole post.

## Workflow

1. **Gather the material.** The user supplies a topic, and usually notes,
   code, a PR, a bug, or a rough draft. The post has to be built from what
   they actually did and learned, so if what they gave is just a topic,
   ask for the specifics before writing: what happened, what they tried,
   what they measured, what they'd tell someone else. Read any files, diffs,
   or links they point at. Don't pad thin material into a long post. A
   short post with real content beats a long one with filler.

2. **Get the date and pick the slug.** Always take the date from the system:

   ```
   date +%Y-%m-%d
   ```

   The slug is the title lowercased, punctuation dropped, spaces as hyphens
   (`the-middleware-that-authenticated-nothing`). Trim it if the title is
   long. Check `content/posts/<slug>.md` doesn't already exist.

3. **Write the post** to `content/posts/<slug>.md`:

   ```toml
   +++
   title = "Sentence case title"
   description = "One or two sentences on what the post is about. Used for the listing and link previews."
   date = 2026-09-18
   draft = true

   [taxonomies]
   tags = ["rust", "backend"]

   [extra]
   lang = "en"
   +++
   ```

   - Tags are lowercase and hyphenated. Reuse existing tags where they fit,
     list them with `grep -h "^tags" content/posts/*.md`.
   - Always start with `draft = true`. Pushing to `master` deploys the site,
     so the post stays out of the build until the user reads it and says
     it's ready. Then remove the `draft` line.
   - Images go in `static/img/` and are referenced as `/img/<name>`.

4. **Show the user the draft** and revise until they're happy with it. Get
   the post settled before writing the LinkedIn series, since the series is
   cut from the final text.

5. **Verify the build.** From the project root:

   ```
   zola build --drafts
   ```

   It must succeed and `public/posts/<slug>/index.html` must exist. Then
   `rm -rf public`, build output is not committed.

6. **Write the LinkedIn series** to `linkedin/<slug>.md`. Three posts, each
   meant to go out on a different day, cut from the blog post rather than
   written from scratch:

   - **Part 1, the hook.** The problem or situation and why it matters.
     End on the open question the rest of the series answers.
   - **Part 2, the substance.** The core idea, fix, or finding. The one
     thing a reader should walk away with even if they never click through.
   - **Part 3, the lessons.** The takeaways, and the link to the full post.

   Rules for every part:

   - **Stands on its own.** Most readers will only ever see one part. Open
     each with a line of context, not "Continuing from yesterday". A short
     marker like "(2/3)" at the end is fine.
   - **Hook in the first two lines.** LinkedIn cuts the post off at "see
     more" after roughly 140 characters on mobile. That opening has to make
     someone tap.
   - **Plain text.** LinkedIn doesn't render Markdown: no `**bold**`, no
     `#` headings, no fenced code. Use short paragraphs with a blank line
     between them. A tiny code snippet can go in as plain indented lines,
     or leave code out and describe it.
   - **Length.** Aim for 800 to 1,500 characters. The hard limit is 3,000.
   - **Same voice as the blog.** No emoji bullet lists, no "Let that sink
     in", no "Agree?" engagement bait, no em dashes.
   - **Hashtags.** Three to five relevant ones on the last line, taken from
     the post's tags (`#rust #backend`).
   - **The link.** Put the post URL in part 3 only. LinkedIn tends to show
     posts with outbound links to fewer people, so also give a first-comment
     version: part 3 without the link, plus a one-line comment carrying it.
     The user picks which to use.

   Suggest dates two to three days apart, weekdays only, starting on or
   after the day the post goes live. Use this file layout:

   ```markdown
   # LinkedIn series: <post title>

   Post: https://asnimansari.dev/posts/<slug>/

   ## Part 1 (suggested: Tue 2026-09-22)

   <text>

   ## Part 2 (suggested: Thu 2026-09-24)

   <text>

   ## Part 3 (suggested: Mon 2026-09-28)

   <text, with the link>

   ### First-comment option

   Post text: <part 3 without the link>

   Comment: <one line with the link>
   ```

   Count each part's characters and make sure none is over 3,000:

   ```
   awk '/^## Part/{if(p)print "Part "k": "n; k++; p=1; n=0; next} /^### /{if(p)print "Part "k": "n; p=0; next} p{n+=length()+1} END{if(p)print "Part "k": "n}' linkedin/<slug>.md
   ```

   (Keep dollar-digit sequences out of this file. The skill loader treats
   them as argument placeholders and substitutes the user's words into
   them.)

7. **Run the em dash check.** `CLAUDE.md` requires it after any content
   edit, and the LinkedIn text is covered by the same rule:

   ```
   grep -rn "—" content/ linkedin/
   ```

   Anything outside a fenced code block must be rewritten, then run the
   check again until it comes back clean.

8. **Report** the post path and its future URL, that it's still marked
   `draft = true`, the LinkedIn file path with each part's suggested date
   and character count, and any facts you left out or need the user to
   confirm.
