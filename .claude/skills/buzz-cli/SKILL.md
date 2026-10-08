---
name: buzz-cli
description: Use the buzz CLI from the devenv shell to read Beeminder data — goals, datapoints, deadlines, ASCII progress charts and raw authenticated API calls. Use whenever you need to look something up in the user's Beeminder account and a quick command is easier than writing code or a Hurl file.
---

# Gather Beeminder data with buzz

`buzz` is on the PATH inside the devenv shell and is already authenticated with the user's account. Run it directly whenever you need Beeminder data.

Pass `--no-color` so output has no ANSI codes. To get machine-readable output from `list`, `all`, `today`, `tomorrow`, `due`, `less`, `next` and `data`, pass `--format json` (or `csv`).

## Read data

- `buzz api <path>`: makes a raw authenticated API request and prints the JSON. The path is relative to the API root and the auth token is added for you, for example `buzz api users/me.json` or `buzz api users/me/goals/<slug>.json`. Reach for this when no other command shows the field you need.
- `buzz list` / `buzz all`: lists every goal. `buzz list --archived` shows archived goals.
- `buzz today`, `buzz tomorrow`, `buzz due <duration>` (for example `5d`), `buzz less`: lists goals filtered by deadline or goal type.
- `buzz next`: gives a terse summary of the next goal due.
- `buzz view <slug>`: shows goal details plus an ASCII chart of datapoints against the bright red line. `--json --datapoints` returns the full goal as JSON.
- `buzz data [--desc] <slug>`: lists a goal's datapoints.
- `buzz schedule`: shows how deadlines are spread across the day.

Run `buzz help` for the full command list.

## Avoid commands that change the account or need a TTY

These commands change the user's account, and some of them cost money. Run one only when the user asks for that change:

- `add`
- `refresh`
- `charge`
- `create`
- `deadline`
- `uncle`
- `ratchet`
- `buzz api -X POST|PUT|DELETE`

Don't run bare `buzz`, `buzz review`, or `buzz create` without flags. They open interactive interfaces that need a TTY.

To edit a graph's bright red line, use the beeminder-graph skill instead.
