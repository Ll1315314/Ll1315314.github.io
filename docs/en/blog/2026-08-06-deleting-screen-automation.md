---
title: Deleting 1,500 lines of automation — there was a specific screen encoded in the pixel threshold
date: 2026-08-06
---

# Deleting 1,500 lines of automation — there was a specific screen encoded in the pixel threshold

> Moving from a 13" to a 16" display, the script stopped selecting files — and then reported "upload complete" anyway. Fixing it meant re-calibrating a threshold on every machine, and this tool goes out to several non-technical colleagues. In the end I deleted the whole automation layer and kept only the part a human gets quietly wrong.

## 1. Same problem, two kinds of interface

The last post covered the VMOS batch-publishing script: 10 cloud phones, 205 videos, one modulo expression handling the schedule. This one is its sibling project — the same scheduling logic, targeting **GeeLark** instead.

The scheduling half was carried over nearly verbatim:

```python
# Round r, device d (0-based) → video [(r-1+d) mod N]; all 10 share caption r
# round 1: d1→v1  d2→v2  …  d10→v10   caption 001
# round 2: d1→v2  d2→v3  …  d10→v11   caption 002
# total rounds = min(videos, captions)
```

(Same rule as the `(r-1+d-1) % N` from the previous post; there `d` was 1-based. The loop index counts from 0 while video numbers and "which device" are 1-based to a human — no conflict: `d=0` *is* the first device.)

What actually differed was **how the result gets into the platform**.

VMOS is a web app; Playwright can reach the DOM, find buttons by class, and read "N items total" out of a dialog as an assertion. GeeLark is an **Electron desktop client**, and:

- **the CDP debugging port is blocked** — no attaching to it like a browser;
- **its internal buttons are invisible to the macOS Accessibility API** — walking `UI elements` from AppleScript returns an empty shell of a window.

With both routes closed, only one remained: **take a screenshot and read pixel colors off the screen.**

## 2. What the pixel approach looked like

It wasn't slapdash. With zero structural information available, I calibrated a color predicate for every step. Checking whether the spreadsheet dialog is open, for instance:

```python
def table_modal_open():
    """The predicate is the blue "Click to upload" button inside the dialog —
    it sits center-left, and that region holds no blue elements on the normal
    page (the page's blues — "Add" top-right, "Fetch" right, "Publish"
    bottom-left — all fall outside the region). Measured: 700+ blue pixels
    when open, 0 when closed.
    """
    return find_blue_button(screenshot(), wr(0.28, 0.22, 0.48, 0.42)) is not None
```

Note `wr(0.28, 0.22, 0.48, 0.42)` — every region is expressed as a **fraction of the screen**, never as absolute coordinates. At the time I believed that alone solved the "different computer" problem.

The critical step was "select all 10 videos in the file dialog." That step exposes no readable state at all, so the predicate became:

```python
def screen_blue_ratio():
    """Fraction of the full screenshot that is "selection-highlight blue".

    Selected rows in a file dialog are filled with system blue; selecting 10
    covers over 10% of the screen, versus about 1% unselected (measured:
    12.4% vs 1.5%). GeeLark's own blue buttons get counted too, so the
    absolute value is unreliable — what matters is the before/after delta.
    """
```

Then three keystroke strategies are tried in turn; whichever raises the blue ratio by two percentage points wins:

```python
strategies = [
    ("right-arrow into column + Cmd+A", ...),
    ("plain Cmd+A", ...),
    ("down-arrow to first item + Cmd+A", ...),
]
for name, action in strategies:
    before = screen_blue_ratio()
    action()
    after = screen_blue_ratio()
    if after - before > 0.02:
        print(f"  files selected ({name}, blue +{(after-before)*100:.1f}%)")
        return True
```

**This worked.** On my 13", the first strategy hit every time, measured at +3.3%. The full flow — from creating a task to filling in the sheet — ran six steps unattended, and I put many rounds through it.

## 3. It broke on a different computer

After switching to a 16" M3, that step started failing: the blue highlight rose by a fraction of a percent, and all three strategies fell through.

The reason is mundane, and I hadn't thought about it:

**The predicate is a fraction of the entire screen, while the file dialog has a fixed physical size.**

