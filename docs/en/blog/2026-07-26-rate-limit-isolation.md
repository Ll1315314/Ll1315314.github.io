---
title: Why front-end search stalls — a downstream-quota isolation story
date: 2026-07-26
---

# Why front-end search stalls — a downstream-quota isolation story

> For a while I thought I could fix front-end search latency by adding concurrency. By the end of the investigation the bottleneck turned out to have nothing to do with parallelism — it was a **shared downstream API quota**. This one taught me to cleanly separate two things: parallelism decides *how many things can run at once*; resource isolation decides *who gets the scarce external resource*.

## 1. First, lay all the cards on the table

The worst way to debug a performance problem is to start "optimizing" before you understand the system's structure. Step one is always to lay the cards out. This system has three core components, each with its own job, nested inside one another:

| Component | What it is | Key params | Responsibility |
| --- | --- | --- | --- |
| `xhsMonitorExecutor` | **Thread pool** | core=2, max=4, queue=10 | Runs background monitoring async/in parallel |
| `XhsKeywordSearchQueue` | **Single-threaded queue** | 1 thread + blocking queue | Queues front-end search requests, processes serially |
| `OneApiRequestQueue` | **Single-threaded queue (one per key)** | 1 thread + `delayMs` between requests | Calls the third-party API serially — natural rate limiting |

Three facts matter, and everything downstream of this rests on them:

1. **The monitoring thread pool is deliberately tiny.** `core=2`, `max=4` is itself a "don't let background work hog resources" throttle. Not an oversight — intentional. The original instinct was right; it just wasn't carried all the way through.
2. **Front-end keyword search is single-threaded and serial.** One keyword at a time, and each one makes several third-party API calls. It was never a parallel system.
3. **Every third-party API call ultimately funnels into a per-key, single-threaded rate-limited queue.** Those queues are serial with a fixed delay between requests, specifically to avoid tripping the platform's rate limits. However much concurrency you pile on upstream, it all converges on some key's queue and gets serialized.

Those three layers act like a funnel, squeezing upstream concurrency down into one narrow downstream outlet.

## 2. The symptom: front-end search is fast sometimes, slow other times — and it "collides" with the background job

Two features call the same paid third-party API:

| Feature | Trigger | Behavior | Latency tolerance |
| --- | --- | --- | --- |
| Background monitoring | Scheduled, probes a batch of posts | Periodic, predictable, high volume | High |
| Front-end search | Ops manually triggers keyword analysis | Bursty, interactive | Low (needs to feel instant) |

The user experience of front-end search was bizarre: **sometimes instant, sometimes spinning forever, sometimes feeling outright broken.**

More confusingly, the stalls followed a pattern — **they always coincided with the scheduled background job firing.** Ops would report "search is stuck again" right on the hour, and it was basically fine the rest of the time.

That kind of *regular* stall is already a strong signal. Random stalls can be GC, network jitter, lock contention. But **a stall that correlates with the clock is almost always tied to something scheduled.**

## 3. The wrong turn: instinct says add concurrency — but concurrency wasn't the bottleneck

The reflex on seeing "slow" is almost always **add concurrency**, and I went down that path too:

- Is the monitoring thread pool too small? Should I bump `core=2 / max=4`?
- Should the front end run several search threads at once?

Three seconds of thought shows why neither helps:

- **Front-end search is single-threaded and serial by construction.** It isn't slow because it lacks parallelism — it isn't parallel at all. One keyword finishes, then the next starts. Thread count is irrelevant. Give it 100 threads and it'll use one.
- **Enlarging the monitoring pool has nothing to do with front-end responsiveness.** They're two entirely separate processing chains; the monitoring pool governs background parallelism and doesn't sit on the front-end response path at all.

> It's like opening ten toll lanes when only one toll booth is staffed. Open a hundred lanes and the cars still queue. **The bottleneck is the booth, not the lanes.**

Adding threads didn't help, which told me the bottleneck wasn't concurrency capacity — **the tasks were starting fine; they were all waiting on the same thing.**

## 4. Root cause: the shared downstream quota was being starved

Following "what are they all waiting on," the truth surfaced:

> **Background monitoring and front-end search both funnel their requests into the same set of third-party API key queues.**

That single front-end thread makes several API calls per keyword, and those calls land in the same `oneapi-{key}` queues as the monitoring probes. Those queues are serial, with a fixed delay between requests, precisely so we don't trip platform rate limits.

So this happens:

