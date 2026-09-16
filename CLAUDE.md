# asnimansari.dev

Personal site built with [Zola](https://www.getzola.org/) and the [serene](https://github.com/isunjn/serene) theme (git submodule at `themes/serene`).

## Content writing style

- Never use em dashes (`—`) anywhere on this site. Use a period, comma, or colon instead. Em dashes are a strong tell of AI-written text, and content on this site should read like it wasn't generated.
- This applies to all prose: posts, notes, the resume, the home page bio, and blurbs/subtitles in any `content/**/*.toml` collection (books, bookmarks, projects, experience, etc.). Code comments and code blocks are exempt.

## Content monitoring

Before finishing any task that adds or edits content under `content/`, run:

```
grep -rn "—" content/
```

If it finds anything outside a fenced code block, rewrite that content to remove the em dash and re-run the check. Treat a clean grep as a required step, not an optional one, the writing-style rule above is not self-enforcing and has been violated by default before.

## Git commits

- Do not add a `Co-Authored-By: Claude` line (or any AI attribution line) to commit messages or PR descriptions in this repo. This overrides Claude Code's default attribution behavior for this project.