Bigger screen, bigger denominator. Select the same 10 files and that patch of blue covers a smaller share of the display — 12.4% on the 13", maybe 7% or 5% on something larger. And `> 0.02` was measured on the 13".

I thought expressing regions as fractions (`wr(0.28, 0.22, ...)`) made things screen-independent. **The regions did scale. The threshold didn't.** That `0.02` is an empirical constant, and what it encodes isn't "files are selected" — it's "what happens when files are selected *on that particular 13-inch display*."

> **A calibrated constant is the environment of its calibration, frozen into the code.** It doesn't declare what it depends on, and it doesn't warn you when that dependency changes — it just starts returning wrong answers.

This class of implicit dependency is brutally hard to spot, because **nothing in the code shows it**. There's no note next to `0.02` saying "only ever measured on my 13-inch."

## 4. The real problem: failure reported as success

Failing would have been fine — an error, a stop, and I'd know exactly what to fix.

What actually happened:

1. no files got selected;
2. the script carried on and clicked "Open" **with nothing selected**;
3. the upload area sat empty;
4. and then `upload_done()` returned `True`.

```python
def upload_done():
    """Whether the videos finished uploading.

    Two mutually independent visual signals; either suffices:
      1. step 3 "Edit content" in the stepper turns blue (it auto-advances
         once upload completes)
      2. a green progress bar / green checkmark appears in the preview area
    """
```

The comment says "two **mutually independent** visual signals." That claim is wrong, and wrong in an instructive way.

The two signals are independent **semantically** (one reads the stepper, the other the preview pane) but not at all independent in their **failure mode** — both rest on the same premise: *the color inside some relative screen region reflects the true state of the UI*. Once display size knocks that premise out, both signals go wrong **together**.

> **Redundant checks are only redundant when their failure modes are independent.** Two checks that both read screen pixels aren't a backup — they're one safety net counted twice.

Which produced the worst possible ending: the script ran clean to completion, printed a tidy six-step progress log, filled in a sheet **containing no videos**, and invited me to hit publish. A wasted round, silently.

In the previous post I wrote: "this script's failure mode isn't 'error and stop,' it's 'ran perfectly, and then 10 accounts posted duplicates.'" This is the same sentence in another key — except this time what failed silently wasn't the business logic, it was **the eyes I was using to check the business logic**.

## 5. Fixable, but worth it?

There is a fix: run a calibration pass the first time a machine is used, measure the actual ratios in the selected/unselected states, and store the threshold in config.

I priced that route out honestly:

| | Cost |
| --- | --- |
| Calibration flow | Needs a guided routine asking the user to select files once, then deselect |
| Users | Non-technical colleagues, all on different displays (13", 16", external monitors) |
| Re-trigger | New computer, plugging in an external monitor, even a scaling change |
| Failure mode | Still "silently posts the wrong thing," just less often |

That last row is what killed it. **A tool that is only safe when correctly calibrated, handed to someone who doesn't know what calibration is, hasn't become safe by acquiring one more step.**

So I changed the question. Not "how do I fix this automation," but —

**Which parts of this script can a human not do?**

| Step | By hand | Cost of an error |
| --- | --- | --- |
| Work out which video device 3 gets on round 87 | Maintain a spreadsheet, compute a modulo | **One misaligned cell means a duplicate post — invisible at the time** |
| Pull the 10 videos and rename them consistently | Find and rename one by one | Names don't match; GeeLark can't bind them |
| Fill 10 rows (id / filename / caption / time) | Type it, copy-paste back and forth | Off-by-one rows, misalignment |
| Press Cmd+A in the file dialog | **Three seconds** | Visible — you can see whether it selected |
| Click a few buttons | **A dozen seconds** | Visible |

The dividing line is unusually clean: **the top three are "a human gets these quietly wrong"; the bottom two are "a human does these in seconds, and any error is immediately visible."**

The value of automation was never "how many steps it covers." It's **which failures it carries that the human can't**. And the half I'd poured the most effort into was precisely the half least worth automating — it looked important because it was hard.

## 6. Three attempts, and the most aggressive one won

Cutting the automation took three tries to get right.

**Attempt 1: `--manual-pick`.** The script pauses at the file-selection step, prints "please select the 10 files, then press Enter," and resumes automating the remaining steps once the human is done.

