---
title: The hard part of batch publishing isn't clicking buttons — it's bookkeeping
date: 2026-07-31
---

# The hard part of batch publishing isn't clicking buttons — it's bookkeeping

> One modulo expression solved the scheduling. The real work went into proving it can't get the math wrong: 630 lines hiding 25 deliberate aborts across 12 categories, all guarding against the same failure — "it ran perfectly, and then quietly did the wrong thing."

## 1. The problem

Ten cloud phones, one account each. The library holds 225 videos, but the first 20 (#1–#20) were already posted elsewhere, leaving 205 usable this time. Requirements:

- Publish 1–2 rounds a day; each round, all ten devices post one item;
- **No account may ever post the same video twice**;
- After a round finishes, remember where we stopped and resume tomorrow;
- Once the cycle completes, every account has posted 205 unique items (at two rounds a day, about 103 days).

Doing one round by hand: create a task → select 10 devices → switch to per-device mode → upload 10 videos → paste 10 captions → verify → publish. Ten-odd minutes, twice a day, for three months straight.

I assumed the problem to solve was "clicking is tedious." After writing it, I found that **clicking is the easy part**.

The hard part is bookkeeping. On round 87, which video goes to device 3? Maintain that in a spreadsheet and one misaligned cell means an account reposted something — and that error is **invisible at the time**. By the time you notice, dozens of rounds have piled up on top of it.

## 2. Compressing the state into a single integer

The scheduling rule ended up as one line:

```js
const poolIdx = (r, d) => (r - 1 + d - 1) % pool.length
```

Round `r`, device `d`, gets video `(r-1+d-1) mod N`. Expanded, it's a circular sliding window:

```text
round   1:  d1→v21   d2→v22   d3→v23   …  d10→v30
round   2:  d1→v22   d2→v23   d3→v24   …  d10→v31
round   3:  d1→v23   d2→v24   d3→v25   …  d10→v32
 …
round 205:  d1→v225  d2→v21   d3→v22   …  (wraps around)
```

That single expression satisfies three requirements at once:

| Requirement | Why it holds |
| --- | --- |
| No repeats within an account | Device `d` starts at `v[20+d]` and walks the circle forward, covering each video exactly once over 205 rounds |
| Ten devices differ within a round | Within one round, different `d` always yields a different index — ten accounts never post the same item on the same day |
| **Progress is derivable** | No need to record "which device posted what"; only **the current round number** |

The third is the big win. The system's entire persisted state is one integer: `nextRound`.

**Less state, fewer places to be wrong.** Had I built a proper "device × video" posted-history table, it would have 2,050 rows, need concurrent-write handling, and need a rollback story for partial failures — none of which exist now.

For captions I made a tradeoff: all ten devices share caption `r`. Ten accounts post identical captions on a given day, but the caption sequence is inherently non-repeating in exchange. With a finite library, spending the "uniqueness budget" on video first is the better call.

One small design touch: a `--plan` flag prints the schedule for a human to verify:

```text
  round   1: videos #21~#30   caption 001.txt
  round   2: videos #22~#31   caption 002.txt
       …
  round 205: videos #225~#29 (wrapped)  caption 205.txt
```

**A purely mathematical rule that a human can verify in three seconds** beats ten lines of explanatory comments.

## 3. The formula has two premises, and both fail silently

For `(r-1+d-1) % N` to hold, two things must be true: **video numbering is stable, and device ordering is stable.**

Neither is automatic. Worse, when they break they **don't raise an error** — they just quietly start producing duplicates.

### Premise one: directory sort order will betray you

The first version was `readdirSync(dir).sort()`, with the index being the position in the sorted list.

The problem shows up three months later when you add new videos. If a new filename sorts into the middle, **the whole sequence shifts by one and every historical round's numbering is now wrong.**

The fix is to **freeze** the numbering into a `video-index.json`, with two rules:

- **New files may only be appended** to the end, never re-sorted;
- **A missing file aborts the run.**

The second rule matters most. When a file disappears, the lazy implementation skips it and carries on — but that shifts every subsequent index down by one. So instead it stops, prints the missing filenames, and asks a human to restore them.

### Premise two: the page's ordering will betray you too

The cloud-phone list order isn't mine to control. It can change from a platform redesign, a sorting-rule tweak, or one device rebooting. Once it changes, "device 3" isn't the same device anymore and the circular window falls apart — **while the page looks completely normal.**

So the first round records the device order into the progress file, and every later round compares against it:

```js
} else if (prog.deviceOrder.join(',') !== deviceRows.join(',')) {
  console.error('\nDevice order differs from round 1; continuing would break the no-repeat guarantee:')
  console.error(`  round 1: ${prog.deviceOrder.join(', ')}`)
  console.error(`  this run: ${deviceRows.join(', ')}`)
  throw new Error('Device order changed — aborted')
}
```

Note that the error **prints both orderings**. "Device order changed" alone is useless — the human can't decide what to do. Put the two lines side by side and it's immediately obvious whether one device moved or the whole list got re-sorted.

> What these two checks share: **a rule's premises must be verified explicitly, not assumed.** A formula that depends on premises it never checks isn't "correct" — it's just "not wrong yet."

## 4. Progress: only a fully successful round gets written

In the normal publishing flow, the progress file is written in exactly one place, at the very end of the round. Any exception along the way leaves progress untouched.

> Note: swapping in a whole new batch of material (`runNewCycle`) performs one additional reset write, which isn't part of the day-to-day publishing path.

Which is why the doc for non-technical teammates can simply say:

> **Will an error corrupt my progress? No.** Progress is only recorded after a full round completes. A mid-run failure changes nothing — just run it again.

This is applying the idea of a *transaction* to a 630-line script: either the whole round gets filled in, or it never happened. Publishing itself sits outside the transaction and requires a human.

For a tool that runs daily, is operated by non-engineers, and where errors are routine, that property is worth more than any amount of fine-grained exception handling: **the user only ever has one decision to make — re-run.**

### Related: what if the progress file is gone?

One combination deserves special handling: **progress file missing, but the index file present.**

There's basically one explanation — someone deleted it. The naive implementation treats this as a first run and starts at round 1, whose content went out three months ago. Ten accounts would collectively repost old videos.

So it stops, spells out the consequence, and demands an explicit confirmation flag:

```text
progress.json is missing, but video-index.json exists.
Continuing would re-publish everything starting from round 1.
To start over deliberately, run: bash publish.sh --yes
```

**When you can infer the user probably made a mistake, don't execute the mistake on their behalf.**

## 5. When a default is more dangerous than an error

For argument parsing, the comment is the rationale:

```js
// Accepts three forms: --limit 2 / --limit=2 / --limit2
// A malformed value must exit with an error, never fall back to the default —
// that would turn "just try 2 devices" into a real run across all 10.
```

`--limit 2` means "I only want to test the waters with two devices." If the user slips and writes `--limit=abc`, a permissive parser falls back to `Infinity` and then **really does operate on all ten**.

The user's intent was "be careful," and permissiveness turned it into "run everything." That's the worst class of failure.

Unknown arguments get the same treatment — a `consumed` set marks which indices were claimed, and whatever's left over is unrecognized, triggering an error plus a printout of the valid flags. A typo gets you an explicit message rather than an unintended full run.

> **The rule: when the default behavior is more dangerous than failing, there shouldn't be a default.**

## 6. Assert on the page's own numbers

The platform's bulk-caption dialog treats **one line as one caption**. Mine look like this:

```text
The body text on one line…

#tag1 #tag2 #tag3
```

Body, blank line, tag line. Paste that in and the dialog counts it as **two**. Ten devices need ten captions; it got twenty. Device 1 gets the body, device 2 gets the tags, device 3 gets the next caption's body — **everything shifts out of alignment.**

And the misalignment isn't visually obvious: every row has content, so it looks filled in.

The handling is simple — flatten to one line on read. But **flattening alone isn't enough** — what if that logic breaks someday? So it verifies immediately after filling:

```js
const m = (await capDlg.innerText()).match(/共\s*(\d+)\s*份/)
if (m && Number(m[1]) !== N) {
  throw new Error(`Caption count mismatch: dialog shows ${m[1]}, expected ${N} (captions may not be flattened)`)
}
```

The dialog displays its own count. **A number already on the page is the best assertion you can get.**

The value here is that it doesn't rely on my confidence in my own code; it reads the system's actual state. As long as the dialog still shows that number, the assertion holds — but conversely, **change the wording and it fails silently**, which is exactly the subject of the next section.

## 7. Assert on outcomes, not on steps

There's a "target app check" dialog in the flow. I left this comment in the code:

```js
// Three observed behaviors: ① pops up → save → closes ② never appears, devices just get added
// ③ appears, but the save button greys out and it won't close.
// So this step is best-effort; the real success criterion is "selected phones (N)" on the left.
```

Three behaviors, no pattern. Waiting for it hangs in case ②; assuming it won't appear gets blocked in case ①.

The approach is to **give up trying to control the dialog**: if it shows, try to click save (fine if that fails); if it won't close, fall back to clicking the X; wrap everything in `.catch(() => {})`.

Then **judge success by an outcome indicator that's independent of the path** — the "selected phones (N)" counter on the page:

```js
const readSelected = () => page.evaluate(() => {
  const m = document.body.innerText.match(/已选云手机\s*[（(]\s*(\d+)\s*[)）]/)
  return m ? Number(m[1]) : -1
})
```

Poll it, and only proceed once it reads greater than zero.

> **Don't assert "I clicked the right button"; assert "the state I wanted was reached."** How many branches the intermediate process has doesn't matter — the outcome does.

The same thinking applies to waiting for uploads: rather than waiting for some loading indicator to disappear, it requires **two consecutive samples with an unchanged count**. Mid-upload the DOM's item count can momentarily equal the target (placeholders render first), and proceeding then would upload empty files.

### Postscript: three days later, the page really did get redesigned

Three days after writing this, the platform shipped a redesign.

"Bulk upload video" and "bulk caption" used to be two separate cards (`.fbp-card--file` / `.fbp-card--text`). After the redesign they became **a small "batch" button in the per-device table's column headers** — both columns share the class `.fbp-col-batch`, distinguishable only by the `title` attribute. And the line of text I'd used to detect "are we in per-device mode yet" **disappeared entirely** from the new page.

All three broke. Adapting took 14 lines:

```js
const candidates = [
  page.locator(`button.fbp-col-batch[title="${conf.title}"]`),   // ① new: distinguish by title
  page.locator(`${conf.oldCard} .fbp-card__btn`),                // ② old: the original card
  page.locator('.fbp-col-head').filter({ hasText: conf.colLabel }) // ③ fallback: by column label
      .locator('.fbp-col-batch').first()
]
for (const btn of candidates) {
  if (await btn.count() > 0) { await btn.first().click(); return dialogByTitle(page, conf.title) }
}
throw new Error(`Can't find the entry button for "${conf.title}" — VMOS may have changed the page again`)
```

Likewise, the "are we in per-device mode" check moved from **matching a line of copy** to **checking whether the table element exists** — copy gets rewritten by product, structure is comparatively stable.

But what actually kept this adaptation to 14 lines isn't clever selectors. It's that **its failure mode had always been "raise and stop," not "skip if not found."**

Picture the alternative: `if (btn) btn.click()`, silently skipping. On redesign day the script would have **run start to finish**, printed a tidy six-step progress log, and produced **a table with no videos and no captions** — and I'd only have caught it when looking at the screenshot, or worse, after casually hitting publish.

> Surviving redesigns isn't about writing precise selectors. It's about **whether it shouts when a selector misses.**

### The redesign also exposed a few places that don't shout

The redesign worked like a surprise inspection, forcing me to re-read every piece of logic. Counting the "共 N 份" wording dependency from the previous section, there are **four places that should have stopped and didn't**. Two of them do have a corresponding abort (caption count, upload timeout) — the condition just left a back door open. The other two have no abort at all.

**First: the "flying blind" pass in the upload wait.** While waiting for an upload to finish, if every selector misses, `snap.count` returns `-1` — and the original condition actually included `snap.count < 0` as a pass. So when the selectors all break, the script concludes "upload complete" and moves on. This one counts among the 25 aborts (the timeout path), but the condition is far too permissive, leaving a back door for a silent pass.

**Second: the device list breaks out too early.** The device list loads asynchronously, and the loop used to break as soon as `count() > 0`, possibly with only two of ten rendered. That's just loop control — there's no accompanying `throw`. Fortunately `deviceRows.length !== N` catches it downstream, so it doesn't run silently wrong; but it can click "select all" mid-render, check only some of the boxes, and then get stopped by that later check — manufacturing an avoidable false error and confusing the user for no reason.

**Third: the table check only logs, never stops.** After filling the table it merely `console.log`s how many rows have videos and how many have captions, and never intervenes. If a run failed to upload videos, the script still proceeds to write progress and tell the user to go hit publish. Again, just a log line with no abort logic behind it.

What they share is that **none of them shout where they should** — the first two either wave things through or push the problem downstream, and the third says nothing at all. Until these are fixed, those 25 deliberate aborts have gaps in them. The third is the most telling: because the stop would happen *before* the progress file is written, adding a `throw` means progress never advances and the user can simply re-run — but as it stands, it doesn't even shout.

Worth noting is the screenshot logic. The script already captures a screenshot at key steps, e.g. `result-screenshots/round002-1785731627404.png` (round number included). The fix isn't to add a new screenshot but to **reuse the existing one, moved ahead of the `throw`**, so an abort always leaves evidence behind.

## 8. It will never click "Publish"

When the script finishes, the last thing it prints is:

```text
══════════════════════════════════════════
  The form is filled in. This script will not click "Publish".
  Please review it yourself and click "Publish" at the bottom right.
  Didn't publish this round? Re-run: bash publish.sh --redo
══════════════════════════════════════════
```

Adding a `click('Publish')` line is entirely feasible. The reason not to:

**Before "Publish" is clicked, everything is reversible — close the page and nothing happened. The moment it's clicked, ten items land in ten real accounts, publicly visible, unrecallable.**

All those checks exist to lower the probability of filling the form wrong. But the probability never reaches zero: the platform can be redesigned, the network can hiccup, there may be a fourth dialog behavior I never anticipated. So the last line of defense is **a human confirmation** — **a defense that doesn't depend on me having thought of everything.**

This design buys something very practical too: **because it doesn't publish, you can run it freely.** `--redo` is safe to write, `--limit 2` is safe to try, and if a run goes wrong you just close the page and start over.

Conversely, a script that publishes on its own makes every run a gamble, and you end up **afraid to test it** — and a tool nobody dares test rots faster.

The same logic shows up in `--dry` (print this round's manifest only) and `--plan` (print the whole schedule): both are intercepted at the shell layer and never launch a browser at all. Which is why the docs can say "run these whenever, they can't affect anything." **Give the user a completely safe way to explore and they'll actually use the tool.**

## 9. Taking stock of these 630 lines

I went back and counted the `throw new Error` calls (21) and `process.exit(1)` calls (4) — 25 deliberate aborts, which group into these categories:

| Check | What it prevents |
| --- | --- |
| Invalid / unknown argument | "Try 2 devices" turning into a real run on 10 |
| Progress file missing but index present | Republishing an entire batch that already went out |
| Video file missing | Index drift corrupting everything downstream |
| Usable videos < devices per round | Duplicates within a single round |
| Not logged in / empty device list | Clicking blindly on the wrong page |
| Checked count ≠ `--limit` | Posting to devices that weren't asked for |
| "Selected phones" unreadable or 0 | Devices never actually got added |
| Key control not found | A redesign turning everything after it into blind operation |
| Device count ≠ items this round | A required field left empty, failing the publish |
| **Device order changed** | Breaking the per-account no-repeat guarantee |
| Upload failure / timeout | Uploading empty files (has a gap — see the postscript) |
| **Caption count ≠ expected** | Captions shifted out of alignment across the board |

The code that actually *operates the page* — clicking buttons, filling inputs, uploading files — is 150 lines at most. Everything else answers one question: **how do I know it isn't quietly doing the wrong thing?**

That ratio isn't over-engineering. That a 630-line script stops in 25 different places is itself a statement about the problem. This script's failure mode **isn't "raise an error and stop"** — it's **"run perfectly, and then ten accounts post duplicates."** The former is immediately visible; the latter gives no signal whatsoever.

**When failure is silent, the defense has to be explicit.**

## 10. Half of the reliability lives in the README

The last thing that surprised me: the usage guide runs 305 lines, longer than the core logic.

Because the actual users don't write code. "cd into the directory" isn't a concept they have, so the doc has to say: type `cd ` and then **drag the folder straight into the terminal window**.

But the part that really matters is the "**things you must never do**" section — four items, each with its consequence spelled out:

> 1. Don't delete the index or progress file — **it will cause already-published videos to go out again**
> 2. Don't rename or delete videos — the filename *is* the index; changing it corrupts the whole numbering
> 3. **Don't run it on two computers at once** — progress lives locally; two people running independently will produce duplicates
> 4. Don't hand-edit the round number in the progress file — use `--redo` to repeat a round

Item 3 isn't solvable in code. Progress lives in a local file, which inherently doesn't support multi-machine collaboration. I could move it to a server, I could add locking — but for an internal tool, **writing it down and agreeing that only one person runs it is the more appropriate cost.**

Recognizing which problems to solve with code and which to solve with an agreement is itself part of the design.

There's also an error lookup table mapping each `throw` message to "what a human should do":

| Error contains | Meaning | What to do |
| --- | --- | --- |
| `未登录` (not logged in) | The session expired | Log in again, then re-run |
| `设备顺序变化` (device order changed) | The cloud-phone ordering changed | **Don't fix it yourself** — ask an engineer |
| `等待上传超时` (upload timed out) | Slow network, or the cloud drive is full | Check the network; clear out the cloud drive |

That table can only exist because **every error message is distinctive enough to be searched for**. `throw new Error('failed')` makes this impossible.

## 11. In one sentence

One modulo expression solved the scheduling and compressed the entire system's state into a single integer; the remaining several hundred lines all verify that the formula's premises haven't been broken.

**If a system's failures are silent, its correctness can't be demonstrated by "it ran without errors."** You have to go check the assumptions that make it work — and the moment one of them breaks, **stop, instead of carrying on.**

A 630-line script that chooses to stop in 25 different places isn't timid. It's accountable.
