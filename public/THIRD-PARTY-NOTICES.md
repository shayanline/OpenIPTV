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

**hls.js**, version 1.7.1, Apache License 2.0, Copyright 2017 Dailymotion. Loaded only in a
desktop browser, where the television's own decoder does not exist, and imported on demand from
`src/services/player.ts` so it becomes a separate chunk. Parts of it derive from
videojs-contrib-hls, Copyright 2013 to 2015 Brightcove, under the same licence, and both notices are
in [licenses/hls.js.txt](licenses/hls.js.txt) exactly as the project publishes them. The full
licence text is in [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt).

**Lucide Icons**, SVG icon geometry from the Lucide project, ISC License, Copyright 2026 Lucide Icons and Contributors. Some icons derive from Feather Icons under the MIT License, Copyright 2013-present Cole Bemis. The application embeds the selected SVG paths directly without the Lucide runtime package. The licence texts and attribution are in [licenses/lucide.txt](licenses/lucide.txt).

**React** and **React DOM**, version 19.2.8, MIT, Copyright Meta Platforms, Inc. and affiliates.
Text in [licenses/react.txt](licenses/react.txt), which covers both packages.

**zustand**, version 5.0.15, MIT, Copyright 2019 Paul Henschel. Text in
[licenses/zustand.txt](licenses/zustand.txt).

**uqr**, version 0.1.3, MIT, Copyright Project Nayuki and Anthony Fu. It generates pairing QR codes locally so no setup information leaves the television. Text in [licenses/uqr.txt](licenses/uqr.txt).

**Google Sans**, Regular and SemiBold script subsets, SIL Open Font License 1.1, Copyright 2025 The Google Sans Project Authors. The fonts provide the Latin, Cyrillic, Bengali and Devanagari interfaces in `public/fonts/fonts.css`. The licence text is in [licenses/OFL-Google-Sans.txt](licenses/OFL-Google-Sans.txt).

**Vazirmatn**, Regular and SemiBold fonts, SIL Open Font License 1.1, Copyright 2015 The Vazirmatn Project Authors. The fonts provide the Arabic and Persian interfaces in `public/fonts/fonts.css`. The licence text is in [licenses/OFL.txt](licenses/OFL.txt).

**Noto Sans CJK**, complete Google Fonts web sets for Simplified Chinese, Japanese and Korean, SIL Open Font License 1.1, Copyright 2014 to 2021 Adobe, with Reserved Font Name Source. The licence text is in [licenses/OFL-Noto-Sans-CJK.txt](licenses/OFL-Noto-Sans-CJK.txt).

**Emscripten**, MIT and University of Illinois NCSA, Copyright the Emscripten authors. The file `wasm/manifest-socket.js` is generated glue, and rather than being compiled output in the way a binary is, most of it is copied from Emscripten's own JavaScript libraries, so its licence follows it here. It was produced by Samsung's fork of Emscripten, whose Tizen extensions carry the same two licences. The management module is compiled by current Emscripten and uses a small project owned loader. Both build recipes are in [the testing documentation](../docs/testing.md).

**musl libc**, MIT, Copyright 2005 to 2020 Rich Felker and contributors. Linked into both WebAssembly modules by Emscripten, which uses musl for its C library.

## Development only, not shipped

TypeScript, Vite, Vitest, Biome, React Testing Library and their dependencies are build tools. None
of them is part of the widget, so none of them is listed here. `package.json` and
`package-lock.json` record them exactly.

## Keeping this honest

Nothing generates this file, so a new runtime dependency has to be added by hand, and
[AGENTS.md](../AGENTS.md) says so among the invariants. There are five runtime dependencies and
adding one is a deliberate decision rather than a detail, so the cost of doing it by hand is lower
than the cost of a generator nobody reads the output of.
