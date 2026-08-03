---
title: The hard part of batch publishing isn't clicking buttons — it's bookkeeping
date: 2026-07-31
---

# The hard part of batch publishing isn't clicking buttons — it's bookkeeping

> One modulo expression solved the scheduling. The real work went into proving it can't get the math wrong: nearly 20 checks across 600 lines, all guarding against the same failure — "it ran perfectly, and then posted duplicates."

## 1. The problem

Ten cloud phones, one account each. A library of 225 videos and 225 captions. Requirements:

- Publish 1–2 rounds a day; each round, all ten devices post one item;
- **No account may ever post the same video twice**;
- After a round finishes, remember where we stopped and resume tomorrow;
- Once the cycle completes, every account has posted 225 unique items.

Doing one round by hand: create a task → select 10 devices → name it → switch to per-device mode → upload 10 videos → paste 10 captions → verify → publish. Ten-odd minutes, twice a day, for three months straight.

I assumed the problem to solve was "clicking is tedious." After writing it, I found that **clicking is the easy part**.

The hard part is bookkeeping. On round 87, which video goes to device 3? Maintain that in a spreadsheet and one misaligned cell means an account reposted something — and that error is **invisible at the time**. By the time you notice, dozens of rounds have piled up on top of it.

## 2. Compressing the state into a single integer

The scheduling rule ended up as one line:

```js
const poolIdx = (r, d) => (r - 1 + d - 1) % pool.length
```

Round `r`, device `d`, gets video `(r-1+d-1) mod N`. Expanded, it's a circular sliding window:

```text
round 1:  d1→v1   d2→v2   d3→v3   …  d10→v10
round 2:  d1→v2   d2→v3   d3→v4   …  d10→v11
round 3:  d1→v3   d2→v4   d3→v5   …  d10→v12
 …
round N:  d1→vN   d2→v1   d3→v2   …  (wraps around)
```

That single expression satisfies three requirements at once:

| Requirement | Why it holds |
| --- | --- |
| No repeats within an account | Device `d` walks the circular sequence `v[d], v[d+1], v[d+2]…`, covering each video exactly once over N rounds |
| Ten devices differ within a round | Within one round, different `d` always yields a different index — ten accounts never post the same item on the same day |
| **Progress is derivable** | No need to record "which device posted what"; only **the current round number** |

The third is the big win. The system's entire persisted state is one integer: `nextRound`.

**Less state, fewer places to be wrong.** Had I built a proper "device × video" posted-history table, it would have 2,250 rows, need concurrent-write handling, and need a rollback story for partial failures — none of which exist now.

For captions I made a tradeoff: all ten devices share caption `r`. Ten accounts post identical captions on a given day, but the caption sequence is inherently non-repeating in exchange. With a finite library, spending the "uniqueness budget" on video first is the better call.

One small design touch: a `--plan` flag prints the schedule for a human to verify:

```text
  round   1: videos #21~#30   caption 001.txt
  round   2: videos #22~#31   caption 002.txt
       …
  round 205: videos #225~#30 (wrapped)  caption 205.txt
```

**A purely mathematical rule that a human can verify in three seconds** beats ten lines of explanatory comments.

## 3. The formula has two premises, and both fail silently

For `(r-1+d-1) % N` to hold, two things must be true: **video numbering is stable, and device ordering is stable.**

Neither is automatic. Worse, when they break they **don't raise an error** — they just quietly start producing duplicates.

### Premise one: directory sort order will betray you

The first version was `readdirSync(dir).sort()`, with the index being the position in the sorted list.

The problem shows up three months later when you add new videos. If a new filename sorts into the middle, **the whole sequence shifts by one and every historical round's numbering is now wrong** — round 88's recorded "device 3 → #90" no longer points at the video it did back then.

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

The progress file is written in exactly one place, at the very end of the round. Any exception along the way leaves progress untouched.

Which is why the doc for non-technical teammates can simply say:

> **Will an error corrupt my progress? No.** Progress is only recorded after a full round completes. A mid-run failure changes nothing — just run it again.

This is applying the idea of a *transaction* to a 600-line script: either the whole round takes effect, or it never happened.

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
// A malformed argument must exit with an error, never silently fall back to the default —
// that would turn "just try 2 devices" into actually publishing to all 10.
```

`--limit 2` means "I only want to try this on two devices." If the user fat-fingers `--limit=abc`, a permissive parser falls back to `Infinity` and **actually operates on all ten**.

The user's intent was *be careful*; permissiveness turned it into *full send*. That's the worst class of failure.

Unknown arguments get the same treatment — a `consumed` set marks which indices were claimed, and anything left over triggers an error plus a printed list of valid flags. A typo yields a clear message rather than an unintended full run.

> **The rule: when the default behavior is more dangerous than failing, there shouldn't be a default.**

## 6. Assert on the page's own numbers

The platform's bulk-caption dialog treats **one line as one item**. My captions look like this:

```text
Body copy on one line…

