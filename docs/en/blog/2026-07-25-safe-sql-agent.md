---
title: Let the model write SQL without over-reaching — designing a CS analytics agent
date: 2026-07-25
---

# Let the model write SQL without over-reaching — designing a CS analytics agent

> I built a customer-service analytics agent on Claude's tool use that can query data on its own. The hard part was never "make it able to query." It was "make it query safely, not burn money, and not make things up." The biggest lesson since launch: giving a model freedom is easy; the hard part is welding the boundaries shut with deterministic systems at the same time.

## 1. Why an agent instead of more report endpoints

This started with a real request from the ops team. The questions they wanted to ask were **open-ended and compositional**:

> "Among customers who came from Xiaohongshu last week, chatted with us, but didn't buy — what are the top 3 reasons we lost them?"

Unpack that and there are five dimensions: time (last week), acquisition channel (Xiaohongshu), a behavioral condition (chatted), an outcome filter (didn't buy), and an analysis goal (ranked loss reasons). The traditional route is: file a request → someone writes SQL → configure a BI dashboard → ops drags filters around. That loop takes half a day to a week. What ops actually needs is **seconds from idea to answer**.

So I handed "natural language → data query → conclusion" to the model to orchestrate, and kept my own job to providing trustworthy primitives. The model gets exactly **six** tools:

| Tool | Purpose | Design intent |
| --- | --- | --- |
| `get_stats` | Fixed-definition stats (totals, conversion rate) | Fast, controlled, deterministic |
| `get_category_breakdown` | Category rankings (top-N analysis) | Pre-baked aggregation, so the model never hand-writes complex GROUP BY |
| `get_sessions` | Session-level detail queries | Bounded scope, no free-form SQL |
| `get_lost_reasons` | Loss-reason analysis | Calls pre-built analysis logic |
| `batch_search` | Bulk keyword search | Keeps `LIKE '%kw%'` (the full-scan killer) out of free-form SQL |
| `query` | Constrained free-form SQL | Only for genuinely open-ended cross-table analysis |

The design philosophy is explicit: **fixed definitions get dedicated tools; only open-ended analysis gets free-form SQL.** The former is a highway, the latter is off-road — not forbidden, just only opened when actually needed.

## 2. Challenge one: let the model write SQL, but never over-reach

This is the most dangerous part of the whole system. If the model ever emits `DROP TABLE` or `UPDATE users SET balance=999999`, the consequences don't bear thinking about.

Most people's first instinct is "just say so clearly in the prompt." **That's the weakest possible defense.** The prompt is the outermost layer and the easiest to route around — the model can violate it through context pollution, adversarial input, or even its own "creativity" (deciding it needs a temp table to help with the analysis). Guarding with a prompt is like taping a "please do not enter" sign to a vault door.

My approach is **defense in depth**, where each layer stops something different:

```text
┌──────────────────────────────────────────────────────────┐
│  Layer 1: string allowlist validation                    │
│  · must start with SELECT (startsWith, not a regex)      │
│  · reject any blacklisted keyword: INSERT/UPDATE/DELETE/  │
│    DROP/ALTER/TRUNCATE/CREATE/EXEC/LOAD/INTO OUTFILE/    │
│    DUMPFILE                                              │
│  Purpose: fail fast on obvious write operations          │
├──────────────────────────────────────────────────────────┤
│  Layer 2: table allowlist                                │
│  · the query must hit chat_messages / session_analysis   │
│  Purpose: shrink reachable surface to the minimum the    │
│  analysis actually needs                                 │
├──────────────────────────────────────────────────────────┤
│  Layer 3: resource limits                                │
│  · force LIMIT 500 (strip any user LIMIT, then append)   │
│  · query timeout protection                              │
│  Purpose: stop a full scan or huge result set from       │
│  dragging the database down                              │
└──────────────────────────────────────────────────────────┘
```

In code it's a handful of unglamorous checks:

```java
if (!upper.startsWith("SELECT")) return error("SELECT queries only");
if (upper.contains("INSERT") || upper.contains("DROP") || ...) {
    return error("contains a forbidden write keyword");
}
// must hit an allowlisted table, then force-append LIMIT 500
```

### But let's be honest: string validation isn't the finish line

I'm well aware of the soft spot here — **string/keyword detection can always be bypassed**: case mangling, comment injection, encoding tricks, `UNION`-ing in a malicious subquery. As long as you're fighting at the string level, the attack/defense game has no end. And "must hit an allowlisted table" is a substring check: it guarantees the query *references* an allowlisted table, but it can't fully guarantee it doesn't *also* touch something else.

The genuinely reliable foundation shouldn't be "I inspect what it wrote." It should be "**even if it writes something bad, the database has no permission to execute it**" — i.e. run this SQL through a **separate read-only account / read-only connection**, so `INSERT/UPDATE/DELETE/DROP` is blocked at the database permission layer.

**That layer isn't in place yet, and it's the next hardening item on my list.** What's holding the line in production today is those three application-layer checks plus the read-only nature of the use case (this agent only analyzes; it never writes). I'm stating that plainly, because knowing where the correct answer lives and having it scheduled beats pretending it's already done.

That's the attitude I want to pass on: **the mark of engineering maturity isn't "no holes." It's knowing exactly which holes you haven't plugged, and having a plan to plug them.**

## 3. Challenge two: don't let it burn money spinning

Right after launch I noticed something: the model loves to "cross-verify" repeatedly. Its pattern was — query once and get a preliminary answer, feel not-quite-confident and query from another angle, think of a possible gap and query a third time, want to confirm an edge case and query a fourth. Every round costs tokens and adds latency, and the accuracy of the conclusion barely improves. It's a perfectionist re-checking their homework while ops just wants the answer.

Worse, each free-form SQL call can touch a lot of data. Unconstrained, a single conversation's cost can balloon 5–10×.

**The fix: a budget gate in the system prompt.** Three hard constraints:

```text
1. Keyword search must go through batch_search; LIKE '%kw%' in free-form
   SQL is forbidden (it triggers a full scan — slow and expensive)
2. Cross-table analysis gets ONE query call; answer from the result,
   don't append "verification" queries
3. If one query can't cover it, give a partial conclusion based on what
   you have plus a note on what's missing — don't re-query from new angles
```

This isn't capping the model's ability; it's constraining its degrees of freedom to "enough." Like a good consultant, who doesn't research a question infinitely deep but delivers a good-enough answer within a given budget. Constraints aren't shackles — they're what makes a system predictable and controllable.

## 4. Challenge three: 500 rows will blow up the context

Free-form SQL can return hundreds of rows. Stuffing them back verbatim causes three problems: **token explosion** (tens of thousands of tokens eating the budget in one shot), **truncation risk** (output cut off mid-stream near the limit), and **the mental-arithmetic trap** (handed a pile of raw rows, the model tends to aggregate and sort by hand in-context — exactly what it's worst at).

**The fix: return a summary.** `query`'s return value is a deliberately designed summary (this is the real response shape):

```json
{
  "ok": true,
  "rows": 347,
  "columns": ["date", "buyer", "platform", "lost_reason"],
  "samples": [
    {"date": "2026-05-14", "buyer": "u_82391", "platform": "Xiaohongshu", "lost_reason": "price too high"},
    {"date": "2026-05-15", "buyer": "u_47201", "platform": "Xiaohongshu", "lost_reason": "comparing competitors"}
  ],
  "truncated": true
}
```

The model gets **row count + column structure + at most 3 samples** (long text fields further truncated to 60 characters). From that it judges trend and magnitude; if it needs detail, it narrows the conditions and re-queries. The principle underneath: **the model should do understanding and explanation, not storage and computation.**

## 5. Challenge four: streaming output and hallucination control

**Streaming uses SSE, not WebSocket.** This scenario is one-directional and server-pushed: model thinking → push "analyzing…", tool call → push "querying the database…", result → push the answer. There's no need for high-frequency bidirectional traffic. SSE is HTTP-based, simple to implement, reconnects naturally, and is easy to debug — the right answer for a "server-driven, client-passive" agent.

**Hallucination is handled architecturally, not morally.** My position is blunt: **the agent will get numbers wrong** — its training objective is "generate a plausible next token." Rather than praying it won't, minimize the blast radius. The core strategy is **pushing computation down**:

| Pushed down to deterministic systems | Left to the model |
| --- | --- |
| `COUNT(*)`, sums, averages, percentages | Trend judgment |
| `ORDER BY`, `GROUP BY` | Interpreting causes, summarizing |
| Time-range filtering | Generating recommendations, natural-language phrasing |

All exact numeric computation is pushed into SQL; the model only orchestrates (decides what to query) and explains (tells the user what it means). One small but important detail: when `max_tokens` truncates, handle the "was there a `tool_use`" case separately — if it was cut off mid tool-call, don't let it spin a wasted round; terminate and ask the user to simplify the question.

## 6. Summary: grant freedom, weld the boundaries

The single biggest lesson from building this: **give the model freedom, and let deterministic systems hold the boundary.** This division of labor across four dimensions is what settled out after repeatedly stepping on rakes:

| Dimension | Who guarantees it | Mechanism |
| --- | --- | --- |
| Can it over-reach | App layer + DB layer | Keyword/table allowlist checks (today) + read-only connection (next) |
| Will it burn money | Orchestration layer | Prompt budget gate + tool-call limits |
| Will it blow up context | Tool layer | Summarized result payloads |
| Will it miscalculate | Execution layer | Computation pushed into SQL; the model only orchestrates |

## 7. A more general pattern: the agent "sandwich"

Abstract the above and you get an architecture that applies to a lot of data-analysis agents:

```text
┌───────────────────────────────────────────────────┐
│  Top: natural-language interface (user input)     │
│  High freedom, but untrusted                      │
├───────────────────────────────────────────────────┤
│  Middle: agent orchestration (model + tool defs)  │
│  · picks tools, translates intent into params     │
│  · translates tool results back to language       │
│  · bounded by the budget gate                     │
├───────────────────────────────────────────────────┤
│  Bottom: deterministic systems (DB / rules)       │
│  · SQL execution + exact computation              │
│  · permissions and scope (allowlist, LIMIT,       │
│    timeout)                                       │
│  Trustworthy, but inflexible                      │
└───────────────────────────────────────────────────┘
```

The model lives in the middle layer: it absorbs arbitrary user expression from above and is constrained by hard limits from below. It isn't "freely exploring the data" — it's playing by the rules inside a carefully built playground. The freedom inside the fence is more than enough for the overwhelming majority of questions, and the fence itself makes sure it can't hurt itself or anyone else.

## 8. One last line

**Let the AI orchestrate, understand, and generate; leave precision and ground truth to deterministic systems.**

Simple to say, and genuinely doing it means asking yourself one question at every dimension: "if this judgment is wrong, what catches it?" Where there's a backstop, let the model go. Where there isn't, write the code honestly. And where you know a backstop *should* exist but doesn't yet (a read-only DB connection, say), listing it openly and scheduling it beats pretending it's already there.

In shipping agents, restraint isn't a ceiling on capability — it's a marker of engineering maturity.