Reasonable on its face: keep most of the automation, hand off only the unreliable step.

**Attempt 2: rejected.** "Press Enter to continue" is a burden for a non-technical operator — she now has to watch two windows and know when to switch back. Worse, the steps *after* the pause **still used the same pixel predicates**, so they could still misreport. Keeping half the automation means keeping half the false positives.

**Attempt 3: don't touch GeeLark at all.** The script became a two-second local prep job:

```text
══════════════════════════════════════════════════════════════
  Materials ready. In GeeLark:

  ① Batch upload → Local upload → pick the 10 videos in this folder
     /Users/xxx/Downloads/geelark-tiktok-skill/本轮视频

  ② Spreadsheet edit → Click to upload → pick this file
     /Users/xxx/Downloads/geelark-tiktok-skill/template_filled.xlsx

  In GeeLark's file dialog press Command+Shift+G and paste the path
  (①'s path is already on your clipboard)
══════════════════════════════════════════════════════════════
```

Compute the schedule, copy 10 videos into `本轮视频/` renamed `v01`–`v10`, generate a filled spreadsheet with openpyxl, print two paths. **Done.**

I briefly considered a fourth option: an `--auto` flag, so anyone whose screen is calibrated could still use the automated path. Rejected too. **Two code paths mean twice the maintenance, and the user has no way to judge which one applies to her** — she'll use whichever the docs describe, which leaves the other path existing solely so that someone can enable it by accident one day.

> **A tool for non-technical users gets exactly one path.** Flags are for people who know what they're choosing between.

## 7. Deleting it made a pile of unrelated problems disappear

This part I didn't see coming. Cutting the automation quietly resolved a batch of issues that looked unconnected.

**Dependencies went from three to one.** It used to need `pyobjc-framework-Quartz` (synthetic clicks) + `Pillow` (pixel reads) + `openpyxl` (write the spreadsheet). Only the last one remains.

That's not tidiness. A colleague got stuck installing dependencies with `Cannot locate a working compiler` — pyobjc ships no prebuilt wheel for the Python 3.9 that macOS bundles, so it compiles from source, and her machine had no full toolchain. **A feature nobody calls anymore had become a precondition for the tool running at all.**

The fix was demoting both packages to optional imports:

```python
# The current flow only does local prep (schedule / copy videos / write the
# spreadsheet); openpyxl is the sole hard requirement. Quartz and Pillow are
# used only by the retired GeeLark automation in the bottom half of this file,
# so a missing import sets them to None instead of exiting — it only errors if
# something actually calls them.
try:
    from Quartz import (...)
except ImportError:
    CGEventCreateMouseEvent = None
```

**No system permissions required anymore.** It used to need both Screen Recording (screenshots) and Accessibility (synthetic clicks). Both require restarting the terminal to take effect on macOS, and — worse — **without the permission, `screencapture` doesn't fail; it just returns a blank frame.** The script believes it can see the screen while being completely blind. I'd even written a detector for that:

```python
if avg > 250 or avg < 5:
    print("    ⚠ frame is nearly all white/black — most likely the terminal "
          "lacks Screen Recording permission, so the script is blind")
```

That detector now sits in the uncalled half along with the rest of the automation — **the problem it guarded no longer exists, because the script never takes a screenshot. The best error handling is making the error impossible.**

**The output location changed too.** Early on the staging folder lived in the home directory, to shorten what "Go to Folder" had to type — an optimization from the automation era. Now it sits inside the script directory, **side by side** with `template_filled.xlsx`:

```text
geelark-tiktok-skill/
├── 本轮视频/                ← ① upload these 10 videos
│   ├── v01.mp4 ~ v10.mp4
└── template_filled.xlsx     ← ② pick this for spreadsheet edit
```

Both artifacts in one folder, obvious at a glance in Finder. **When the operator changes from a script to a person, the definition of "convenient" changes with it.**

## 8. Two things removed for the non-technical user

While cutting the automation, two features I'd considered thoughtful also went.

**No more shell commands in the output.** The script used to print `echo -n '<path>' | pbcopy` so you could copy the path. That was flagged as noise — **someone non-technical sees a command line and assumes she's expected to type it.** Now the script calls `pbcopy` internally and the output just says "①'s path is on your clipboard."

