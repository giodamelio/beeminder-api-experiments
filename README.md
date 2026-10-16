# beeminder-api-experiments

Here are some random experiments with the [Beeminder](https://www.beeminder.com) API. Right now it is mostly holding a few Claude skills I created to help me out with editing my Goals. It also has a [devenv](https://devenv.sh) shell with all the tools needed for it.

**Skills:**

- [beeminder-graph](#beeminder-graph): edit a goal's bright red line, with a before and after preview html file to verify and approve
- [buzz-cli](#buzz-cli): read goals, datapoints and charts with the buzz CLI

## Setup

Dependencies to run

- [Bun](https://bun.sh)
- Chromium, available on your `PATH` as `chromium`. It renders the before and after graphs.

Then install the JavaScript dependencies:

```
bun install
```

Set `BEEMINDER_API_TOKEN` to your personal auth token. While logged in to Beeminder, get it from [your auth token page](https://www.beeminder.com/api/v1/auth_token.json).


### Use devenv and Nix

If you use [devenv](https://devenv.sh), enter it instead of installing the dependencies by hand. It provides Bun, Chromium, Hurl, buzz and fonts, and sets the Hurl variables. It loads `BEEMINDER_API_TOKEN` and `BEEMINDER_USERNAME` from your system keyring through [SecretSpec](https://secretspec.dev). To store them there the first time, run `secretspec check`, which asks for any secret that is missing. You still need to run `bun install`.

## Skills

Each skill lives in its own directory under `.claude/skills/`. Claude Code picks the right one from what you ask for.

### beeminder-graph

Ask Claude Code to change a goal's graph, for example "give unread-emails a break from Dec 24 to Dec 26". The `beeminder-graph` skill in `.claude/skills/beeminder-graph/` fetches the goal, makes the edit, checks it, renders before and after graphs for you to review, and only sends the change after you approve it.

Before anything is sent, the skill writes a preview of the change to `graphs/<goal>/<timestamp>/index.html`. It shows a summary of the change, the before and after graphs side by side, the safety check results, and a diff of the line's data. The contents of `graphs/` are not committed.

![Preview of an edit to unread-emails that raises the floor to 1 and extends a break by a day](docs/example-preview.png)

### buzz-cli

The `buzz-cli` skill in `.claude/skills/buzz-cli/` lets Claude Code use [buzz](https://github.com/PinePeakDigital/buzz), a Beeminder command-line tool, to read your account. Claude can list goals and deadlines, read datapoints, draw a goal's progress as an ASCII chart with `buzz view`, and make raw API requests with `buzz api`. Commands that change your account, such as adding datapoints or derailing a goal, only run when you ask for them.

buzz only reads its config from `~/.buzzrc`. So the devenv shell runs it with `HOME` set to the repo, and writes `.buzzrc` there from your SecretSpec secrets each time you enter the shell. That file is not committed.

## Credit the bundled Beeminder code

`.claude/skills/beeminder-graph/vendor/road/` contains files copied from [beeminder/road](https://github.com/beeminder/road) at commit `a271687e6f086fa6b63cef6bdc20d9195a29f5f4`. They are Beeminder's own graph engine (Beebrain) and graph renderer, so the checks and previews here match what beeminder.com shows.

All files are unmodified except `bgraph.js`, which adds an `onZoom(t1, t2)` option. It fires whenever the visible range changes, except through `setZoomRange()`, so the preview can keep its before and after graphs in sync. Re-apply that patch when you update the vendored copy.

Thanks to all the creators and contributes for making it open source so I can mess with it!

The licenses, as stated in that repository:

- `beebrain.js`, `bgraph.js`, `broad.js`, `butil.js`, `jsbrain.css`: copyright Uluc Saranli and Daniel Reeves. The repository's `package.json` declares the MIT license. The repository has no separate LICENSE file.
- `d3.v7.min.js`: [D3](https://d3js.org) v7.9.0, copyright Mike Bostock, ISC license.
- `moment.js`: [Moment.js](https://momentjs.com) 2.29.1, MIT license.
- `fili.js`: [Fili](https://github.com/markert/fili.js) 2.0.3 by Florian Markert, MIT license.
- `polyfit.js`: distributed in beeminder/road without a license header.