```text
Scheduled background job fires
        │  dumps a large batch of probe requests at once
        ▼
┌─────────────────────────────────────────────────────┐
│  Shared OneAPI key queue (serial + fixed delay)     │
│                                                     │
│  [mon①][mon②][mon③] … [monₙ]                        │ ← filled by background
│  [fe①][fe②] …… (stuck waiting behind them)          │ ← front-end API calls
│                                                     │
└─────────────────────────────────────────────────────┘
        │
        ▼
    Third-party API
```

The background job fills the shared queue in one burst. Front-end search has its own processing thread, but the API calls it issues can only line up behind the monitoring requests and wait for quota.

**The stall isn't "computation is too slow." It's the downstream quota being starved by the background job.**

At that point, adding threads at *any* layer just manufactures more fake-busy waiters — concurrency looks high, but they're all blocked behind the same serial rate-limited queue. A bigger pool means more threads calling `wait()` and more context-switch overhead. Going from 4 to 10 monitoring threads just creates six more threads standing in the same line.

## 5. The fix: resource isolation, not more threads

Once the direction is right, the fix is clear and simple: **don't add threads, split the quota.**

Give monitoring its own rate budget (its own limiter) so it spends only its own share and stops competing for the same key queues as the front end:

```text
Monitoring  ──►  monitoring-only limiter (default 10/min)
                  │
                  └──►  third-party API (global limit still applies,
                        but the two paths no longer interfere)

Front-end   ──►  front-end limiter (higher rate, e.g. 50/min)
                  │
                  └──►  third-party API
```

Key design decisions:

| Decision | Reason |
| --- | --- |
| Monitoring rate deliberately low (default 10/min) | Background batch work; nobody is waiting on it in real time |
| Front end gets the higher allowance | Interactive, directly tied to user experience |
| Physical isolation (separate token buckets) | Neither knows the other exists; a busy background can't steal front-end quota |
| Limiter added on the monitoring side | Throttles only monitoring, never touches the front end; even under the same keys it no longer crowds the front end out |

After shipping this, no matter how big a batch the scheduled job dumps, front-end keyword search returns instantly and consistently. That single front-end thread finally stopped riding along behind a shared queue.

One detail worth noting: **I chose to put the limiter on the monitoring side, not the front-end side.** Monitoring is the intruder — it's what filled the queue and starved the front end. Constraining the offender is more intuitive and more maintainable than granting the victim a fast lane.

## 6. A distinction worth nailing down: parallelism ≠ resource quota

The biggest takeaway was cleanly separating two concepts that constantly get conflated. A lot of misdiagnosed performance problems trace back to exactly this confusion.

| Concept | Solves what | Typical mechanism | Applies to |
| --- | --- | --- | --- |
| **Parallelism** | Can tasks run simultaneously | Thread pools, coroutine pools, connection pools | CPU / IO-bound computation |
| **Resource quota** | How to fairly divide a scarce external resource | Rate limiters, quota systems, tenant isolation | Third-party APIs, DB connections, bandwidth |

A thread pool answers "how many requests can I issue at once." A rate limiter answers "how do we split a limited external allowance."

When the bottleneck is a shared external resource, adding threads only manufactures more waiters — putting more people in line doesn't make the line move faster. Worse, excess waiting threads add context-switching overhead and memory pressure.

> **A more concrete analogy:** picture a charging station with 4 chargers. Thread pool = how many cars are waiting in the lot; rate limiter = the rules for allocating chargers (who goes first, for how long, how many times a day). If cars are waiting too long, the fix isn't "let more cars into the lot" (a bigger pool) — it's assigning different car types to different chargers or time slots (resource isolation).
>
> Push it further: if *ambulances* are waiting too long, you don't say "let's send more ambulances to wait alongside them." You say "give ambulances a dedicated priority lane." **Priority and isolation matter more than raw concurrency.**

## 7. Slow poisons cleaned up along the way

While refactoring I fixed a batch of issues in the monitoring module that look small individually and are lethal collectively. They don't blow up immediately, but they make a system drift out of control over long, high-frequency operation.

**1. Wrong comment-delta detection → pointless full re-fetches**

Original logic: to check whether a post had new comments, count the comment rows for that post in our database.

Problem: comments can be deleted, collapsed, or filtered by moderation, so the DB row count and the platform's displayed `comment_count` diverge. The result: the system thinks there are new comments, re-fetches everything, and nothing has actually changed.

Fix: compare against the platform's `comment_count` field directly. That's the platform's own notion of "publicly visible comment count" — the authoritative source for detecting a delta.