#tag1 #tag2 #tag3
```

Body, blank line, hashtags. Paste that directly and the dialog counts it as **two items**. Ten devices need ten; it got twenty. Device 1 gets the body, device 2 gets the hashtags, device 3 gets the next caption's body — **everything shifts.**

And the misalignment isn't visually obvious: every row has content, so it looks filled in.

The fix is simple — flatten to one line on read. But **flattening alone isn't enough**; what if that logic breaks someday? So verify right after filling:

```js
const m = (await capDlg.innerText()).match(/共\s*(\d+)\s*份/)
if (m && Number(m[1]) !== N) {
  throw new Error(`Caption count mismatch: dialog shows ${m[1]}, expected ${N} (captions may not be flattened)`)
}
```

The dialog displays its own count. **A number the page already shows you is the best assertion available.**

The value here is that it doesn't rely on my confidence in my own code — it reads the system's actual state. Even if the platform changes how it splits items, the assertion still holds.

## 7. Assert on outcomes, not on steps

The flow includes a "target app check" dialog. I left this comment in the code:

```js
// Three observed behaviors: (1) appears → save → closes  (2) never appears, devices just get added
// (3) appears, but the save button greys out and it doesn't close.
// So this step is best-effort. The real success signal is "selected devices (N)" on the left.
```

Three behaviors, no pattern. Waiting for it unconditionally hangs on case 2; assuming it won't appear gets blocked by case 1.

The approach is to **give up on controlling that dialog**: if it shows up, try to save (fine if that fails), fall back to clicking the X if it doesn't close, everything wrapped in `.catch(() => {})`.

Then judge success by a signal completely independent of the process — the "selected devices (N)" counter on the page:

```js
const readSelected = () => page.evaluate(() => {
  const m = document.body.innerText.match(/已选云手机\s*[（(]\s*(\d+)\s*[)）]/)
  return m ? Number(m[1]) : -1
})
```

Poll it; proceed only once it reads greater than zero.

> **Don't assert "I clicked the right button" — assert "the state I wanted was reached."** How many branches the intermediate steps have doesn't matter; the outcome does.

The same thinking applies to waiting for uploads: rather than waiting for a loading indicator to disappear, it requires **two consecutive samples with an unchanged count**. Mid-upload the DOM item count can momentarily equal the target (placeholders render first), and proceeding then would submit empty files.

### Postscript: three days later, the page was redesigned

Three days after writing this, the platform shipped a redesign.

"Bulk upload video" and "Bulk captions" used to be two separate cards (`.fbp-card--file` / `.fbp-card--text`). They became a small **"bulk" button in the column header** of the per-device table — both columns sharing the class `.fbp-col-batch`, distinguishable only by the `title` attribute. The "unified settings" dropdown gained a wrapper element, and the piece of copy I used to detect "are we already in per-device mode" **disappeared from the page entirely**.

All three broke. The fix took 14 lines:

```js
const candidates = [
  page.locator(`button.fbp-col-batch[title="${conf.title}"]`),   // new layout
  page.locator(`${conf.oldCard} .fbp-card__btn`),                // old layout
  page.locator('.fbp-col-head').filter({ hasText: conf.colLabel }).locator('.fbp-col-batch').first()  // fall back to header text
]
for (const btn of candidates) {
  if (await btn.count() > 0) { await btn.first().click(); return dialogByTitle(page, conf.title) }
}
throw new Error(`Can't find the entry button for "${conf.title}" — the page may have changed again`)
```

Likewise, the "already in per-device mode" check moved from **matching a piece of copy** to **checking whether the table element exists** — copy gets rewritten by product, structure is comparatively stable.

But what actually kept this to 14 lines wasn't clever selectors. It was that the original failure mode was **"throw and stop," not "not found, skip it."**

Imagine the other implementation: `if (btn) btn.click()`, silently skipping when the button is missing. On redesign day the script would have **run all the way through**, printed a tidy six-step progress log, and produced a table with **no videos and no captions** — something I'd only catch when looking at the screenshot, or worse, not catch before clicking Publish.

> Surviving a redesign isn't about writing selectors that always match. It's about **whether the code speaks up when they don't.**

## 8. It never clicks "Publish"

When the script finishes, it prints:

```text
══════════════════════════════════════════
  Form is filled. The script will NOT click Publish.
  Review the page and click Publish yourself.
  Didn't publish this round? bash publish.sh --redo
