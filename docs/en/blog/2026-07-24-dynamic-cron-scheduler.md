---
title: Refactoring a per-minute tick scheduler into dynamic cron
date: 2026-07-24
---

# Refactoring a per-minute tick scheduler into dynamic cron

> Let ops change the schedule from the UI and have it take effect immediately — no restart — while still guaranteeing the job doesn't run twice under a multi-instance deployment.

## What was wrong with the old design

The original scheduler was a fixed "wake up every minute" job. Each tick it read the enabled flag and the interval from config, then decided whether it was time to do the work. It functioned, but it had three real problems:

- **Weak scheduling vocabulary.** It could only express "every N minutes." What the business actually wanted was things like "04:00 daily" or "twice a day" — not expressible at all.
- **A minute of idling per minute.** Most ticks did nothing.
- **Ambiguous semantics when changing the frequency.** The front-end config and the actual behavior didn't line up.

## The refactor: dynamic cron

The core became `ThreadPoolTaskScheduler` + `CronTrigger`, with the cron expression stored in the database:

```java
// Front-end changed the cron → the backend reschedules
public synchronized void reschedule(String cron) {
    if (future != null) {
        future.cancel(false);            // cancel the previous schedule
    }
    if (cron == null || cron.isBlank()) {
        return;                          // blank = off, don't install a trigger
    }
    future = taskScheduler.schedule(
        this::runTask,
        new CronTrigger(cron)            // re-arm with the new cron
    );
}
```

So now:

- When someone edits the cron, the backend cancels the old `ScheduledFuture` and reschedules a new one — **effective immediately, no restart**.
- The API contract evolved from `{enabled}` to `{cron}` (off simply means no trigger installed), and the UI collapsed from "a toggle plus two frequency inputs" into a single cron dropdown.

## Not running twice across instances

The moment you deploy more than one instance, every instance fires when the cron comes due, and the job runs N times. A **Redisson distributed lock** closes that hole:

```java
private void runTask() {
    RLock lock = redisson.getLock("monitor:task-lock");
    // tryLock(wait 0, lease renewed automatically by the watchdog)
    if (!lock.tryLock(0, -1, TimeUnit.SECONDS)) {
        return;                          // lost the race = another instance has it
    }
    try {
        doMonitor();
    } finally {
        lock.unlock();
    }
}
```

The reason for Redisson rather than a hand-rolled `SETNX` is its **watchdog auto-renewal**. As long as the holding thread is alive, the lock's TTL keeps getting extended — which avoids the classic "job outlives the lock, second instance walks in" failure. And if the holding process dies outright, the watchdog stops renewing and the lock expires on its own, so you don't deadlock either.

## Hardening done along the way

While I was in there, I cleaned up a few landmines I'd left earlier:

- **Removed the giant transaction wrapping the scheduled job**, so the lock boundary and the transaction boundary are both clean.
- **Routed manual triggers through the same Redis lock**, so a manual run can't stack on top of a scheduled one.
- Added an in-process `AtomicBoolean` guard against re-entrant triggers within a single instance.

## Takeaway

The value here wasn't "we swapped one scheduling API for another." It was separating three concerns that had been tangled together:

1. **Schedule expression** (cron) — the frequency the business wants can actually be stated.
2. **How changes take effect** (cancel + reschedule) — config edits apply instantly, with zero ops involvement.
3. **Concurrency correctness** (distributed lock + watchdog) — no duplicate runs, no deadlocks, across instances.

Each layer owns exactly one thing. Together they're a scheduler that can run hot for a long time without someone babysitting it.
