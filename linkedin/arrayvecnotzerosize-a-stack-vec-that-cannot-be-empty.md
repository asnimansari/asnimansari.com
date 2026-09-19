# LinkedIn series: ArrayVecNotZeroSize: a stack-allocated collection that can't be empty

Post: https://asnimansari.dev/posts/arrayvecnotzerosize-a-stack-vec-that-cannot-be-empty/

## Part 1 (suggested: Mon 2026-09-21)

Every function that takes a Vec<Leg> has to decide what an empty one means.

In my code, an empty one is never valid. A multi-leg order needs at least one leg. A batch job needs at least one item. But Vec<T> is happy to hold zero, so every function that receives one either checks, or trusts that whoever built the value upstream remembered to.

The usual fix is a guard clause:

    if legs.is_empty() {
        return Err(...);
    }

That works right up until the fortieth call site, when somebody adds a forty-first without it. The type system gives no help. A Vec<Leg> with zero elements and one with three type-check identically.

There was a second problem. These lists are small, bounded, and sit on a hot path. Vec<T> means a heap allocation and a pointer chase for something that could live on the stack.

So I tried a fixed array, [T; N]. It has no idea which slots are in use, so you either track a length yourself and treat the tail as uninitialized, or fill every unused slot with a default value. That meant a T: Default bound on every element type. A leg in an options order has no sensible default. There's no such thing as a null instrument.

That bound was the tell that the array was the wrong tool.

What I wanted was a collection that lives on the stack and can't represent "empty" at all. Next post: how I built it.

(1/3)

#rust #rustlang #typesafety #backend

## Part 2 (suggested: Wed 2026-09-23)

If a function returns Option<&T>, the caller has to handle None. If it returns &T, the caller doesn't.

That's the point of a small Rust type I wrote, ArrayVecNotZeroSize<T, N>: a stack-allocated collection that is guaranteed to hold at least one element.

Underneath it's arrayvec's ArrayVec<T, N>. Fixed capacity, lives on the stack, tracks its own length, no Default bound. But an empty ArrayVec is perfectly valid, so the non-empty guarantee is a newtype on top. What makes it work is which methods exist, and which don't.

new(first: T) is infallible. It takes the guaranteed element as an argument, so there's nothing to reject.

first() returns &T, not Option<&T>. No more .first().expect("non-empty").

try_push can only fail one way, by running out of capacity. The lower bound was settled at construction.

There is no pop, remove, truncate, clear, or swap_remove. You can grow one, but you can't shrink it back to zero through its own API. If you really need to, into_inner() hands back the plain ArrayVec. Giving up the invariant is something you ask for by name.

Deserialize goes through the same TryFrom<Vec<T>> check as construction. A message arriving with "legs": [] fails right where it's decoded, instead of becoming an empty list that travels three functions deeper before anything notices.

(2/3)

#rust #rustlang #typesafety #backend

## Part 3 (suggested: Fri 2026-09-25)

The "is this list empty?" check used to live in every function that received the list. Now it lives in one place.

I wrote a small Rust type, ArrayVecNotZeroSize<T, N>, a stack-allocated collection that can't be empty. What I took away from building it:

A guarantee rarely lives in one function. Here it takes four things together: a constructor that can't produce an empty value, two fallible ones that reject it, a Deserialize impl that reuses those instead of inventing its own rules, and a mutation API with every emptying method missing. Take away any one and there's a gap.

Some invariants are enforced by omission. The most important part of this API is the methods it doesn't have.

A safety property that depends on every call site remembering to ask isn't a safety property. It's a hope. Move the question into the type and it gets asked once, at the one place that can answer it.

Keep the invariant on your side of the wire. The type serializes as a plain array, so nothing consuming the data needs to know it exists.

The full walkthrough, with the complete source:
https://asnimansari.dev/posts/arrayvecnotzerosize-a-stack-vec-that-cannot-be-empty/

(3/3)

#rust #rustlang #typesafety #backend

### First-comment option

Post text:

The "is this list empty?" check used to live in every function that received the list. Now it lives in one place.

I wrote a small Rust type, ArrayVecNotZeroSize<T, N>, a stack-allocated collection that can't be empty. What I took away from building it:

A guarantee rarely lives in one function. Here it takes four things together: a constructor that can't produce an empty value, two fallible ones that reject it, a Deserialize impl that reuses those instead of inventing its own rules, and a mutation API with every emptying method missing. Take away any one and there's a gap.

Some invariants are enforced by omission. The most important part of this API is the methods it doesn't have.

A safety property that depends on every call site remembering to ask isn't a safety property. It's a hope. Move the question into the type and it gets asked once, at the one place that can answer it.

Keep the invariant on your side of the wire. The type serializes as a plain array, so nothing consuming the data needs to know it exists.

Full walkthrough and source in the first comment.

(3/3)

#rust #rustlang #typesafety #backend

Comment:

Full post, with the complete source: https://asnimansari.dev/posts/arrayvecnotzerosize-a-stack-vec-that-cannot-be-empty/