**No more auto-opening Finder.** It used to pop Finder at the video folder so she could drag the files into GeeLark. Then:

```python
# Don't auto-open Finder: GeeLark's upload dialog rejects drag-and-drop, you
# must pick files inside the dialog. Popping Finder just makes people think
# that window is the upload UI. Print the path instead.
```

**A convenience built on a false assumption is worse than no convenience** — it steers the user down a road that doesn't exist, and people don't blame the tool, they blame themselves.

## 9. The code is deleted, but not removed (on purpose)

`publish.py` is 1,967 lines today, and **roughly three quarters of it is automation code nothing calls**: `setup_window`, `click`, `screenshot`, `select_all_in_dialog`, `step_upload_videos`… all still there.

Conventional wisdom says delete it; dead code is a liability. I kept it, because **the comments inside those functions are the most expensive thing this project produced**:

```python
# Must use key code 5, not keystroke "g": if the modifier is dropped it
# becomes a bare "g", which triggers type-select in the file dialog, and the
# Enter that follows opens whatever file it jumped to
```

```python
# There used to be a fourth strategy, "Tab to move focus + Cmd+A" — removed:
# it sent Tab right after Cmd+A, and if Command hadn't fully released it
# became Cmd+Tab, popping the app switcher and derailing the whole flow
```

```python
# If the human switches to another window mid-run (to check a chat, say),
# every subsequent pixel check measures someone else's screen — blue
# highlight reads 0 forever. This was the main cause of the long-standing
# "works sometimes" behavior
```

Each of those cost dozens of failures, and **none of them are discoverable from documentation**. Delete the functions and that knowledge goes with them; whoever revisits automation later (if GeeLark ever opens its debug port) starts from zero.

I labeled the status explicitly in the docs so nobody mistakes it for an oversight:

> **The original automation remains in the bottom half of `publish.py`** (uncalled). It carries extensive notes on what went wrong and is worth reading if automation is ever attempted again.

> **Distinguish "dead code" from "archived experience."** Delete the former; annotate and keep the latter. The test: would deleting it lose information that can't be re-derived?

## 10. What remains still refuses to fail silently

The automation is gone, but every guard against silent failure stayed, because **the scheduling logic still fails the same way it always did — no error, just quietly duplicated posts**:

| Check | What it prevents |
| --- | --- |
| `progress.json` written only after a full successful round | Mid-run failure corrupting progress |
| Abort when fewer than 10 videos are available | Duplicates within a single round |
| Missing/malformed `config.json` → explicit error | Captions landing on devices that don't exist |
| `--round N` **does not advance progress** | Backfills and tests polluting real progress |
| `--new-cycle` previews unless `--yes` is passed | Accidentally zeroing progress |
| Old progress backed up to `.bak` on cycle change | Recoverable if the reset was wrong |

One of those deserves its own note. In `--dry` mode I force the device ids to be printed for human review:

```python
# A wrong device id is the most insidious failure: the whole round "succeeds"
# and the captions quietly land on devices that don't exist. So --dry always
# lays the current config out for a human to check.
print(f"  device ids (config.json): {', '.join(PHONE_IDS)}")
print("  ⚠ If these are wrong the script still completes, but the captions go "
      "to devices that don't exist — the whole round is wasted.")
```

This is something **code cannot verify** — the script has no way to know which device ids exist in your GeeLark account. Since it can't be checked, it gets **put in front of the human**, along with a plain statement of what happens if it's wrong.

That line from the previous post — deciding which problems get solved by code and which by convention — showed up again here.

## 11. In one sentence

That `0.02` in the predicate quietly encoded a 13-inch display into the source. On a different computer it doesn't raise an error; it just starts lying — and the check meant to cross-validate it was lying alongside it.

**When your verification mechanism shares a failure premise with the thing it verifies, it isn't verification.**

The final call wasn't to fix it, it was to delete it: keep the parts a human gets quietly wrong (scheduling, renaming, filling the sheet) and hand back the parts a human does in seconds with the result plainly visible (clicking).

**A script's worth isn't how many steps it takes off your hands — it's which of your errors it carries.** With those 1,500 lines gone, the tool finally runs on anyone's computer without ever silently posting the wrong thing.
