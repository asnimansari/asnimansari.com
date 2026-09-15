+++
title = "The middleware that authenticated nothing"
description = "A session middleware in our Axum API let anonymous callers through to any handler that forgot to ask who they were. Here's the bug, why the obvious fix isn't enough, and the three designs we measured before picking one."
date = 2026-09-15

[taxonomies]
tags = ["rust", "axum", "security", "backend"]

[extra]
lang = "en"
+++

We had a session middleware on every protected route in our Axum API. It
resolved the session, attached the user, and logged people out when their
cookie went stale. It also let anonymous callers through to any handler that
forgot to ask who they were.

Nothing was exposed. We checked every route before changing anything. But the
only thing standing between us and an exposed endpoint was that thirty-six
handlers had each remembered to do something optional.

This is what the bug looked like, why the obvious fix isn't enough, and the
three designs we measured before picking one.

## The bug

Here is the middleware, reduced to its shape:

```rust
pub async fn session_layer(
    State(pools): State<Arc<SessionPools>>,
    headers: HeaderMap,
    jar: CookieJar,
    mut req: Request,
    next: Next,
) -> Response {
    match try_resolve(&pools, &headers, &jar).await {
        Authenticated(ctx) => {
            req.extensions_mut().insert(ctx);
            next.run(req).await
        }
        Anonymous => next.run(req).await,          // <-- runs the handler
        Rejected  => {
            let response = next.run(req).await;    // <-- also runs the handler
            (clear_cookies(jar), response).into_response()
        }
        InfrastructureError(err) => AppJsonError::from(err).into_response(),
    }
}
```

Three of the four arms call `next.run(req)`. The layer never rejects anything.
So what produces the `401`? This:

```rust
impl<S> FromRequestParts<S> for AuthCtx {
    type Rejection = AppJsonError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parts.extensions.get::<AuthCtx>().copied()
            .ok_or_else(|| AppError::authentication("not authenticated").into())
    }
}
```

The **extractor** enforces authentication. Which means authentication is a
property of a function signature:

```rust
// guarded: the extractor rejects an anonymous caller
async fn get_positions(State(s): State<AppState>, auth: AuthCtx) -> ... { }

// public: nothing rejects anything
async fn get_positions(State(s): State<AppState>) -> ... { }
```

Both compile. Both sit in the same router, behind the same layer, next to each
other in the same file. One is protected and one is not, and the difference is
five characters in an argument list.

Our own code had a comment admitting it: *"The layer never rejects on its own;
the handlers' `AuthCtx` is what forces a login."* Somebody understood this
exactly and wrote it down. That didn't make it safe. It made it documented.

We reproduced it in a standalone service. Two routes, same layer, same router,
differing only in handler signature:

```
GET /bug/safe    anon   401
GET /bug/leaky   anon   200   {"leaked":true,"secret":"protected data"}
```

The stale-cookie case is worse than the anonymous one:

```
$ curl -si -H 'Cookie: sstkn=garbage' /bug/leaky
HTTP/1.1 200 OK
set-cookie: sstkn=; Max-Age=0; Expires=...

{"leaked":true,"secret":"protected data"}
```

It logs you out and serves you the protected payload in the same response.

## Why it happened

The layer conflates two different things: **resolving** who a request is from,
and **deciding** what to do about the answer.

Resolution is a fact: there is a valid session, or there isn't. Policy is a
decision, and it differs per route. Our `/identify` endpoint genuinely needs to
answer `204` for anonymous callers rather than `401`, because the frontend
hard-navigates on `401` and rejecting there is an infinite reload loop. That
one legitimate requirement got generalised into the layer, and then every other
route inherited permissiveness it never asked for.

Split them and each route gets to state its own policy:

```rust
pub enum SessionOutcome { Authenticated(AuthCtx), Anonymous, Rejected, InfrastructureError(AppError) }

pub async fn resolve_session(..) -> SessionOutcome;  // the fact

pub async fn require_session_layer(..) -> Response;   // fail-closed
pub async fn optional_session_layer(..) -> Response;  // the old behaviour, deliberately
```

`require_session_layer` calls `next.run(req)` in exactly one arm.

That fixes the leak. It does not fix the *shape* of the problem: you can still
mount a route in the wrong router and have it be public. So the real question
is: where should the authentication decision live, such that forgetting it is
hard?

We built three designs and measured them.

## Option A: a central policy table

