+++
title = "ArrayVecNotZeroSize: a stack-allocated collection that can't be empty"
description = "A small Rust wrapper around arrayvec's ArrayVec that pushes the non-empty invariant into the type itself, enforced at construction and at deserialization, with no way to mutate it back to zero."
date = 2025-09-17

[taxonomies]
tags = ["rust", "type-safety", "backend"]

[extra]
lang = "en"
+++

Some collections in a codebase are never legitimately empty. A multi-leg
order needs at least one leg. A batch job needs at least one item to do
anything with. The type most of us reach for anyway is `Vec<T>`, which is
happy to hold zero elements, so every function that receives one has to
decide what "zero" means and check for it, or trust that whoever built the
value upstream remembered to.

I got tired of writing that check, so I wrote a type where it can't come up.

## Why not `Vec<T>` plus a check

The obvious fix is a guard clause at the boundary:

```rust
if legs.is_empty() {
    return Err(AppError::invalid("order must have at least one leg"));
}
```

This works, right up until it's the fortieth call site and somebody adds a
forty-first without it. Every place that receives the collection has to
remember to ask the same question, and the type system gives no help: a
`Vec<Leg>` with zero elements and a `Vec<Leg>` with three both type-check
identically. Nothing distinguishes "empty because that's a valid state" from
"empty because a bug produced it" until you're already deep inside a
function that assumed otherwise.

There's a second problem specific to the systems I actually write this for:
`Vec<T>` is a heap allocation. For a leg list that's bounded, small, and sits
on a hot path, that's an allocation and a pointer chase for something that
could live entirely on the stack.

## Why not a fixed-size array

The stack-allocated alternative to `Vec<T>` is `[T; N]`, and I tried that
first. It doesn't work for a collection whose real length varies from 1 up
to N, because a fixed array has no concept of "used" versus "unused" slots.
You either track a separate length counter next to it and treat the tail as
uninitialized (unsafe, and easy to get wrong), or you pre-fill every unused
slot with something, which means every element type needs a `Default` impl
whether or not a sensible default value actually exists for it. A leg in an
options order doesn't have a default; there's no such thing as a null
instrument.

That `T: Default` bound was the tell that the fixed array was the wrong
tool. It was solving "how do I avoid the heap" by introducing a constraint
that had nothing to do with the actual problem.

## `ArrayVec<T, N>` gets the storage right

