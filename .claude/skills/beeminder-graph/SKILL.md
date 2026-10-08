---
name: beeminder-graph
description: Edit a Beeminder goal's bright red line (the "graph" / "road" / roadall) through the API, with safety checks and before/after previews. Use whenever the user wants to add, move or remove a break, take days off, change a goal's rate, floor or target, or otherwise change what a Beeminder graph requires on future days.
---

# Edit a Beeminder graph

All work goes through `bee.ts`, run from the repo root:

```
bun .claude/skills/beeminder-graph/bee.ts <command> ...
```

It needs `BEEMINDER_API_TOKEN` (a personal auth token), `chromium` on PATH and `FONTCONFIG_FILE` pointing at a config with fonts. The devenv provides all three; without `FONTCONFIG_FILE` the graphs render with no text.

## Follow this workflow for every edit

1. `new <goal>` fetches the goal into `graphs/<goal>/<timestamp>/` and prints that directory. `before.roadall.json` is the current line; `after.roadall.json` starts as a copy and is the only file you edit.
2. `show <dir>` prints both lines with weekdays and marks jumps. Read it before and after editing.
3. Make the edit: `break` for days off, or edit `after.roadall.json` directly for anything else.
4. `check <dir>` runs the safety checks. Fix any `FAIL` before going further, and tell the user about every `WARN`.
5. Write `<dir>/description.html`: a succinct description of the change, as an HTML fragment that `render` inserts as-is at the top of `index.html` above the graphs. `render` refuses to run without it.
   - Describe only this edit: which days change, what the line requires before and after, which days are off, and the first day a new requirement applies. Use weekday names with dates.
   - NEVER restate this skill's goals, rules or checks, such as that the past is untouched, that checks passed, or why the akrasia horizon limits the change. The check results are already on the page.
   - No intro sentence. Start with the first change.
   - For more than one change, use a `<ul>` with one `<li>` per change. No headings, styles or scripts.
6. `render <dir>` writes `before.png`, `after.png` and `index.html` side by side. Pass `--from D --to D` for a specific window; the default is the changed days plus 14 days either side. Both graphs share a y-axis that covers the data and both lines across the window, unlike beeminder.com, which sizes it to the data alone. Pass `--vmin V` and/or `--vmax V` to set the y-axis yourself, for example to see detail near the baseline under a tall break. Read both PNGs yourself and describe the difference, then give the user the `index.html` path.
7. Ask the user to approve. Only run `apply <dir>` after they explicitly say yes to this specific preview.
8. `apply <dir>` re-runs the checks, refuses if the goal changed on Beeminder since `new`, sends the PUT, then re-fetches and confirms Beeminder stored the same line.

Never send a roadall any other way, and never skip the preview, even for a change that looks trivial.

## Add a break

```
bun .claude/skills/beeminder-graph/bee.ts break <dir> --from 2026-11-24 --to 2026-11-27 [--height 1000]
```

- `--from` and `--to` are both days off, inclusive. The line jumps to `--height` at the start of `--from` and drops back to its normal value at the start of the day after `--to`, so that day must be back in shape by its deadline.
- Breaks are vertical jumps (infinite slope), which is how the user wants them. Default height is 1000; use a per-break height if the user gives one.
- Only do-less goals (`yaw -1`) are supported. For a do-more goal, stop and discuss with the user instead of improvising.
- An existing break entirely inside the new range is replaced; `break` prints the rows it replaced.
- It refuses to start a break inside the akrasia horizon, and verifies the new line matches the old one on every day outside the break before writing anything.

## Edit the line by hand

`after.roadall.json` is Beeminder's `roadall`: an array of `[date, value, rate]` rows, each with exactly one `null`, which Beeminder computes from the other two.

- Dates are `YYYYMMDD` daystamps in the goal's timezone. The first row is `[date, value, null]` and sets the start. Only the last row may have a `null` date.
- Each later row ends a segment: `[d, v, null]` means "reach `v` on `d`"; `[d, null, r]` means "go at rate `r` per `runits` until `d`".
- Two consecutive rows with the same date make an instant jump. On the jump date the line has the second row's value.
- Leave rows you are not changing exactly as they are, so the diff the user approves is only their change.

## Know the rules Beeminder enforces

- The line must not get easier on any day up to the akrasia horizon (today + 7 days). Making it harder is always allowed. `check` treats the horizon day itself as off-limits, which is stricter than the graph editor, to avoid a known API bug at the boundary.
- "Easier" means higher for do-less goals (`yaw -1`) and lower for do-more goals (`yaw 1`).
- Datapoints are compared per day using the goal's `aggday` (for example `min`), not individual readings.

## Apply the user's conventions

- For keep-at-zero goals (do-less, flat line), the baseline is 1, not 0, so a day at zero is not sitting on the line. Use 1 when creating or adjusting such a line, and when a break drops back down it returns to the line's value, which is then 1. Raising an existing 0 baseline makes the goal easier, so it can only start after the akrasia horizon.
- Breaks are inclusive and specified as days off.

## Reference

- `fetch-goal.hurl` in the repo root documents both endpoints this uses: `GET /api/v1/users/{u}/goals/{g}.json` (roadall as unix timestamps) and the undocumented `GET /api/vx/users/{u}/goals/{g}/graph.json` (everything the graph code needs). The token goes in `auth_token`, and the vx endpoint does not accept `me` as the username.
- `vendor/road/` is Beeminder's own graph code (beebrain for computation, bgraph for rendering), so checks and previews match what beeminder.com shows. See the repo README for its source and license.
