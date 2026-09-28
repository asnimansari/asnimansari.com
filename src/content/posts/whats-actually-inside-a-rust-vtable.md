---
title: "What's actually inside a Rust vtable"
description: "Rust 1.98.1 fixed a compiler bug that could put a null function pointer into a dyn Trait vtable. A look at fat pointers, vtable layout, and why a bad entry is undefined behavior instead of a guaranteed crash."
date: 2026-09-11
tags: ["rust", "unsafe"]
draft: false
---

On September 3, Rust 1.98.1 shipped to fix a bug reported two weeks
earlier in [issue #161441](https://github.com/rust-lang/rust/issues/161441).
In certain generic, dynamically dispatched code, rustc's trait
resolution could decide a method's predicates were impossible to
satisfy and skip emitting a function pointer for it. Instead of
refusing to compile or inserting something that panics, it wrote a
zero into that vtable slot. The reported case involved a boxed async
service erased behind a trait object with several associated types,
shaped roughly like `Arc<dyn DynService<Input, Output = Output, Error
= Error> + Send + Sync>`, and it reproduced consistently on
aarch64-apple-darwin. No unsafe code was needed to hit it. An ordinary
call through the trait object would eventually load that null pointer
and jump to it, which the fix's own write-up is careful to describe as
undefined behavior that "may just cause segfaults," not a guaranteed
one.

That's a good excuse to open a vtable up and look at what's actually
in there, and why a bad entry doesn't necessarily give you the clean
crash you'd hope for.

## The fat pointer

A reference to a sized type, `&T`, is one machine word: the address of
`T`. A reference to a trait object, `&dyn Trait`, is two words. The
first is the same data pointer, to wherever the concrete value lives.
The second is a pointer to a vtable, generated once per concrete-type-
and-trait pair at compile time, not once per value. `Box<dyn Trait>`
and `Arc<dyn Trait>` carry the same second word for the same reason.

That second word is the whole trick behind dynamic dispatch. Calling a
trait method on a generic `T: Trait` gets monomorphized: the compiler
knows the concrete type at every call site and can call the function
directly, or inline it. Calling a method on `dyn Trait` can't work
that way, because the concrete type was erased the moment the value
went behind the trait object. The vtable is where that information
goes instead of disappearing: given only the two words in a `&dyn
Trait`, the vtable pointer is enough to find every method the trait
object can call, plus enough about the underlying type to drop it
correctly.

Rust doesn't currently give you a stable way to inspect this. There's
a `ptr_metadata` feature with a `DynMetadata` type that exposes size
and alignment safely, but as of this Rust version it's still
nightly-only, behind [tracking issue
#81513](https://github.com/rust-lang/rust/issues/81513). On stable,
looking inside a vtable means reaching for `unsafe` and treating the
fat pointer as raw bytes.

## What's in the vtable

The layout isn't part of the language spec. It's an implementation
detail of rustc, and it has looked the same for a long time in
practice: a pointer to the type's `drop_in_place` function, the type's
size, its alignment, and then the trait's methods in declaration
order. Four words of header before the first method pointer shows up.

The `drop_in_place` entry is why a `Box<dyn Trait>` can be dropped
correctly without ever knowing the concrete type at the call site. The
size and align entries are why a `Box<dyn Trait>` can be deallocated
correctly. Both come from the vtable, not from the thin data pointer
next to it.

## Looking at it directly

`cargo asm` (or its actively maintained successor, `cargo show-asm`)
will show you the generated call site for a `dyn Trait` method call.
Reduced to its shape, invoking a method through a trait object
compiles to loading the vtable pointer, then an indirect call through
it at a fixed offset, something like `call qword ptr [rax + 24]` on
x86-64. The offset is fixed at compile time because the compiler knows
where each method sits in the layout it generated. It has no idea
whether the value actually sitting at that offset, at run time, is
still a valid function pointer.

To read the raw entries yourself:

```rust
trait Speak {
    fn speak(&self) -> &'static str;
}

struct Dog;

impl Speak for Dog {
    fn speak(&self) -> &'static str {
        "woof"
    }
}

fn main() {
    let dog = Dog;
    let obj: &dyn Speak = &dog;

    #[repr(C)]
    struct FatPointer {
        data: *const (),
        vtable: *const usize,
    }

    // SAFETY: &dyn Trait has this two-word layout on every rustc
    // version in use today, but nothing in the language guarantees
    // it. The transmute is only sound because the result is treated
    // as opaque bytes from here on, never as anything the type system
    // still vouches for.
    let fat: FatPointer = unsafe { std::mem::transmute(obj) };

    unsafe {
        let drop_fn = *fat.vtable;
        let size = *fat.vtable.add(1);
        let align = *fat.vtable.add(2);
        let speak_fn = *fat.vtable.add(3);

        println!("drop_in_place: {drop_fn:#x}");
        println!("size:          {size}");
        println!("align:         {align}");
        println!("speak:         {speak_fn:#x}");
    }
}
```

Run that and `speak_fn` prints a real address, the address of `Dog`'s
`speak` implementation. That's the entry the 1.98.0 bug could leave as
zero instead.

## Why this is UB, not a guaranteed segfault

Calling through a function pointer that doesn't point to a valid
function is undefined behavior in Rust, full stop. On a typical
desktop target, address zero happens to be unmapped, so jumping to it
trips a hardware fault and you get a clean SIGSEGV. That's a property
of the host environment, not a language guarantee. It doesn't hold
everywhere: WASM linear memory treats address zero as ordinary data,
and plenty of embedded targets have real, executable memory mapped at
or near zero. A null call on those doesn't fault at all, it just
executes whatever happens to be there.

Even where it does fault, the deeper problem isn't the one bad jump.
Once the compiler has convinced itself, incorrectly, that a code path
is unreachable, it's allowed to have optimized everything around that
path on the assumption it never runs. Proving that assumption false at
run time doesn't undo the optimizations that trusted it. The original
report puts it plainly: a null vtable entry "may just cause segfaults,
but it is possible for it to be justification for arbitrary effects."
The crash, when you get one, is the good outcome.

## Pinning your toolchain doesn't make miscompiles impossible, it makes them a version bump you control

A `rust-toolchain.toml` with an exact channel keeps CI and every dev
machine on the same compiler, so a fresh bug in a newly released
stable doesn't reach production the moment someone runs `rustup
update`. It wouldn't have stopped 1.98.0 from shipping with this bug.
What it changes is where you find out: instead of a report from
production, it's a CI run you kicked off on purpose when you decided
to bump the pin, with the release notes open in another tab. A patch
release that's purely a correctness fix, like 1.98.1, is worth taking
as soon as you're already on that minor version.

## What Miri can and can't tell you

Miri interprets your program's MIR directly and checks pointer
validity on every operation, instead of compiling to native code and
trusting whatever's at a given address. Calling through a vacant or
null vtable entry is exactly the shape of bug it's built to catch,
with a diagnostic naming the call, not a bare segfault three stack
frames removed from the cause. If the affected function had run under
`cargo miri test`, there's a good chance it would have caught this
before it ever reached a release build.

The hedge in that sentence is the whole point. Miri only checks the
paths your tests actually exercise, and it's slow enough that most
projects run it against a slice of the suite rather than all of it.
"Miri would have caught this" only holds for code that ran under Miri.
For everything else, a compiler bug in code you never happened to
interpret ships exactly the way this one did: quietly, until someone's
production trait object calls through a zero.
