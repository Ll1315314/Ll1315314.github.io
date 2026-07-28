---
title: Don't let AI guess "did they buy?" — use real orders as ground truth
date: 2026-07-28
---

# Don't let AI guess "did they buy?" — use real orders as ground truth

> Judging whether a customer-service conversation ended in a sale, via keywords or an LLM, leaves accuracy permanently in question. Until we wired in the actual order data as the check.

## 1. The problem: you're asking AI to do something it isn't qualified to do

A lot of conversation-analysis systems carry an implicit assumption from day one: **the conversation text contains everything you need to know.** Which gives you an architecture like:

```text
conversation text → LLM / rule engine → converted? (✅/❌)
```

Based on what? Keyword matching plus semantic guessing. And that logic has a fatal flaw: **the chat log simply does not contain the fact of whether an order was placed.**

- A buyer saying "I placed the order" might be politeness, brush-off, or a real click that never got paid for.
- A large share of buyers who actually convert do so **silently** — they finish the conversation without a word and go complete payment in the app themselves. The traces they leave in the conversation are nearly indistinguishable from someone who was just browsing.

The result: our "converted" field had an **unknown rate approaching 90%** at one point. You think you're doing data analysis; you're actually wrapping a giant question mark in a beautiful report. More insidiously, even the 10% marked "known" had unverifiable accuracy — with no ground truth, you don't even know how wrong you are.

## 2. The turning point: the truth isn't in the text, it's in the database

One day it clicked: **whether someone bought was never a fact to be *inferred* from a conversation. It's a fact that was already settled somewhere else.**

The truth lives in the order system, in black and white, with timestamps, amounts, product IDs, buyer handles. You don't need to guess; you need to join. Flip that around and the architecture becomes:

```text
conversation text ──┐
                    ├──→ join → converted? (✅/❌, decided by order data)
order data        ──┘
```

The implementation is unglamorous: maintain a list of orders keyed on `platform, buyer` (platform + buyer handle), and let real purchase data override the AI's guess. Conversion rate goes from "aggregate the model's outputs" to plain data arithmetic:

```text
conversion rate = buyers who chatted AND appear in the order list / total buyers who chatted
```

A buyer's conversion status no longer depends on what they said in chat; it depends on **whether they actually paid**. The AI's guess is demoted to a hint; real orders became the referee.

## 3. An unexpected bonus: seeing the "silent buyer" gap

Once the two datasets were joined, a previously invisible population surfaced: **buyers with orders who never chatted at all** — silent purchasers who don't ask questions, don't comparison-shop, don't deliberate. Their existence has two important implications for the analysis:

**1. Re-evaluating what customer service is worth.** Without order data, you attribute every sale to "buyers who chatted." But some of those sales were going to happen regardless of whether support got involved. The silent-purchase ratio determines the true size of the **incremental** contribution from support — if 30% of sales are silent, support's contribution has to be recomputed from "0 → 100%" to "70% → 100%."

**2. A signal about traffic quality.** A high silent-purchase rate usually means strong brand trust, high repeat purchase, or low decision cost on the product. Conversely, if almost nobody buys silently, users broadly need a lot of conversation to convert — which may point to inadequate product descriptions, pricing that's too high, or a trust problem. None of these signals are visible from pure conversation analysis.

## 4. Reverse-filtering: what AI should and shouldn't do

This gave me a clearer framework for shipping AI: **any judgment for which you own a deterministic data source should be decided hard by that source, not softly inferred by a model.**

It sounds obvious, and it gets violated constantly — because "using AI looks sophisticated" and "wiring up the data integration is a chore." Applying it, the common tasks in conversation analysis sort out like this:

| Task | Deterministic ground truth exists? | Who should decide |
| --- | --- | --- |
| Did they buy | ✅ Yes (order system) | Hard: database |
| Did they refund | ✅ Yes (after-sales system) | Hard: database |
| Product category purchased | ✅ Yes (order line items) | Hard: database |
| Order value band | ✅ Yes (order amount) | Hard: database |
| Reason for loss | ❌ No ready ground truth | LLM inference |
| Buyer intent level | ❌ No ready ground truth | LLM inference |
| Conversation summary | ❌ No ready ground truth | LLM inference |
| Sentiment | ❌ No ready ground truth | LLM inference |

**AI is right for judgments where there is no ground truth, or where obtaining it is too expensive.** Any question the database already answers is one the model shouldn't touch — there it isn't doing "intelligent analysis," it's *trying to reconstruct a fact it could have simply read*, and reconstructing it badly.

## 5. A more general pattern: hard determination vs. soft inference

Abstract the above and you get a division of labor that applies to a lot of shipped agents:

```text
┌──────────────────────────────────────────────────────┐
│  Hard determination layer                            │
│  Sources: databases, logs, external APIs, sensors    │
│  Traits: deterministic, verifiable, cheap            │
│  Examples: converted?, refunded?, in stock?,         │
│            logged in?                                │
│  Owner: engineering code + database queries          │
├──────────────────────────────────────────────────────┤
│  Soft inference layer                                │
│  Sources: text, images, audio — unstructured data    │
│  Traits: uncertain, hard to verify, needs semantics  │
│  Examples: loss reasons, user intent, sentiment,     │
│            summarization                             │
│  Owner: LLM / multimodal models                      │
└──────────────────────────────────────────────────────┘
```

Mature agent systems tend to have **hard determination guarding the perimeter and soft inference doing the understanding in the core**. Take an e-commerce support agent: inventory, pricing, and order status are hard determinations (database), while how to reply, tone, and intent understanding are soft inference (model). **Hard determination owns "is it right"; soft inference owns "how to say it"** — separate jobs, no trespassing.

## 6. Beware the "all-AI" temptation

The industry has an implicit aesthetic right now: **the more "fully AI" a solution is, the more sophisticated it's assumed to be.** A system with lots of rules, SQL, and hard-coded logic somehow looks "not AI enough."

That aesthetic is toxic. Shipping agents is about **solving problems**, not demonstrating model capability. If your business data already contains a 100%-accurate answer and you choose to have an 80%-accurate model "predict" it, that isn't innovation — it's engineering negligence. **Real professionalism shows up in knowing when *not* to use AI.**

## 7. One line

When "did they buy" stops depending on a model reading between the lines and comes straight from the order table in black and white, all you lose is a little all-AI vanity — and what you gain is the credibility of the entire analytics system.

On the road to shipping AI, **restraint takes more courage than aggression, and deserves more respect.**
