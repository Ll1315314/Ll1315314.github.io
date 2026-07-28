---
title: Replacing a paid API with public-page INITIAL_STATE for data snapshots
date: 2026-07-24
---

# Replacing a paid API with public-page `INITIAL_STATE` for data snapshots

> How we drove a third-party API bill to zero — and, just as importantly, one decision to *stop* that was backed by evidence.

## Background: where the money was going

We had a "content data snapshot" requirement: periodically collect engagement numbers (likes / comments / saves / shares) for a batch of posts, to feed later analysis. The original implementation called a paid third-party API. It was a meaningful monthly line item, and a large share of the probes — against cold content that never changed — were wasted.

The goal was plain: **cut that API cost without giving up data availability.**

## The key observation: the numbers are already printed on the public page

All a snapshot really needs is a handful of engagement counters — and those counters are **already written into the public post page's HTML at server-render time**, inside the page's `window.__INITIAL_STATE__` JSON blob.

Which means:

- **No login required**; no authenticated endpoints are involved.
- From the platform's point of view this is an ordinary public page view, behaviorally indistinguishable from a person opening a post.
- So it is inherently **zero accounts, zero risk-control exposure, zero cost**.

The Java port was about as direct as it gets:

```java
// pseudocode, showing the flow
String html = httpGet(publicNoteUrl);              // 1. GET the public page
String json = extractInitialState(html);           // 2. regex out __INITIAL_STATE__
InteractInfo info = parseInteractInfo(json);       // 3. parse interactInfo
// info.likedCount / commentCount / collectedCount / sharedCount
```

Tested against real links, it reliably returned all four numbers: likes, comments, saves, shares. The token embedded in the long share URL didn't expire over more than a month of testing, so we didn't even need a refresh mechanism.

## The honest limitations

- **View counts aren't available** — but the paid API can't return them either anymore (platform restriction), so this isn't a regression.
- **A public-page approach is brittle.** One redesign on their side and the parsing can break.

On that second point, my stance was to treat this explicitly as a **cost optimization, not a hard guarantee**:

1. If parsing fails, **fall back automatically** to the paid API so data never stops flowing.
2. The parsing layer tolerates structural drift — a missing field triggers the fallback rather than throwing and failing the whole batch.
3. It only carries the "give me the numbers" snapshot; anything that genuinely depends on an authenticated session was never staked on it.

In other words: **when the optimization fails, it degrades gracefully to the original paid baseline. No functional incident.**

## So why not self-host comment fetching too? — a decision to stop, backed by evidence

Comment bodies come from a **lazily-loaded, authenticated endpoint** that the public page doesn't expose. I did seriously attempt a self-hosted replacement (an open-source approach using httpx plus a reverse-engineered signature), but the comment endpoint consistently returned an "account abnormal" error code. Rather than stopping at "probably risk control," I ran a controlled elimination:

- **Ruled out CAPTCHA.** Captured the raw response and confirmed it was not a slider or verification page — just the bare error code.
- **Ruled out IP.** Response headers confirmed the traffic really was on a residential IP, not a datacenter one.
- **Ruled out the account.** New accounts, aged accounts, incognito environments, warmed-up accounts — all tested, all abnormal.
- **Ruled out TLS fingerprint.** Used `curl_cffi` to spoof the TLS/JA3 fingerprint to a real Chrome (**verified working — fingerprints matched**), and it was still blocked.

With the connection layer (IP, TLS/JA3) fully disguised and still blocked, the root cause can only be **higher-level request behavior**: non-browser clients like httpx differ fundamentally from a real browser in request timing, header composition, and the absence of a real browser execution environment. That means anti-detect browsers and TLS spoofing can't save you — the only remaining path is real browser automation, and that path triggers **account-level** bans.

**Conclusion: comment bodies keep going through the paid API. No further investment in building our own.**

## What I took from it

When you're doing cost reduction, the most valuable output isn't necessarily "how much we saved." It's **mapping the boundary of what's feasible**:

- The IP layer, the TLS layer (JA3), and the application-behavior layer are three independent adversarial surfaces. You need to be able to isolate and eliminate them one at a time.
- A "no" that's backed by evidence saves the team every future hour that would have been sunk into the same dead end — which is worth as much as a successful "yes."

The end state: snapshots and high-frequency probing cost nothing, and comment-body cost is only incurred when there's genuinely new content.