Key every route on its matched path and method, look the policy up in one
middleware, deny anything undeclared.

```rust
static RULES: &[(&str, &Method, RouteAuth)] = &[
    ("/api/status",                    &Method::GET, Open),
    ("/api/settings",                  &Method::GET, Open),
    ("/api/settings/{id}/detail",      &Method::GET, SessionRequired),
    ("/api/orders/{id}",               &Method::PUT, SessionRequired),
    // no entry -> denied
];
```

This is genuinely appealing: one file lists the entire security posture of the
service, and a new route fails closed until someone declares it. It's what our
admin console already does.

It also has two problems we only found by running it.

**HEAD breaks.** Axum serves `HEAD` from the `GET` route when you haven't
registered an explicit `head` handler:

```rust
call!(req, HEAD, head);   // explicit .head(..) route, if any
call!(req, HEAD, get);    // otherwise: hand it to the GET route
call!(req, GET,  get);
```

It does *not* rewrite `req.method()`. So a `HEAD` request has two methods in
play: the one the client sent, and the one whose handler will run. A table
keyed on the former looks up a rule written for the latter and misses:

```
HEAD /table/open   ->  403     (a public route)
```

**405 becomes 403.** `Router::route_layer` reaches `MethodRouter::layer`, which
wraps the `fallback` slot, axum's own Method-Not-Allowed handler. So the
policy layer intercepts it, misses the table, and denies:

```
DELETE /table/open  ->  403     (should be 405)
```

Both are fixable. Normalise `HEAD` to `GET` before the lookup, and carry a
`declared_methods()` list purely to rebuild the `Allow` header axum would have
produced for free. After that: `200` and `405 Allow: GET,HEAD`.

But notice the order those two fixes have to go in. The natural way to preserve
405s is "known path, unknown method → pass through and let axum handle it."
Combine that with the HEAD miss:

```
HEAD /table/safe  ->  lookup(path, HEAD) misses
                  ->  path is known, so pass through
                  ->  axum dispatches HEAD into the get slot
                  ->  protected handler runs unauthenticated
```

The table exists to close exactly that hole, and a reasonable implementation of
it reopens the hole. That's the real cost of Option A: you are re-deriving
method semantics the framework already implements, and getting it subtly wrong
is a security bug rather than a 404.

Plus the table is a list of path strings that must track the router by hand, and
Axum exposes no route introspection to check one against the other.

## Option B: per-route wrappers

Put the policy on the route instead of in a table:

```rust
.route("/timings",  authenticated(get(list_timings)))
.route("/presets",  public(get(list_presets)))
```

where

```rust
pub fn authenticated(m: MethodRouter) -> MethodRouter {
    m.route_layer(from_fn(require_session))
}
```

This is a clear improvement. The policy is visible on the route line, and
because the layer sits on the `MethodRouter` it never inspects the method, so
`HEAD` and `405` are handled by axum itself, no special-casing:

```
HEAD   /wrap/safe   ->  401
DELETE /wrap/safe   ->  405 Allow: GET,HEAD
```

One design note: wrap the whole `MethodRouter`, not each verb.
`route_layer` maps all nine method slots, so per-verb helpers
(`get_authenticated`, `put_authenticated`) would double-wrap the earlier verbs
when chained. A single wrapper composes with axum's native chaining and applies
the layer exactly once:

```rust
authenticated(get(a).put(b).delete(c))   // one layer, all three verbs
```

And it has an obvious gap:

```rust
.route("/forgot", get(handler))    // compiles. serves. leaks.
```

```
GET /wrap/forgot  anon  ->  200
```

We replaced a forgettable argument with a forgettable wrapper. Better: it's on
the route line now, where a reviewer looks. Still a convention, though.

You can close it with a newtype:

```rust
pub struct Guarded(MethodRouter);        // only authenticated()/public() construct one
pub struct GuardedRouter(Router);        // .route() takes Guarded, not MethodRouter
```

```
error[E0308]: mismatched types
  .route("/forgot", get(leaky))
                    ^^^^^^^^^^ expected `Guarded`, found `MethodRouter<_>`
```

Now it's compile-enforced. It also costs one annotation per route: thirty-six
of them, in our case.

## Option C: scopes

The unit of declaration doesn't have to be the route. Our routes were already
grouped by policy: one module of authenticated feature routes, one of public
routes, a couple of mixed modules that already expressed their split as
separate functions. The grouping existed; it just wasn't load-bearing.

