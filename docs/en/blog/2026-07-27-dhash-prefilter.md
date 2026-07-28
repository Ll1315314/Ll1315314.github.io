---
title: Cutting vision-model inference cost 8× with an O(1) perceptual hash
date: 2026-07-27
---

# Cutting vision-model inference cost 8× with an O(1) perceptual hash

> When you hand high-frequency screenshots to a vision model, the overwhelming majority of frames haven't changed at all. Use one cheap deterministic computation to block most of the expensive model calls.

## 1. The problem: you're paying continuously for "nothing happened"

A lot of production vision-agent scenarios share one trait: **high frequency, high repetition, low information gain.**

Here's a real case: periodically screenshot a customer-service work window, hand it to a vision model for OCR, detect whether there are new unread messages, and push a notification to Feishu if there are.

Once it was running, a problem showed up: taking a screenshot every few dozen seconds, the picture **hadn't changed at all 80–90% of the time**. Calling the vision model on every frame means paying continuously for "nothing happened" — and as long as the service runs, the money keeps flowing out.

Even with the most cost-effective vision model available, each call costs a few seconds of latency plus per-token billing. In a high-frequency scenario, that cost scales linearly with time.

## 2. The fix: an O(1) gate in front

The idea is genuinely simple: **if the image is nearly identical to the previous one, the OCR result almost certainly is too — so don't call the model, reuse the previous conclusion.**

The architecture becomes:

```text
screenshot
  │
  ▼
compute perceptual hash (O(1), microseconds)
  │
  ├── Hamming distance < threshold → unchanged, skip the model call ↺
  │
  └── Hamming distance ≥ threshold → changed, now call the model ✅
```

The vast majority of frames get stopped at the first branch; the model only wakes up when something actually changed. **Microsecond-scale cheap computation blocking second-scale expensive calls** — the math works out no matter how you run it.

## 3. Algorithm choice: aHash flopped, dHash saved it

The first version used **average hash (aHash)**, because it's the simplest: shrink to a small image → compute the mean grayscale of the whole image → each pixel above/below the mean becomes one hash bit.

Sounds reasonable, but in practice the judgment was **extremely unstable**: two screenshots differing by a few lines of unread messages produced wildly varying Hamming distances, and it frequently ruled "unchanged" when the screen had clearly changed.

**Why?** Because aHash's core signal is the **global mean grayscale**. Text is local and occupies a small fraction of the frame; a few lines of small text appearing or disappearing barely moves the whole-image average, so the hash barely moves either.

> It's like judging a pot of soup by measuring only the average salt concentration of the entire pot — pour a spoonful of chili oil into one bowl and the pot-wide average hardly notices.

**Switching to difference hash (dHash) stabilized it.** dHash doesn't look at absolute values, it looks at **gradients**: it compares each pixel's brightness against its right-hand neighbor. The critical difference is that dHash compares **relationships between adjacent pixels**, not pixels against a global average.

Text is fundamentally **edges**, and edges are exactly where pixel values jump sharply. So dHash is highly sensitive to text appearing, disappearing, or moving. After the swap, stability improved immediately, and the threshold tightened from **20 down to 15** (the implementation shrinks the image to 16×17 grayscale and compares horizontal gradients pixel by pixel, giving a **16×16 = 256-bit** hash; fewer than 15 differing bits counts as "basically unchanged" and is skipped).

| Algorithm | Core idea | Sensitivity to text changes | Stability |
| --- | --- | --- | --- |
| aHash | Pixel vs. global mean | ❌ Very low | Unstable |
| **dHash** | Pixel vs. right neighbor | ✅ High | Stable |
| pHash | DCT frequency-domain analysis | ✅ High | Stable but slower |

For this scenario **dHash is the sweet spot**: sensitive enough, extremely fast, simple to implement.

## 4. Model choice: let data decide, not gut feel

The gate decides *whether* to call. Once you do call, you still pay. So the second optimization was: **make each call as cheap as possible.**

The common move is "pick the strongest model" because "accuracy matters most." That reasoning doesn't hold here: the task is just detecting whether there are new messages — relatively simple OCR. The strongest model's capability is pure overflow.

So I added a `[Token]` log line, sampled real calls to get mean input/output token counts, and converted to monthly cost at official pricing. The conclusion was stark (**the figures below are estimates at then-current pricing, meant for order-of-magnitude comparison, not an exact bill**):