[`arrayvec`](https://docs.rs/arrayvec)'s `ArrayVec<T, N>` is the type I
actually wanted underneath: stack-allocated, a fixed maximum capacity `N`,
and it tracks its real length internally instead of requiring every slot to
be initialized up front. No `Default` bound anywhere.

It still doesn't solve the original problem, though. An `ArrayVec<T, N>`
with zero elements is completely valid, so it's exactly as capable of being
accidentally empty as a `Vec<T>` was, just without the heap allocation. The
non-empty guarantee has to be a separate layer on top.

## `ArrayVecNotZeroSize<T, N>`

That layer is a newtype: `ArrayVecNotZeroSize<T, N>`, an `ArrayVec<T, N>` that is
guaranteed, by construction, to hold at least one element.

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ArrayVecNotZeroSize<T, const N: usize>(ArrayVec<T, N>);

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ArrayVecNotZeroSizeError {
    #[error("expected at least one element, got empty array")]
    Empty,
    #[error("expected at most {capacity} elements, got {actual}")]
    Overflow { capacity: usize, actual: usize },
}
```

The interesting part isn't the struct. It's which functions exist on it, and
just as much, which ones don't.

## Walking through the API

**`new(first: T)` is infallible on purpose.** It's the one constructor that
takes the guaranteed element as a required argument instead of a collection
to validate, so there's nothing to reject:

```rust
pub fn new(first: T) -> Self {
    let mut av = ArrayVec::new();
    av.push(first);
    Self(av)
}
```

**`first()` returns `&T`, not `Option<&T>`.** This is the actual point of
the type. Every caller that used to write `.first().expect("non-empty")`, or
worse, forgot to, now calls a function whose signature already tells them
the answer exists.

**`is_empty()` always returns `false`.** It does no work. It's there so code
written against the usual collection shape, which calls `.is_empty()`
reflexively, still compiles and gets a literal `false` instead of a missing
method.

**`try_push` is fallible in exactly one direction.** The upper bound (`N`)
is the only one a push can violate, since the lower bound was settled at
construction. So the only way it fails is running out of capacity:

```rust
pub fn try_push(&mut self, value: T) -> Result<(), T> {
    self.0.try_push(value).map_err(|e| e.element())
}
```

**There is no `pop`, `remove`, `truncate`, `clear`, or `swap_remove`.** This
is the part that actually enforces the invariant after construction, and
it's enforced by omission: none of `ArrayVec`'s element-removing methods are
exposed on the wrapper. You can grow an `ArrayVecNotZeroSize`, but you
cannot shrink one back to zero through its own API. If you need to remove
elements, `into_inner()` hands back the plain `ArrayVec`. Giving up the
invariant is something a caller asks for by name, not something that happens
to them.

**`Deref<Target = [T]>` for reads.** Iteration, indexing, `.contains()`,
`.iter().sum()`, the whole slice API, for free instead of re-implementing it
on the wrapper. Reads can't threaten the invariant, so they're unrestricted;
anything that changes the collection goes through a method written with the
invariant in mind.

**`TryFrom<ArrayVec<T, N>>` and `TryFrom<Vec<T>>`.** These are the two
shapes a real call site actually has lying around: something already backed
by a fixed-capacity buffer, or the result of collecting an iterator. Both
fail closed:

```rust
impl<T, const N: usize> TryFrom<Vec<T>> for ArrayVecNotZeroSize<T, N> {
    type Error = ArrayVecNotZeroSizeError;

    fn try_from(vec: Vec<T>) -> Result<Self, Self::Error> {
        if vec.is_empty() {
            return Err(ArrayVecNotZeroSizeError::Empty);
        }
        if vec.len() > N {
            return Err(ArrayVecNotZeroSizeError::Overflow { capacity: N, actual: vec.len() });
        }
        let mut av = ArrayVec::new();
        for item in vec {
            av.push(item);
        }
        Ok(Self(av))
    }
}
```

**`Deserialize` routes through that same `TryFrom<Vec<T>>`.** This is the
boundary that actually matters most in practice, because it's the one a
caller doesn't get to skip. A message coming off the wire with `"legs": []`
never becomes a live `ArrayVecNotZeroSize` at all; it fails right where it's decoded,
with a real error, instead of turning into an empty collection that gets
passed three functions deeper before something notices:

```rust
impl<'de, T: Deserialize<'de>, const N: usize> Deserialize<'de> for ArrayVecNotZeroSize<T, N> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let vec = Vec::<T>::deserialize(deserializer)?;
        Self::try_from(vec).map_err(serde::de::Error::custom)
    }
}
```

Construction and deserialization are deliberately the same code path: one
place decides whether a collection of unknown size is allowed to become an
`ArrayVecNotZeroSize`, and every entry point funnels through it.

**`Serialize` delegates straight to the inner `ArrayVec`.** On the wire, an
`ArrayVecNotZeroSize` is indistinguishable from a plain array. The invariant is a
guarantee this side of the process holds about the data; it isn't a schema
change the other side needs to know about.

**`From<ArrayVecNotZeroSize<T, N>> for ArrayVec<T, N>`, the mirror of
`TryFrom`.** Widening from "at least one" to "at least zero" can't fail, so
it isn't a `Result`, and code handing the value back to the unconstrained
type never eats an unwrap that could only ever be `Ok`.

## Where the guarantee actually lives

Not in one function. It's an infallible constructor that can't produce an
empty value, two fallible ones that reject it, a `Deserialize` impl that
reuses those same fallible constructors instead of inventing its own rules,
and a mutation API with every emptying method missing. Any one alone leaves
a gap. Together, the only way to hold an `ArrayVecNotZeroSize` is to have
passed a check, and nothing on the type can undo it afterward.

That's the same shape of fix I keep coming back to: a safety property that
depends on every call site remembering to ask "is this empty?" isn't a
safety property, it's a hope. Moving the question into the type means it
only gets asked once, at the one place that can actually answer it, and
every caller after that just gets to be right.

## Full source

Everything above, in one file, minus the tests:

```rust
use arrayvec::ArrayVec;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ArrayVecNotZeroSize<T, const N: usize>(ArrayVec<T, N>);

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ArrayVecNotZeroSizeError {
    #[error("expected at least one element, got empty array")]
    Empty,
    #[error("expected at most {capacity} elements, got {actual}")]
    Overflow { capacity: usize, actual: usize },
}