══════════════════════════════════════════
```

Adding `click('Publish')` would be one line. Why it isn't there:

**Before Publish, everything is reversible — close the page and nothing happened. The moment it's clicked, ten items land on ten real accounts, publicly, irreversibly.**

Every check described above lowers the probability of filling the form wrong. But probability never reaches zero: the platform can change, the network can hiccup, there may be a fourth dialog behavior I never saw. So a **human confirmation** sits at the end — **a line of defense that doesn't depend on my having anticipated everything.**

This buys something very practical too: **because it doesn't publish, you can run it freely.** `--redo` is safe to write, `--limit 2` is safe to try, and a bad run is fixed by closing the page.

Conversely, a script that publishes on its own makes every run a gamble — so you **stop testing it**, and untested tools rot faster.

The same principle drives `--dry` (print this round's manifest) and `--plan` (print the full schedule): both are intercepted at the shell layer and never launch a browser at all. Which lets the docs say "run these as often as you like, they change nothing." **Give users an absolutely safe way to explore, and they'll actually use the tool.**

## 9. Counting up those 600 lines

I went back and counted the `throw` and `exit(1)` sites — close to 20:

| Check | What it prevents |
| --- | --- |
| Invalid / unknown arguments | "Try 2 devices" becoming "publish to 10" |
| Progress file missing but index present | Re-publishing the entire back catalogue |
| Video file missing | Index shift, whole schedule corrupted |
| Available videos < devices per round | Duplicates within a single round |
| Not logged in / empty device list | Blindly clicking on the wrong page |
| Selected count ≠ `--limit` | Publishing to devices you didn't intend |
| "Selected devices" unreadable or 0 | Devices never actually got added |
| Key control not found | Page redesigned; everything after is blind |
| Device count ≠ round size | Missing required field breaks publishing |
| **Device order changed** | Breaks the per-account no-repeat guarantee |
| Upload failed / timed out | Submitting empty files |
| **Caption count ≠ expected** | Captions shifted across every device |

The code that actually *operates the page* — clicking, typing, uploading — is maybe 150 lines. Everything else answers one question: **how do I know it isn't quietly doing the wrong thing?**

That ratio isn't over-engineering. This script's failure mode **isn't "errors out and stops"** — it's **"runs perfectly, and ten accounts post duplicates."** The first is immediately visible; the second gives no signal at all.

**When failure is silent, defense has to be explicit.**

## 10. Half the reliability lives in the README

The last thing that surprised me: the usage doc ran to 300 lines, longer than the core logic.

Because the actual operators don't write code. "cd into the directory" isn't a known concept for them, so the doc says: type `cd ` and then **drag the folder into the terminal window**.

But the section that matters most is "**things you must never do**" — four items, each stating the consequence:

> 1. Don't delete the index or progress files — **this causes already-published videos to be re-published**
> 2. Don't rename or delete videos — the filename *is* the index; changing it corrupts the whole numbering
> 3. **Don't run this on two computers** — progress is local; two people running it independently causes duplicate publishing
> 4. Don't hand-edit the round number — use `--redo` to re-run the last round

Item 3 can't be solved in code. Progress lives in a local file, which inherently doesn't support multi-machine use. I could move it to a server, add a lock — but for an internal tool, **writing it down and agreeing that one person runs it is the more appropriate cost.**

Recognizing which problems to solve with code and which to solve with a convention is itself part of the design.

There's also an error-lookup table mapping each `throw` to what a human should do:

| Error contains | Meaning | What to do |
| --- | --- | --- |
| `not logged in` | Session expired | Log in again, re-run |
| `device order changed` | Device list reordered | **Don't fix it yourself** — ask an engineer |
| `upload timed out` | Slow network or full storage | Check network; clear cloud storage |

That table can only exist because **every error message is distinctive enough to be searched for**. `throw new Error('failed')` makes it impossible.

## 11. In one sentence

A modulo expression solved the scheduling and compressed the system's entire state into a single integer. The other 450 lines verify that the formula's premises haven't been broken.

**If a system's failures are silent, "it ran without errors" is not evidence of correctness.** You have to actively check the assumptions that make it work — and the moment one of them breaks, **stop, instead of carrying on.**
