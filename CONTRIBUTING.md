# Contributing

Pull requests are welcome. The one thing worth knowing before you start is that this project is
shaped by a constraint most web projects do not have: the same build has to run on a 2020 television
whose browser engine is Chromium 69, with a remote control that has arrow keys and little else.

Read [the design notes](docs/design.md) for why the interface is the way it is, and
[AGENTS.md](AGENTS.md) for the invariants. Those invariants are not style preferences. Each one is
there because breaking it fails on hardware that no test in this repository owns.

## Before opening a pull request

```bash
npm ci
npm run check       # lint, typecheck, unit and component tests
npm run build
npm run tv:gap      # spacing parity for the sets without flex gap
npm run tv:engines  # the app in a real Chromium 69 and 120
```

`npm run check` and `npm run build` are the minimum. Run the two `tv:` gates as well if you touched
anything in `src/styles/`, anything about layout, or anything that could differ between engine
versions, because those are exactly the failures a laptop hides. What each gate measures and how to
read its output is in [testing and measurement](docs/testing.md).

CI runs all of it on every pull request, so a run that is red there is not ready, with one exception:
the performance budget is allowed to fail, because it compares against numbers measured on a
particular machine and a shared runner is not that machine.

## Things that will be asked of a change

**Keep it one artifact.** No branching by model year, no user agent sniffing. There is exactly one
runtime capability probe in the whole application and adding a second needs an argument, since every
branch turns a year of televisions nobody can test into a year that behaves differently.

**Do not interpret playlist content.** Names, groups and languages appear exactly as the file writes
them. This app does not know what a country is, and it should not learn.

**Say why in the code.** The comments here explain decisions rather than mechanics, and a measured
number beats an adjective. If you found something out by testing it on a television, write down what
you measured, because the next person cannot repeat it without your set.

**Nothing new on an interaction path.** A key press has to be answered before anything expensive
happens. If your change adds work while a key is held, it needs the same treatment the rail and the
search already have.

## Reporting a problem instead

An issue is just as useful as a patch, especially from a television this has never run on. The one
thing that makes a report actionable is Settings, then Diagnostics: it lists what the set reports
about itself and every key its remote sends, and the bug report template asks for it.

Security problems go through [SECURITY.md](SECURITY.md) rather than the issue tracker.
