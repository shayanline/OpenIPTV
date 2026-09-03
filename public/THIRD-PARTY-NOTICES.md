# Third party notices

OpenIPTV itself is MIT licensed, and its terms are in [LICENSE](../LICENSE). The software below is
other people's work, and this file exists because some of it travels inside every widget this
project builds rather than staying in the repository.

It lives in `public/` deliberately. Vite copies that directory verbatim, so the file and the licence
texts beside it end up in `dist/` and therefore inside the `.wgt` that a television installs. The
Apache License asks that whoever receives the software receives a copy of the licence with it, and a
notice that only a reader of the source repository can see would not do that for somebody handed a
package.

## Shipped inside the application

**hls.js**, version 1.7.0, Apache License 2.0, Copyright 2017 Dailymotion. Loaded only in a
desktop browser, where the television's own decoder does not exist, and imported on demand from
`src/services/player.ts` so it becomes a separate chunk. Parts of it derive from
videojs-contrib-hls, Copyright 2013 to 2015 Brightcove, under the same licence, and both notices are
in [licenses/hls.js.txt](licenses/hls.js.txt) exactly as the project publishes them. The full
licence text is in [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt).

**React** and **React DOM**, version 19.2.8, MIT, Copyright Meta Platforms, Inc. and affiliates.
Text in [licenses/react.txt](licenses/react.txt), which covers both packages.

**zustand**, version 5.0.14, MIT, Copyright 2019 Paul Henschel. Text in
[licenses/zustand.txt](licenses/zustand.txt).

**Vazirmatn**, Regular and SemiBold fonts, SIL Open Font License 1.1, Copyright 2015 The Vazirmatn
Project Authors. The fonts are bundled for the application font in `src/styles/tokens.css`. The licence
text is in [licenses/OFL.txt](licenses/OFL.txt).

**Emscripten**, MIT and University of Illinois NCSA, Copyright the Emscripten authors. The file
`wasm/manifest-socket.js` is generated glue, and rather than being compiled output in the way a
binary is, most of it is copied from Emscripten's own JavaScript libraries, so its licence follows
it here. It was produced by Samsung's fork of Emscripten, whose Tizen extensions carry the same two
licences. What that fork is, why it is needed and how to rebuild the module are in
[docs/testing.md](../docs/testing.md).

**musl libc**, MIT, Copyright 2005 to 2020 Rich Felker and contributors. Linked into
`wasm/manifest-socket.wasm` by Emscripten, which uses musl for its C library.

## Development only, not shipped

TypeScript, Vite, Vitest, Biome, React Testing Library and their dependencies are build tools. None
of them is part of the widget, so none of them is listed here. `package.json` and
`package-lock.json` record them exactly.

## Keeping this honest

Nothing generates this file, so a new runtime dependency has to be added by hand, and
[AGENTS.md](../AGENTS.md) says so among the invariants. There are four runtime dependencies and
adding one is a deliberate decision rather than a detail, so the cost of doing it by hand is lower
than the cost of a generator nobody reads the output of.
