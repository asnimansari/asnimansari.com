---
title: "When a team adopts Rust, onboard the reviewers first"
description: "The people who need ramping up when a team picks up Rust are usually the reviewers, not the authors. A checklist for a Go engineer's first Rust review, and what to let slide early on."
date: 2026-09-28
tags: ["rust", "backend"]
draft: true
---

When a team adopts Rust, the people who need onboarding first are often the
reviewers, not the authors. A new author gets a compiler standing over their
shoulder on every line. A new reviewer gets a green checkmark and a diff, and
has to decide, without the compiler's help, whether the code is actually
good.

That's a real gap on a team coming from Go. Go's review culture is mostly
about naming, structure, and whether the error handling is honest. Rust asks
those same questions, plus a set that a Go reviewer has no instinct for yet,
because Go's compiler never made them ask.

## Why Rust review is different

In Go, a function signature tells you the types going in and out. In Rust it
tells you more than that, and a reviewer who skips past it is skipping the
part of the diff that says the most.

**Lifetimes in signatures are part of the API, not noise to skim past.**

```rust
fn find_active<'a>(users: &'a [User], id: UserId) -> Option<&'a User> {
    users.iter().find(|u| u.id == id)
}
```

A Go reviewer's eye slides right over the `'a`. But that signature is a
promise: the returned reference is only valid as long as `users` is. If a
later diff changes this to return something borrowed from a temporary, or
tries to stash the result somewhere that outlives `users`, the compiler will
stop it, but only if the lifetime was chosen correctly here. A reviewer's job
is to ask "does this function actually need to borrow, or would returning an
owned value make the contract simpler for every caller," not to nod at the
tick mark and move on.

**`.clone()` reads as a shrug, and a reviewer has to figure out whether it's
a shrug or a decision.**

```rust
fn process(order: Order) -> Summary {
    let items = order.items.clone(); // needed here, or a workaround?
    summarize(&items, &order)
}
```

Our rule is simple: clone when the value genuinely needs to live in two
places at once, and never as a way to make a borrow-checker error go away
without understanding why it fired. Those look identical in a diff, a
`.clone()` call sitting quietly on its own line, so the review has to ask the
author, not assume. A reviewer coming from Go doesn't have the reflex to ask
that question yet, because Go doesn't have an error that a stray `.clone()`
can silence.

**Prefer a smart pointer over a clone when the value needs to be shared, not
duplicated.**

```rust
// duplicates the data
struct Cache {
    entries: Vec<Entry>,
}
fn snapshot(cache: &Cache) -> Vec<Entry> {
    cache.entries.clone()
}

// shares it
struct Cache {
    entries: Arc<Vec<Entry>>,
}
fn snapshot(cache: &Cache) -> Arc<Vec<Entry>> {
    Arc::clone(&cache.entries)
}
```

Both compile. Both are called `.clone()` in the diff, which is exactly the
trap: an `Arc::clone` is a refcount bump, a `Vec<Entry>::clone` is a full
copy, and they read the same at a glance. Once a value is genuinely shared
across threads or owners, wrapping it in `Arc` (or `Rc` for single-threaded
code) and cloning the pointer is usually the right call over cloning the
data underneath it.

**`unwrap()` policy needs to be explicit, because Rust makes panicking easy
and silent.**

We allow `unwrap()` in tests, where a panic is the correct failure mode and
the message points straight at the assertion that broke. Outside tests, it's
a request for a reason: is this actually infallible (`"1970-01-01".parse()`
on a string literal you just wrote), or is it a network call, a file read, a
lock, something that fails in production on a bad day and takes the process
down with it. The second case wants a `Result` and a real error, not a
one-word admission that the author didn't want to think about the failure
path yet.

## A checklist for a Go engineer's first Rust review

Handed to someone reviewing their first Rust PR, coming from Go:

- **Read the signature before the body.** Owned vs. borrowed
  (`String` vs `&str`, `Vec<T>` vs `&[T]`), and any lifetime parameter, tells
  you what the function promises. Go signatures don't carry this much
  information; Rust ones do, so read them like they do.
- **Every `.clone()` gets a one-second "why."** Sharing a value across two
  owners, or working around ownership because rewriting the flow would cost
  more than the copy, are both fine answers. "It made the error go away" is
  not.
- **Check whether a clone should have been an `Arc`/`Rc` instead.** If the
  same data is being read from more than one place, ask whether the code
  wants a shared pointer rather than repeated copies.
- **`unwrap()` outside of tests needs a comment or a `Result`.** If the value
  really can't fail, say so in a comment next to it. If it can, it should be
  propagated with `?`, not swallowed.
- **`unwrap_or_default()` can hide a bug as easily as `unwrap()` can panic
  one.** Ask what the default actually means for that field, not just
  whether it compiles.
- **Match arms and `if let` chains: is a case being silently dropped?** Go's
  `if err != nil` is loud by habit. Rust's pattern matching can make an
  unhandled case look like it was considered when it wasn't, especially
  behind a wildcard `_ =>`.
- **Don't block on style the linter already owns.** If `clippy` and `rustfmt`
  pass, formatting and idiom nitpicks belong in a follow-up comment, not a
  blocking review round.

## What to let slide early on

Not everything on that list is worth holding a line on in someone's first
month. A few things we stopped blocking merges over, on purpose:

Iterator chains versus a plain `for` loop. A new Rust author reaching for a
loop because that's what they know is not a bug, and rewriting their
straightforward loop into a `.iter().filter().map().collect()` chain in
review teaches them nothing except that their first instinct was wrong. Let
it ship, and let the idiom show up in later PRs once they've read enough of
it.

Choosing `From` over `TryFrom`, or the reverse, on a conversion that could
honestly go either way. This is a real design question, but it's not one a
first-week reviewer needs to relitigate on every PR, and blocking on it reads
as pedantry rather than teaching.

Slightly verbose error types. A `MyError` enum with more variants than it
strictly needs is easy to consolidate later and costs nothing to leave alone
now. A missing error path, or one collapsed into a string when the caller
needs to match on it, is the version of this that's actually worth stopping
for.

The goal in the first month is to keep someone in the loop long enough to
build the instincts above, not to get every PR to the version an experienced
Rust reviewer would have written themselves.
