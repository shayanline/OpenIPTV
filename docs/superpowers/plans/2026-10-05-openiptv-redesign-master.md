# OpenIPTV Product Redesign Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved OpenIPTV redesign through five ordered subsystem plans while preserving Samsung television compatibility, provider data resilience, exact focus ownership and one final automated verification gate before push.

**Architecture:** `App.tsx` becomes the screen stack and top level mode owner. Focused screens own their navigation, `usePlaybackController` owns playback state and recovery, `VodScreen` owns Movies and Series, `useLineup` materialises provider data with durable personalisation, and the remote protocol delegates every lineup mutation to the same store used by the television. Each subsystem lands behind interfaces consumed by the next subsystem, which keeps one write agent and one independent reviewer responsible for each task.

**Tech Stack:** React 19, TypeScript, zustand, Vite, Biome, Vitest, IndexedDB, Samsung AVPlay, hls.js, native Fetch and URL APIs, the existing television harness, and dependency free browser JavaScript for the phone interface.

**Spec:** `docs/superpowers/specs/2026-10-05-openiptv-product-redesign-design.md`

## Global Constraints

- Add no runtime dependency or hosted service.
- Target ES2019 and Chromium 69 with one artifact for every supported television.
- Keep provider credentials, stream addresses and embedded secrets out of identifiers, logs, diagnostics, snapshots and personalisation records.
- Preserve immediate cursor response, one focus owner and Back behavior that removes the current page or layer according to the approved specification.
- Perform no IndexedDB work, catalogue materialisation, image decoding or provider request directly on a key path.
- Preserve provider supplied names and metadata as text, use `dir="auto"`, and apply the approved translated fallbacks only when values are missing or invalid.
- Keep the screen stack, media capability branches, socket ownership and cache class budgets explicit.
- Write the focused tests named by each subsystem plan while implementing its tasks.
- Do not run automated tests, lint, type checks, builds or television gates during implementation because the user requires one final automated gate before push.
- Record every deferred verification command in the subsystem task and run it only in Task 7 of this master plan.
- Do not push until the user explicitly asks for a push after reviewing the final implementation and verification result.

## Review Focus

- A mode change, hidden document or cancelled request must invalidate every pending tune, recovery, image decode and provider response owned by the previous surface.
- Missing, malformed, duplicated, very long, bidirectional or emoji provider data must preserve focus, geometry, accessible names and a playable path where the provider supplied one.
- Every transition between picture, browser, playback deck, drawer, modal, VOD details, episode panel and management must leave exactly one focus owner and an exact Back destination.
- Cache, personalisation and progress migrations must be idempotent, bounded and unable to expose provider order before a saved personal order is applied.
- Television and phone lineup mutations must produce the same durable record, revision and paged query result without sending a full catalogue in a snapshot.

## Plan Set and Interface Order

1. `docs/superpowers/plans/2026-10-05-openiptv-shell-navigation.md` produces the explicit surface stack, `LiveScreen` and focused key delegation while preserving current visible behavior.
2. `docs/superpowers/plans/2026-10-05-openiptv-playback-recovery.md` consumes the surface stack and produces `PlaybackController`, playback layers, tracks, subtitles, Live DVR and sequential recovery.
3. `docs/superpowers/plans/2026-10-05-openiptv-vod-experience.md` consumes the shell and playback controller and produces the full Movies and Series modes, provider normalisation, poster pipeline, VOD navigation, details and progress.
4. `docs/superpowers/plans/2026-10-05-openiptv-lineup-personalisation.md` produces `useLineup`, `personalDisk`, provider reconciliation, ordering and television management.
5. `docs/superpowers/plans/2026-10-05-openiptv-remote-migration-verification.md` consumes `useLineup`, exposes paged phone management, completes migrations and harness fixtures, updates documentation and owns the final automated gate.

## Agent Execution Protocol

- One write agent owns one task and the exact files listed by that task.
- No two write agents edit `App.tsx`, shared stores, locale files, styles or the same tests at the same time.
- The write agent reads the master specification, this master plan and its subsystem plan before editing.
- The write agent adds the tests required by its task but does not execute any automated command.
- The write agent manually reviews its complete diff, checks for secrets, removes dead code and commits only the files owned by the task. One line commit commands in subsystem plans show the subject boundary only, so the executor must use the required Devin generation and coauthor trailer format.
- A fresh read only reviewer checks correctness, project rules, Samsung UX, navigation, accessibility, provider resilience and performance after every task.
- Validated review findings return to a focused write agent, which changes only the affected files and does not run automated verification.
- A subsystem is complete after its tasks are implemented, all high confidence review findings are resolved and its deferred command list is complete.
- The final automated gate runs once after all subsystem reviews pass and before any push.

---

### Task 1: Freeze the Approved Contracts and Deferred Gate

**Files:**
- Read: `docs/superpowers/specs/2026-10-05-openiptv-product-redesign-design.md`
- Read: all five subsystem plans named above
- Modify only when an interface conflict is found: the affected subsystem plan

**Interfaces:**
- Consumes: the approved specification and the user instruction to defer every automated command.
- Produces: one consistent interface order, one file ownership table and one final gate command list.

- [ ] **Step 1: Confirm the plan dependency order**

Confirm that the shell plan exports the surface contract consumed by playback and VOD, the playback plan exports `PlaybackController` consumed by VOD, the lineup plan exports query and mutation APIs consumed by remote management, and no later plan requires a speculative adapter in an earlier plan.

- [ ] **Step 2: Confirm the verification deferral**

Confirm that every subsystem test step says to write the test and defer execution, while every command appears in the final gate task below.

- [ ] **Step 3: Record the starting revision**

Record the current commit, worktree status and existing user changes without altering or stashing them.