| Model | Relative cost | Notes |
| --- | --- | --- |
| GPT-4o | 1× | Baseline |
| **Gemini 2.5 Flash** | **≈ 1/8.4×** | Accuracy difference on this task is nearly negligible |

**Gemini 2.5 Flash came in around 1/8.4 the cost of GPT-4o**, with essentially negligible accuracy difference on this OCR task. So GPT-4o got replaced — not a "downgrade," but data-driven selection against a clearly defined requirement.

### But cost isn't the only axis: stability pulled me back to reality

Cost dropped after switching to an overseas model, but I quickly hit a different wall — **this is a 7×24 long-running background monitor, and calling overseas models through OpenRouter would intermittently error out**:

```text
[HTTP] status: 403
{"error":{"message":"The request is prohibited due to a violation of provider Terms Of Service.","code":403}}
```

For a monitor that must run continuously and catch new messages whenever they appear, **intermittent 403s mean missed alerts** — and no price makes that acceptable. So production ended up on **Qwen-VL-Max**: a domestic model, stable connectivity, no more blocks, and still cheap enough for what is a relatively simple OCR task.

That detour completed my selection criteria: **cost is only one dimension. For long-running services, availability and stability are usually the harder gate.** A cheap model that intermittently goes on strike is a net negative for a monitoring system.

## 5. How the cost actually came down

Two optimizations stack, and they multiply:

```text
total cost = number of calls × cost per call
             └ dHash pre-dedup      └ dropped GPT-4o
               blocks ~50%            unit price ≈ 1/8.4
```

| Optimization | Effect | Measured result |
| --- | --- | --- |
| dHash pre-dedup | Fewer calls | ~50% blocked in practice (1200 rounds / 600 skipped) |
| Dropped GPT-4o | Lower per-call cost | Replacement measured at ≈ 1/8.4; production settled on Qwen-VL-Max (cost + stability) |

"Block half the calls" multiplied by "drop the remaining unit price by an order of magnitude" makes an order-of-magnitude total reduction entirely predictable (the exact figure fluctuates with how often the screen actually changes and the screenshot interval).

> One real detail worth mentioning: why only 50% skipped when the screen "looks unchanged"? Very likely because a **wait timer on the UI ticks every second** (the code shows things like a red `1m7s` counter), so pixels change every frame and dHash correctly judges "changed" and doesn't skip. That's a much more convincing engineering detail than a vague "most frames don't change."

## 6. Where else this applies

The "high frequency + high repetition + vision model" combination is extremely common in shipped agents:

| Scenario | How to apply it |
| --- | --- |
| UI automation monitoring | Detect whether the interface changed; only analyze when it did |
| Game idling bots | Detect entering a new scene / a new button appearing |
| Video keyframe extraction | Use dHash for scene-cut detection; only send keyframes to the model |
| Desktop assistant agents | Periodic screenshots to understand state; skip when unchanged |
| Industrial visual inspection | Static production-line view; deep analysis only on detected anomalies |

The pattern is always the same: **use cheap deterministic computation to filter out the samples that don't need expensive fuzzy inference.**

## 7. Going further: the three-layer funnel of agent cost optimization

Abstract this case and you get a general cost framework:

```text
┌────────────────────────────────────────────────┐
│  Layer 1: don't call at all (dHash pre-check)  │
│  Block requests that never needed a model —    │
│  an O(1) hash  ✅                              │
├────────────────────────────────────────────────┤
│  Layer 2: call something cheap (model routing) │
│  Simple tasks to small models — 1/8 to 1/20    │
│  the unit price  ✅                            │
├────────────────────────────────────────────────┤
│  Layer 3: call it well (RAG / context trimming │
│  / caching) — fewer input tokens, reuse past   │
│  results  ✅                                    │
└────────────────────────────────────────────────┘
```

Most teams grind exclusively on layer 3 (shorter prompts, better RAG), but **layers 1 and 2 usually pay more and are simpler to implement.**

## 8. One line

An O(1) perceptual hash in front, one data-driven model selection behind. No architecture changes, no prompt tuning, no distillation — just engineering-level pre-filtering and rational selection, and the cost fell.

**In shipping agents, engineering discipline is easier to underrate than model capability — and more likely to produce outsized returns.**