impl<T, const N: usize> ArrayVecNotZeroSize<T, N> {
    /// Create with a single element. Infallible.
    pub fn new(first: T) -> Self {
        let mut av = ArrayVec::new();
        av.push(first);
        Self(av)
    }

    /// Returns a reference to the first element. Always succeeds.
    pub fn first(&self) -> &T {
        &self.0[0]
    }

    /// Returns the number of elements. Always `>= 1`.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Always returns `false`.
    pub fn is_empty(&self) -> bool {
        false
    }

    /// Appends an element. Returns `Err(value)` if at capacity.
    pub fn try_push(&mut self, value: T) -> Result<(), T> {
        self.0.try_push(value).map_err(|e| e.element())
    }

    /// Consumes `self` and returns the inner `ArrayVec`.
    pub fn into_inner(self) -> ArrayVec<T, N> {
        self.0
    }
}

impl<T, const N: usize> TryFrom<ArrayVec<T, N>> for ArrayVecNotZeroSize<T, N> {
    type Error = ArrayVecNotZeroSizeError;

    fn try_from(av: ArrayVec<T, N>) -> Result<Self, Self::Error> {
        if av.is_empty() {
            Err(ArrayVecNotZeroSizeError::Empty)
        } else {
            Ok(Self(av))
        }
    }
}

impl<T, const N: usize> TryFrom<Vec<T>> for ArrayVecNotZeroSize<T, N> {
    type Error = ArrayVecNotZeroSizeError;

    fn try_from(vec: Vec<T>) -> Result<Self, Self::Error> {
        if vec.is_empty() {
            return Err(ArrayVecNotZeroSizeError::Empty);
        }
        if vec.len() > N {
            return Err(ArrayVecNotZeroSizeError::Overflow {
                capacity: N,
                actual: vec.len(),
            });
        }
        let mut av = ArrayVec::new();
        for item in vec {
            av.push(item);
        }
        Ok(Self(av))
    }
}

impl<T, const N: usize> std::ops::Deref for ArrayVecNotZeroSize<T, N> {
    type Target = [T];

    fn deref(&self) -> &[T] {
        &self.0
    }
}

impl<'a, T, const N: usize> IntoIterator for &'a ArrayVecNotZeroSize<T, N> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

// ── Serde ────────────────────────────────────────────────────

impl<T: Serialize, const N: usize> Serialize for ArrayVecNotZeroSize<T, N> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de, T: Deserialize<'de>, const N: usize> Deserialize<'de> for ArrayVecNotZeroSize<T, N> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let vec = Vec::<T>::deserialize(deserializer)?;
        Self::try_from(vec).map_err(serde::de::Error::custom)
    }
}

// ── Into<ArrayVec> for serde(into) support ──

impl<T, const N: usize> From<ArrayVecNotZeroSize<T, N>> for ArrayVec<T, N> {
    fn from(value: ArrayVecNotZeroSize<T, N>) -> Self {
        value.0
    }
}
```