### Task 2: Execute the Shell and Navigation Plan

**Files:**
- Plan: `docs/superpowers/plans/2026-10-05-openiptv-shell-navigation.md`

**Interfaces:**
- Consumes: the current `App`, panel, key handling and long press behavior.
- Produces: the ordered surface stack, `LiveScreen`, stable screen key contract and unchanged current Movies and Series panel.

- [ ] **Step 1: Implement each shell plan task with a fresh write agent**

Keep task ownership sequential when files overlap.

- [ ] **Step 2: Review each task with a fresh read only agent**

Require evidence for every finding and resolve blocking or high confidence issues before continuing.

- [ ] **Step 3: Record deferred commands and complete the subsystem review**

Do not execute the commands.

### Task 3: Execute the Playback and Recovery Plan

**Files:**
- Plan: `docs/superpowers/plans/2026-10-05-openiptv-playback-recovery.md`

**Interfaces:**
- Consumes: the ordered surface stack and screen key delegation from Task 2.
- Produces: `PlaybackController`, `PlaybackSnapshot`, playback deck, drawers, Live DVR, tracks, subtitles and the recovery coordinator.

- [ ] **Step 1: Implement each playback plan task with a fresh write agent**

Preserve sequential recovery ownership and AVPlay state legality.

- [ ] **Step 2: Review correctness and Samsung playback UX after each task**

Review range arithmetic, timers, focus, Back order, hardware plane constraints and fault cancellation without running automated checks.

- [ ] **Step 3: Record deferred commands and complete the subsystem review**

Do not execute the commands.

### Task 4: Execute the VOD Experience Plan

**Files:**
- Plan: `docs/superpowers/plans/2026-10-05-openiptv-vod-experience.md`

**Interfaces:**
- Consumes: the top level mode owner, ordered surfaces and `PlaybackController` finite target API.
- Produces: `VodScreen`, windowed poster grid, search, Movie and Series details, inline episode panel, provider normalisation, poster cache and resolved progress.

- [ ] **Step 1: Implement provider and persistence foundations before UI tasks**

Keep normalisation, cache classes and progress migration available before screens consume them.

- [ ] **Step 2: Implement each VOD surface with one write agent and one reviewer**

Review normal, empty, loading, failure, long text, missing artwork, right to left and pointer or wheel behavior after each surface.

- [ ] **Step 3: Record deferred commands and complete the subsystem review**

Do not execute the commands.

### Task 5: Execute the Lineup Personalisation Plan

**Files:**
- Plan: `docs/superpowers/plans/2026-10-05-openiptv-lineup-personalisation.md`

**Interfaces:**
- Consumes: raw provider channel and category catalogues.
- Produces: durable `LineupPersonalisation`, effective channel and category materialisation, indexed channel numbers, reconciliation and television management mutations.

- [ ] **Step 1: Implement identity, ordering and persistence before store adoption**

Keep pure arithmetic and durable storage independent from React state.

- [ ] **Step 2: Implement adoption, migration and management with isolated owners**

Review provider refresh, unavailable references, write rollback and personal category caps manually.

- [ ] **Step 3: Record deferred commands and complete the subsystem review**

Do not execute the commands.

### Task 6: Execute the Remote, Migration and Harness Plan

**Files:**
- Plan: `docs/superpowers/plans/2026-10-05-openiptv-remote-migration-verification.md`

**Interfaces:**
- Consumes: `useLineup`, durable personalisation, playback fault controls and every deferred command list.
- Produces: revision bound paged queries, phone mutations, migration completion, fault fixtures, documentation and final gate readiness.

- [ ] **Step 1: Implement protocol and phone tasks through the shared lineup store**

Keep snapshot and lineup revisions distinct.

- [ ] **Step 2: Implement migration and harness tasks**

Do not execute the new fixtures or journeys during implementation.

- [ ] **Step 3: Run a whole branch read only review**

Resolve every blocking or high confidence finding before the automated gate.

### Task 7: Run the Final Automated Gate Before Push

**Files:**
- Review: the complete branch diff
- Review: `CONTRIBUTING.md`
- Review: every deferred command list from the five subsystem plans

**Interfaces:**
- Consumes: the complete reviewed implementation and every test written during Tasks 2 through 6.
- Produces: one verification report that names every command, result, skipped hardware check and unresolved external limitation.

- [ ] **Step 1: Inspect the complete branch diff and secret exposure**

Review every commit and changed file before running commands.

- [ ] **Step 2: Run formatting, lint, type and test checks**

Run:

```bash
git diff --check
npm run check
```

Expected: every command exits with status 0.

- [ ] **Step 3: Build the production artifact**

Run:

```bash
npm run build
```

Expected: the production build completes with status 0.

- [ ] **Step 4: Run television layout and engine gates**

Run:

```bash
npm run tv:gap
npm run tv:engines
```

Expected: both gates pass for the supported engine matrix.

- [ ] **Step 5: Run the television performance gate on a quiet machine**

Read the machine load in the gate header, then run:

```bash
npm run tv:budget
```

Expected: the complete launch and interaction budget passes without an invalid high load result.

- [ ] **Step 6: Run conditional repository checks**

Run `npm run wasm:check` only if `wasm/`, `public/wasm/`, a worker, checksums or socket integration changed. Validate `public/config.xml` only if that file changed.

- [ ] **Step 7: Report hardware acceptance separately**

Report that `npm run tv:on-set` requires a paired television and remains a manual hardware acceptance step unless the device is available.

- [ ] **Step 8: Fix failures and repeat only invalidated commands**

Do not rerun a passing command unless a later fix could affect it.

- [ ] **Step 9: Request explicit push approval**

Present the complete verification report and wait for the user to request the push.