> **The underlying problem:** inferring a fact from derived data (DB row count) instead of using the source of truth. It's like estimating how many people in the house ate fruit by counting peels in the trash — too many intermediate steps, error is unavoidable.
>
> **Going further:** distributed systems have a general principle — **single source of truth**. If a fact has copies in several places, defer to the authoritative one, not whichever is most convenient.

**2. Cursor not advanced on failure → idling every minute**

Original logic: the scheduled job fetches a batch of posts and, on success, advances the `last_crawl_at` cursor; on failure it doesn't, so the next run resumes from the same place.

Problem: if one post in a batch fails (an API timeout, say), the cursor never advances, the job fires again a minute later, fetches the same batch — and fails again. A permanent spin loop.

Fix: advance the cursor even on failure. Record the reason, but let the job move forward; failed posts go into a separate retry queue and don't hold up overall progress.

> **The underlying problem:** coupling per-item error handling to overall progress control. Like a courier delaying an entire street's deliveries because one household wasn't home.
>
> **Going further:** in batch systems, distinguish **transient failures** (network timeout, rate limiting — retry) from **permanent failures** (resource gone, insufficient permission — skip and log). But neither kind should ever block overall progress.

**3. Manual triggers bypassing the lock → fighting the scheduled job**

Original logic: the scheduled job took a distributed lock (Redis lock); the manual trigger endpoint didn't. Ops clicks "analyze now" and multiple instances can fire simultaneously.

Problem: manual trigger + scheduled job running together = double the requests hitting the third-party API = easier to trip rate limits = a vicious cycle.

Fix: manual and scheduled paths go through the same lock — one entry point, one lock — plus an in-process `AtomicBoolean` as a second layer of deduplication.

> **The underlying problem:** one piece of business logic with two different concurrency-control strategies (one locked, one not) will produce race conditions. Like a road with both traffic lights and a traffic officer who don't talk to each other.
>
> **Going further:** the correct way to use a distributed lock is **lock in one place, respected everywhere**. Once a code path takes the lock, every path touching the same resource must go through the same lock, or the lock is decorative.

## 8. What these "small" problems have in common

Looking back, all three share one trait: **none of them are bugs. They're latent design debt.**

They don't show up on day one, because: when data volume is small, `comment_count` and the DB row count barely diverge; when failure rates are low, a stuck cursor is rare; when concurrency is low, a missing lock rarely bites.

But as uptime grows, data accumulates, and trigger frequency rises, they graduate from "occasional oddity" to "chronic killer of system stability." That's why so many systems are "fine at launch and fall over six months in" — the code didn't get worse, the latent debt accrued interest.

Fixing them isn't about making the system *faster*. It's about keeping it from **drifting out of control under long-running, high-frequency operation**.

## 9. A general framework for debugging stalls

This left me with a reusable framework for investigating "it's slow" in any system that depends on external resources:

```text
Step 1  Determine where it's stuck
        ├── Threads RUNNABLE?          → compute bottleneck (CPU / algorithm)
        ├── Threads WAITING/TIMED_WAIT? → synchronous wait (IO / lock / condvar)
        └── Threads BLOCKED?           → lock contention

Step 2  If it's waiting, waiting on what
        ├── CPU / memory / GC?  → scale up / tune the JVM
        ├── A lock?             → reduce lock granularity / hold time
        └── An external resource? → go to step 3

Step 3  Is the external resource shared
        ├── Yes → is there contention?
        │        ├── Yes → resource isolation (split quotas / separate keys)
        │        └── No  → optimize the call pattern (batch / cache / coalesce)
        └── No  → check the resource's own health (is downstream slower?)

Step 4  Validate the hypothesis
        ├── Add metrics (queue depth, wait time, throughput, success rate)
        ├── Run a controlled experiment (disable the background job, watch the front end)
        ├── Add logging (how long each request spent in each stage)
        └── Confirm the root cause before changing anything
```

The core idea: **every step from symptom to root cause needs evidence, not "I feel like it's probably…"**

## 10. One line

When a system depends on a limited external resource, "add threads" is the most tempting and least effective optimization available. What you actually need is to **acknowledge the scarcity, then divide it fairly through isolation and quotas.**

**Thread pools make you fast; resource isolation makes you stable.** In systems built on third-party APIs, the second matters far more than the first.

Next time you hit "I added concurrency and it's still slow," don't reach for the thread count — check whether someone is queued behind a shared quota.