```rust
ScopedRouter::new()
    .authenticated(|r| {
        r.nest("/orders", order_routes())
            .nest("/notifications", notification_routes())
            .nest("/settings", settings_routes())
    })
    .open(|r| r.route("/status", get(status)))
    .into_router()
```

Everything inside the closure is authenticated, including everything nested
below it. The primitive is small:

```rust
pub struct ScopedRouter<S = ()> { inner: Router<S> }

impl<S: Clone + Send + Sync + 'static> ScopedRouter<S> {
    pub fn scope<L>(self, layer: L, f: impl FnOnce(Router<S>) -> Router<S>) -> Self
    where L: Layer<Route> + Clone + Send + Sync + 'static, /* .. */
    {
        let scoped = f(Router::new()).route_layer(layer);
        Self { inner: self.inner.merge(scoped) }
    }

    pub fn open(self, f: impl FnOnce(Router<S>) -> Router<S>) -> Self {
        Self { inner: self.inner.merge(f(Router::new())) }
    }

    pub fn into_router(self) -> Router<S> { self.inner }
}
```

The important thing is what it *doesn't* have. There is no `route()`. The only
way to add a route is through a scope, so this fails to compile:

```
error[E0599]: no method named `route` found for struct `ScopedRouter<S>`
```

That's the same guarantee as Option A, enforced by the compiler instead of at
runtime, and the same mechanics as Option B, at a sixth of the annotation cost.
Because the layer never inspects the method, neither axum hazard applies.

`scope` is generic over the layer, so a service names its own policies:

```rust
impl AppScopes for ScopedRouter<AppState> {
    fn authenticated(self, state: &AppState, f: impl FnOnce(Router<AppState>) -> Router<AppState>) -> Self {
        self.scope(
            ServiceBuilder::new()
                .layer(from_fn(cross_origin_protection))
                .layer(from_fn_with_state(session_pools(state), require_session_layer)),
            f,
        )
    }
}
```

We ended up with three policies in one binary this way: required session,
optional session, and open.

## The numbers

All measured against a running service, not reasoned about:

| | A: table | B: wrappers | C: scopes |
| --- | --- | --- | --- |
| policy omitted entirely | 403 | **200** | **compile error** |
| nested routes covered | per-path entry | per-route | automatic |
| `HEAD` on a public route | **403**, needs a fix | 200 | 200 |
| `DELETE` on a GET-only route | **403**, needs a fix | 405 | 401 anon / 405 auth'd |
| annotation cost | 36 table entries | 36 route lines | ~6 scopes |

C shipped.

## What it cost

Two things worth stating plainly, because a writeup that only lists wins isn't
useful to anyone.

**`DELETE` on a GET-only route now returns 401 to anonymous callers instead of
405.** `Router::route_layer` reaches `MethodRouter::layer`, which wraps the
`fallback` slot, so the scope also guards axum's Method-Not-Allowed handler.
Authenticated callers still get their 405. We think this is an improvement,
since which methods a path accepts isn't worth telling a caller who failed the
check, but it is a behaviour change and it belongs in the API docs, not in a
footnote.

**The guarantee is per-module, not global.** It holds inside any table built
from a `ScopedRouter`. The file that composes those tables still merges plain
routers and could add a bare route. That's one ~30-line file to review instead
of every handler signature in the binary. A large reduction, not an
elimination. We put a comment in that file saying so.

## What we'd take away from it

**A safety property that depends on remembering isn't a safety property.**
Every one of our thirty-six handlers had remembered. The code was, at that
moment, correct. It was still the wrong design, because its correctness was
maintained by thirty-six independent acts of diligence and the next one was
always optional.

**Separate the fact from the decision.** The layer's real flaw wasn't
permissiveness, it was answering two questions at once. Once `resolve_session`
returns an outcome and the caller picks a policy, the permissive behaviour
becomes one deliberate choice on one route instead of the default everywhere.

**Check what the framework does before keying a policy on it.** The `HEAD`
problem is invisible in code review and obvious in one `curl -I`. We found it
because we built the thing and ran it, not because we read it carefully, and
we'd read it carefully first.

**Prefer designs where the mistake doesn't compile.** Ranked by what happens
when someone forgets: a runtime deny is better than a silent leak, and a
compile error is better than both. That ordering is worth paying an
abstraction for.
