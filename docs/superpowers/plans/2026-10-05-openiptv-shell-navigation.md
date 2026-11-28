# OpenIPTV Application Shell and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the application shell, explicit surface ownership, Live screen, panel key handling and long press handling while preserving the current rendered interface and keeping Movies and Series in the existing panel.

**Architecture:** `App.tsx` remains the application stack, tuner and top level product mode boundary, while a pure surface model identifies the only open surface that may receive input. `LiveScreen.tsx` owns the current picture, Guide and existing Live, Movies and Series panel, and it delegates keys to separate picture, drawer and panel handlers. A reusable long press hook owns key down, repeat, timeout and key up semantics so screen handlers receive one short or long action.

**Tech Stack:** React 19, TypeScript, zustand, native keyboard events, Vitest, Testing Library, Biome, Vite, AVPlay and hls.js.

**Spec:** `docs/superpowers/specs/2026-10-05-openiptv-product-redesign-design.md`

## Global Constraints

- This plan implements subsystem 1 only, which is the application shell and navigation extraction described in the approved delivery structure.
- Preserve the current visible interface, DOM class names, focus styling, animation timing, copy and pointer behavior.
- Keep Movies and Series in the existing panel until subsystem 3, and do not add `VodScreen`, a poster grid or a new product mode in this subsystem.
- Keep the current playback behavior, recovery behavior, finite content flow, Guide flow and panel browse depth unchanged.
- `App.tsx` remains the screen stack owner, tuner owner and top level product mode boundary. The current `contentKind` stays legacy panel state until subsystem 3 promotes product modes.
- Only the highest open surface owns input. The order is picture, one primary surface, one drawer, one modal and one confirmation popup.
- A drawer keeps ownership throughout its closing transition, and its hidden caller receives no key while that drawer remains open.
- A toast, Live title banner, playback information, dialled number and picture status never become focus owning surfaces.
- Preserve the current provider content without interpreting or rewriting names, groups, languages or categories.
- Add no runtime dependency, hosted service, analytics, provider administration, bundled content or model year branch.
- Production code continues to target ES2019 and Chromium 69 without unsupported runtime methods, CSS `aspect-ratio`, CSS `inset` shorthand or unguarded flex gap.
- Do no IndexedDB work or other expensive work in a direction, OK, Back, transport or long press path.
- Do not change `src/styles/app.css`, locale copy or public assets because this subsystem changes ownership and file boundaries only.
- Write focused tests before each behavior preserving extraction, but do not run tests, lint, type checking, builds or television gates during Tasks 1 through 4 because Shayan explicitly deferred all automated execution to the final pre push gate.
- Local task commits are part of the approved implementation. Every commit uses the required Devin generation and coauthor trailers. Do not push until Shayan explicitly asks.
- The final gate section is a command manifest for master plan Task 7. Do not execute it after this subsystem because all automated commands run once after every subsystem review passes.

## Review Focus

- A key that starts while one surface owns input and ends after another surface opens must not invoke a stale short press action. Task 2 adds this test.
- Native repeat events and repeated development remote key down events must produce one long action and no short action. Task 2 adds this test.
- Guide must retain key ownership while its closing animation runs, so a second Back or direction cannot reach the picture or panel early. Task 4 adds this test.
- A Settings confirmation popup must receive one key without Settings or the panel moving behind it. Task 1 adds this test.
- Xtream Movies and Series must still open inside the current `.panel`, preserve nested Back behavior and avoid rendering a new VOD surface. Task 4 adds this test.

## File Structure

- Create `src/services/surfaceStack.ts` for the explicit stack types and the pure highest surface resolver.
- Create `src/hooks/useLongPress.ts` for one key press lifecycle from key down through short or long completion.
- Create `src/screens/LiveScreen.tsx` for the current picture, Guide, panel rendering, browse state and live surface key handlers.
- Modify `src/App.tsx` so it owns the application root, controlled surface state, tuner, modal surfaces, transient shell overlays and remote access lifecycle.
- Modify `src/hooks/useTuner.ts` so the active screen supplies the exact channel list to each channel step rather than making the shell retain panel selection state.
- Modify `src/components/Settings.tsx` so it reports whether a nested confirmation popup is open to the application stack without changing confirmation behavior.
- Create `tests/surfaceStack.test.ts` for stack precedence and explicit surface identities.
- Create `tests/useLongPress.test.tsx` for short press, long press, repeat, cancellation and cleanup behavior.
- Modify `tests/tuner.test.tsx` for the caller supplied channel step list.
- Modify `tests/keyLaws.test.tsx`, `tests/panelNav.test.tsx`, `tests/library-ui.test.tsx` and `tests/settings-ui.test.tsx` for surface ownership and unchanged current behavior.
- Modify `AGENTS.md` and `docs/design.md` with the new source boundary, explicit stack and Live specific key wording.
- Leave `src/styles/app.css`, `src/locales/`, `src/services/player.ts`, `src/stores/library.ts` and the current panel presentation components unchanged.

---

### Task 1: Explicit Surface Stack

**Files:**
- Create: `src/services/surfaceStack.ts`
- Modify: `src/App.tsx:208-280, 2652-2656, 3174-3199`
- Modify: `src/components/Settings.tsx:66-74, 96-123, 248-365`
- Create: `tests/surfaceStack.test.ts`
- Modify: `tests/settings-ui.test.tsx:1-110, 423-471`

**Interfaces:**
- Produces: `PictureSurface = "picture"` and `PrimarySurface = "panel"`.
- Produces: `DrawerSurface = "guide"`.
- Produces: `ModalSurface = "settings" | "onboarding" | "exit"`.
- Produces: `PopupSurface = "confirmation"`.
- Produces: `LiveSurface = PictureSurface | PrimarySurface` and `SurfaceId = LiveSurface | DrawerSurface | ModalSurface | PopupSurface`.
- Produces: `SurfaceStack`, `SurfaceKeyHandler = (code: number, event: KeyboardEvent) => void`, and `activeSurface(stack: SurfaceStack): SurfaceId` from `src/services/surfaceStack.ts`.
- Changes: `Settings` accepts `onPopupChange?: (open: boolean) => void` and reports its existing `asking` state, including a final `false` during unmount.
- Consumes later: Task 4 dispatches each key only to the handler named by `activeSurface`.

```ts
export type PictureSurface = "picture";
export type PrimarySurface = "panel";
export type DrawerSurface = "guide";
export type ModalSurface = "settings" | "onboarding" | "exit";
export type PopupSurface = "confirmation";
export type LiveSurface = PictureSurface | PrimarySurface;
export type SurfaceId = LiveSurface | DrawerSurface | ModalSurface | PopupSurface;
export type SurfaceKeyHandler = (code: number, event: KeyboardEvent) => void;

export interface SurfaceStack {
  picture: PictureSurface;
  primary: PrimarySurface | null;
  drawer: DrawerSurface | null;
  modal: ModalSurface | null;
  popup: PopupSurface | null;
}

export function activeSurface(stack: SurfaceStack): SurfaceId;
```

- [ ] **Step 1: Write the failing surface precedence tests**

Create direct tests for every occupied depth and for the complete stack. Keep the expected order in the assertions rather than duplicating implementation conditionals.

```ts
test("the highest open surface owns input", () => {
  expect(
    activeSurface({
      picture: "picture",
      primary: "panel",
      drawer: "guide",
      modal: "settings",
      popup: "confirmation",
    }),
  ).toBe("confirmation");

  expect(
    activeSurface({
      picture: "picture",
      primary: "panel",
      drawer: "guide",
      modal: "settings",
      popup: null,
    }),
  ).toBe("settings");
  expect(
    activeSurface({
      picture: "picture",
      primary: "panel",
      drawer: "guide",
      modal: null,
      popup: null,
    }),
  ).toBe("guide");
  expect(
    activeSurface({
      picture: "picture",
      primary: "panel",
      drawer: null,
      modal: null,
      popup: null,
    }),
  ).toBe("panel");
  expect(
    activeSurface({
      picture: "picture",
      primary: null,
      drawer: null,
      modal: null,
      popup: null,
    }),
  ).toBe("picture");
});
```

- [ ] **Step 2: Write the failing popup ownership integration test**

Open Settings, open an existing destructive confirmation, press one direction and assert that focus moves once inside the dialog while the selected Settings section and panel cursor remain unchanged.

```ts
const section = document.querySelector(".sheet-rail .row.selected")?.textContent;
const panelRow = document.querySelector(".panel .row.selected")?.textContent;
press(KEY.RIGHT);
expect(document.querySelector(".dialog")).toBeTruthy();
expect(document.querySelector(".sheet-rail .row.selected")?.textContent).toBe(section);
expect(document.querySelector(".panel .row.selected")?.textContent).toBe(panelRow);
expect(document.activeElement?.closest(".dialog")).toBeTruthy();
```

- [ ] **Step 3: Record the deferred Task 1 test command**

Do not run this command during implementation. Record it in the deferred command ledger under Task 5.

```bash
npm test -- tests/surfaceStack.test.ts tests/settings-ui.test.tsx
```

Expected final result: PASS. Before implementation the surface module is missing and Settings does not report popup depth.

- [ ] **Step 4: Implement the pure stack resolver**

Implement `activeSurface(stack: SurfaceStack): SurfaceId` with the fixed precedence `popup`, `modal`, `drawer`, `primary`, then `picture`. Keep presentation details, DOM queries and keyboard handling out of this service.

- [ ] **Step 5: Make `App.tsx` own the controlled stack state**

Keep the existing `View` state in this task and map `watch` to no primary surface while `panel` maps to the panel surface. Derive `drawer` from `guideChannelId`, derive exactly one `modal`, track Settings popup visibility and memoize one `SurfaceStack`. Use `activeSurface` as the only value passed to later input delegation. Task 3 replaces `View` with the controlled `LiveSurface` type during extraction.

- [ ] **Step 6: Report Settings popup state without changing Settings navigation**

Call `onPopupChange(asking)` when the existing confirmation state changes and call `onPopupChange(false)` when Settings unmounts. Keep `Settings` and `Confirm` as their existing key owners in this task, because Task 4 only needs the shell to stand aside while those surfaces are open.

- [ ] **Step 7: Review Task 1 manually without automated execution**

Inspect the diff for a pure precedence function, one modal selection path, stable callback cleanup and no new rendered element, class name, style, copy or timer. Confirm that no command from Step 3 ran.

- [ ] **Step 8: Commit Task 1 only after explicit approval**

```bash
git add src/services/surfaceStack.ts src/App.tsx src/components/Settings.tsx tests/surfaceStack.test.ts tests/settings-ui.test.tsx
git commit -m "refactor: define application surface ownership"
```

### Task 2: Long Press Ownership

**Files:**
- Create: `src/hooks/useLongPress.ts`
- Modify: `src/App.tsx:1337-1482`
- Create: `tests/useLongPress.test.tsx`
- Modify: `tests/keyLaws.test.tsx:125-173, 381-397`
- Modify: `tests/library-ui.test.tsx:215-261`

**Interfaces:**
- Consumes: `SurfaceId` from Task 1 for the caller supplied `enabled` decision.
- Produces: `LongPressOptions` and `useLongPress(options: LongPressOptions): void`.
- Preserves: the existing 500 millisecond threshold, first native repeat as long activation, one long callback, no short callback after long activation and development Smart Remote key down compatibility.
- Consumes later: Task 4 calls the hook from `LiveScreen` for picture OK and the current Red category actions.

```ts
export interface LongPressOptions {
  code: number;
  enabled: boolean;
  delayMs?: number;
  onShortPress: () => void;
  onLongPress: () => void;
}

export function useLongPress(options: LongPressOptions): void;
```

- [ ] **Step 1: Write failing short and long press tests**

Use fake timers and real window keyboard events. Assert callback counts rather than implementation timers.

```ts
test("a release before the threshold performs one short action", () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  renderHook(() =>
    useLongPress({ code: KEY.ENTER, enabled: true, delayMs: 500, onShortPress: shortPress, onLongPress: longPress }),
  );

  pressDown(KEY.ENTER);
  release(KEY.ENTER);

  expect(shortPress).toHaveBeenCalledOnce();
  expect(longPress).not.toHaveBeenCalled();
});

test("timeout or repeat performs one long action and suppresses short", async () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  renderHook(() =>
    useLongPress({ code: KEY.ENTER, enabled: true, delayMs: 500, onShortPress: shortPress, onLongPress: longPress }),
  );

  pressDown(KEY.ENTER);
  await settle(500);
  pressDown(KEY.ENTER, true);
  release(KEY.ENTER);

  expect(longPress).toHaveBeenCalledOnce();
  expect(shortPress).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing cancellation and cleanup tests**

Cover an unrelated key, disabled ownership, a surface change while the key is held and unmount before the timeout. The surface change test pins the first Review Focus item.

```ts
test("changing surface while a key is held cancels both actions", () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  const { rerender } = renderHook(
    ({ enabled }) =>
      useLongPress({ code: KEY.ENTER, enabled, delayMs: 500, onShortPress: shortPress, onLongPress: longPress }),
    { initialProps: { enabled: true } },
  );

  pressDown(KEY.ENTER);
  rerender({ enabled: false });
  release(KEY.ENTER);

  expect(shortPress).not.toHaveBeenCalled();
  expect(longPress).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Record the deferred Task 2 test command**

Do not run this command during implementation. Record it in the deferred command ledger under Task 5.

```bash
npm test -- tests/useLongPress.test.tsx tests/keyLaws.test.tsx tests/library-ui.test.tsx
```

Expected final result: PASS. Before implementation the hook is missing.

- [ ] **Step 4: Implement one stable long press listener**

Store callbacks and `enabled` in refs so callback identity changes do not replace global listeners during a press. Consume only the configured key after an enabled press starts, trigger long once from either the timer or the first `event.repeat`, cancel on disabled ownership or unmount and allow unrelated events through unchanged.

- [ ] **Step 5: Replace the two bespoke App effects**

Use one hook instance for `KEY.RED` and one for `KEY.ENTER`. Preserve the existing Red short category visibility action, Red long hidden category reveal, OK short picture action and OK long playback information toggle. Preserve the current no action result for Red on the picture and Guide so it cannot fall through and raise the banner.

- [ ] **Step 6: Keep development remote long presses on the same event path**

Do not change `SmartRemote.tsx`. Its pointer hold must continue sending repeated key down events followed by one key up, which the hook treats as one physical press.

- [ ] **Step 7: Review Task 2 manually without automated execution**

Trace short key down and key up, timer completion, native repeat, repeated nonrepeat key down from Smart Remote, ownership cancellation and unmount. Confirm each path clears its timer and that no command from Step 3 ran.

- [ ] **Step 8: Commit Task 2 only after explicit approval**

```bash
git add src/hooks/useLongPress.ts src/App.tsx tests/useLongPress.test.tsx tests/keyLaws.test.tsx tests/library-ui.test.tsx
git commit -m "refactor: centralise long press handling"
```

### Task 3: Live Screen Extraction

**Files:**
- Create: `src/screens/LiveScreen.tsx`
- Modify: `src/App.tsx:1-3220`
- Modify: `src/hooks/useTuner.ts:76-150, 605-623`
- Modify: `tests/tuner.test.tsx:1-160`
- Modify: `tests/keyLaws.test.tsx:36-61, 125-173`
- Verify later without editing unless a regression needs a focused assertion: `tests/launch.test.tsx`
- Verify later without editing unless a regression needs a focused assertion: `tests/banner.test.tsx`
- Verify later without editing unless a regression needs a focused assertion: `tests/resume.test.tsx`
- Verify later without editing unless a regression needs a focused assertion: `tests/search.test.tsx`
- Verify later without editing unless a regression needs a focused assertion: `tests/favourites.test.tsx`
- Verify later without editing unless a regression needs a focused assertion: `tests/guide-ui.test.tsx`
- Verify later without editing unless a regression needs a focused assertion: `tests/library-ui.test.tsx`

**Interfaces:**
- Consumes: `SurfaceId` and `LiveSurface` from Task 1, `useLongPress` from Task 2, `Tuner`, `Chrome` and existing stores and presentation components.
- Produces: `LiveScreenProps` and `LiveScreen(props: LiveScreenProps): React.ReactElement`.
- Changes: export `TuneItem = Channel | PlaybackTarget`, remove `list` from `TunerOptions` and change `Tuner.step` to `step(delta: number, list: readonly TuneItem[]): void`.
- Keeps in `App.tsx`: application root, locale direction, remote key registration, playlist load and cache sweep, tuner construction, `SurfaceStack`, Settings, onboarding, exit confirmation, Clock, transient shell overlays, pointer pad, development remote and remote access lifecycle.
- Moves to `LiveScreen.tsx`: the current picture and panel constants, category and browse state, search and media state, Guide state except its open channel identifier, current panel markup, picture and banner markup, playback information, finite selection effects and every picture, panel and Guide action.

```ts
export interface LiveScreenProps {
  surface: SurfaceId;
  liveSurface: LiveSurface;
  onLiveSurfaceChange: (surface: LiveSurface) => void;
  guideChannelId: string;
  onGuideChannelChange: (channelId: string) => void;
  tuner: Tuner;
  chrome: Chrome;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onToggleFullscreen: () => void;
  onOpenSettings: () => void;
  onRequestExit: () => void;
}

export function LiveScreen(props: LiveScreenProps): React.ReactElement;
```

```ts
export type TuneItem = Channel | PlaybackTarget;

export interface Tuner {
  step: (delta: number, list: readonly TuneItem[]) => void;
}
```

- [ ] **Step 1: Write the failing caller supplied tuner list test**

Prove that the list owned by the active screen controls channel movement without reconstructing the tuner.

```ts
test("channel stepping uses the list supplied by the active screen", async () => {
  const { result } = mount(false);
  const first = { ...live, id: "live-1", url: "http://example.invalid/1.m3u8" };
  const second = { ...live, id: "live-2", url: "http://example.invalid/2.m3u8" };

  act(() => result.current.start(first));
  act(() => result.current.step(1, [first, second]));
  await act(async () => vi.advanceTimersByTimeAsync(450));

  const calls = playerMock.instances[0].play.mock.calls;
  expect(calls[calls.length - 1][0]).toBe(second.url);
});
```

- [ ] **Step 2: Add the shell extraction smoke assertions**

Extend the whole application test to assert one root, one video on the browser path, one panel and unchanged initial panel content after the component move.

```ts
await mount();
expect(document.querySelectorAll(".app")).toHaveLength(1);
expect(document.querySelectorAll("video.video")).toHaveLength(1);
expect(document.querySelectorAll(".panel")).toHaveLength(1);
expect(screen.getByText("Alpha")).toBeTruthy();
```

- [ ] **Step 3: Record the deferred Task 3 test commands**

Do not run these commands during implementation. Record them in the deferred command ledger under Task 5.

```bash
npm test -- tests/tuner.test.tsx tests/keyLaws.test.tsx
npm test -- tests/launch.test.tsx tests/banner.test.tsx tests/resume.test.tsx tests/search.test.tsx tests/favourites.test.tsx tests/guide-ui.test.tsx tests/library-ui.test.tsx
```

Expected final result: PASS. Before implementation `Tuner.step` still closes over one list and `LiveScreen` does not exist.

- [ ] **Step 4: Make channel step ownership explicit at the tuner boundary**

Remove `list` from `TunerOptions`, export `TuneItem` and accept the list on each `step` call. Keep the existing wrap arithmetic, preview response, 450 millisecond settle interval, tune cancellation and target conversion unchanged.

- [ ] **Step 5: Build the thin `App.tsx` shell**

Keep `useTuner` in `App.tsx`. Implement its `rememberLast` callback by reading the current channel, active playlist and personal store snapshots so the callback does not require panel state in the shell. Keep application load, cache sweep, remote access and modal mute behavior in the shell.

- [ ] **Step 6: Move the current Live and legacy library screen into `LiveScreen.tsx`**

Move the existing JSX without changing element order, class names, conditions, accessible names or pointer callbacks. Move the state and effects that only support that JSX, including panel browse frames, search, category cursors, Guide, finite selection and banner interaction. Pass `visible` to every live `tuner.step(delta, visible)` call so behavior remains identical.

- [ ] **Step 7: Keep the existing Movies and Series panel intact**

Keep `contentKind`, `ContentSelector`, `MediaList`, `MediaDetails`, `useBrowseStack` and the existing finite playback entry points inside `LiveScreen`. Do not create `VodScreen`, stop playback on content selector changes or make Movies and Series opaque because those changes belong to subsystem 3.

- [ ] **Step 8: Preserve the root and shell overlays in `App.tsx`**

Render `LiveScreen` inside the existing `.app` root, then render Clock, Settings, exit confirmation, onboarding, digits, toast, load errors, pointer pad and development Smart Remote in their current DOM order. Keep `appRef` and fullscreen ownership in the shell.

- [ ] **Step 9: Review Task 3 manually without automated execution**

Compare the moved JSX line by line against the old render tree, compare every moved effect dependency and inspect all `tuner.step` callers. Confirm there is no duplicate store subscription that performs work, no new timer, no changed copy and no command from Step 3 ran.

- [ ] **Step 10: Commit Task 3 only after explicit approval**

```bash
git add src/App.tsx src/screens/LiveScreen.tsx src/hooks/useTuner.ts tests/tuner.test.tsx tests/keyLaws.test.tsx
git commit -m "refactor: extract the live screen"
```

### Task 4: Surface Key Delegation and Documentation

**Files:**
- Modify: `src/screens/LiveScreen.tsx`
- Modify: `tests/keyLaws.test.tsx:18-305`
- Modify: `tests/panelNav.test.tsx:1-419`
- Modify: `tests/library-ui.test.tsx:180-261`
- Modify: `tests/settings-ui.test.tsx:1-110, 423-471`
- Modify: `AGENTS.md:58-92, 118-128`
- Modify: `docs/design.md:10-56, 104-166, 223-233`
- Verify later without editing unless a regression needs a focused assertion: `tests/search.test.tsx`
- Verify later without editing unless a regression needs a focused assertion: `tests/rtl-controls.test.tsx`

**Interfaces:**
- Consumes: `surface: SurfaceId` from `App.tsx`, the long press hook and the existing action callbacks moved in Task 3.
- Produces privately in `LiveScreen.tsx`: `onSharedKey(code: number, event: KeyboardEvent): boolean`, `onPictureKey(code: number, event: KeyboardEvent): void`, `onGuideKey(code: number, event: KeyboardEvent): void`, `onPanelKey(code: number, event: KeyboardEvent): void` and `onKey(code: number, event: KeyboardEvent): void`.
- Guarantees: `onKey` invokes at most one focus owning surface handler for each event, while shared physical transport, channel, colour and digit semantics remain unchanged where the current application supports them.
- Documents: the explicit stack, `App.tsx` ownership, `LiveScreen.tsx` ownership and Live specific scope of the existing picture key laws.

```ts
import type { SurfaceKeyHandler } from "../services/surfaceStack";

const onSharedKey: (code: number, event: KeyboardEvent) => boolean;
const onPictureKey: SurfaceKeyHandler;
const onGuideKey: SurfaceKeyHandler;
const onPanelKey: SurfaceKeyHandler;
const onKey: SurfaceKeyHandler;
```

- [ ] **Step 1: Write the failing cross surface ownership tests**

Add tests proving Up in the panel moves its selected row without tuning, Guide owns directions and Back until its closing timer completes, Settings blocks panel movement and the picture receives keys again only after the higher surface closes.

```ts
test("the panel owns directions while it is open", async () => {
  await mount();
  const started = played.length;
  press(KEY.DOWN);
  await settle();
  expect(played).toHaveLength(started);
  expect(document.querySelector(".list .row.selected .row-label")?.textContent).toBe("Beta");
});

test("Guide keeps ownership throughout its closing transition", async () => {
  await openGuideFixture();
  press(KEY.BACK);
  press(KEY.UP);
  expect(document.querySelector(".guide-drawer.closing")).toBeTruthy();
  expect(panelOpen()).toBe(false);
  await settle(180);
  expect(document.querySelector(".guide-drawer")).toBeNull();
});
```

- [ ] **Step 2: Write the failing legacy Movies and Series placement test**

Pin the subsystem boundary directly so this refactor cannot introduce the later VOD shell early.

```ts
await mountLibrary();
fireEvent.click(screen.getByRole("button", { name: "Movies" }));
expect(panelOpen()).toBe(true);
expect(document.querySelector(".panel .media-list")).toBeTruthy();
expect(document.querySelector(".vod-screen")).toBeNull();
press(KEY.BACK);
expect(panelOpen()).toBe(false);
```

- [ ] **Step 3: Narrow the key law test names without changing current behavior**

Replace absolute prose such as “at the picture, always” with “at the Live picture”. Keep tests for Live Up and Down, Live OK, panel movement and Back depth. Do not add subsystem 2 finite playback deck, seeking or revised transport assertions.

- [ ] **Step 4: Record the deferred Task 4 test command**

Do not run this command during implementation. Record it in the deferred command ledger under Task 5.

```bash
npm test -- tests/keyLaws.test.tsx tests/panelNav.test.tsx tests/library-ui.test.tsx tests/settings-ui.test.tsx tests/search.test.tsx tests/rtl-controls.test.tsx
```

Expected final result: PASS. Before implementation one App callback owns picture, Guide and panel branches rather than delegating by the explicit surface.

- [ ] **Step 5: Split shared semantic keys from focus owning surface keys**

Keep the existing transport, Yellow, Green, channel key and digit order in `onSharedKey`. Return `true` only when that key is consumed. Preserve text field exceptions and current no action keys. Do not let shared handling invoke a lower surface after it consumes a key.

- [ ] **Step 6: Give each current surface one handler**

Move picture behavior into `onPictureKey`, Guide behavior into `onGuideKey` and the complete existing panel branch into `onPanelKey`. Keep search field caret ownership, right to left inline directions, title bar movement, rail settle behavior, media frame Back behavior and Guide closing state unchanged.

- [ ] **Step 7: Dispatch through `activeSurface` once**

Return immediately for `settings`, `onboarding`, `exit` and `confirmation`, because their existing components own those events. For `guide`, `panel` and `picture`, run shared handling once and then invoke only the matching handler when shared handling did not consume the event.

- [ ] **Step 8: Move long press calls to their final owner**

Call `useLongPress` from `LiveScreen` before `useRemote(onKey)`. Enable OK long press only for `picture`. Keep Red events consumed across the current Live screen surfaces so irrelevant Red presses retain their existing no action result, but invoke Red category callbacks only while `panel` owns input.

- [ ] **Step 9: Update `AGENTS.md` in the same commit as the key contract extraction**

Update the project map so `App.tsx` names stack, tuner and mode ownership, while `screens/LiveScreen.tsx` names Live picture, Guide and current panel ownership. Replace the old absolute key invariant with Live picture wording, and state that the highest open focus owning surface receives input.

- [ ] **Step 10: Update `docs/design.md` in the same commit as the key contract extraction**

Replace the old four layer table with the approved five level surface model. Explain that App resolves the stack and LiveScreen delegates to one current owner. Narrow the current Up and Down law to the Live picture, retain the current panel and Movies and Series descriptions and avoid documenting subsystem 2 or subsystem 3 behavior as implemented.

- [ ] **Step 11: Review Task 4 manually without automated execution**

Trace every key branch from the old `App.tsx` callback to one new owner, compare all `preventDefault` decisions and check the updated docs against the approved spec. Confirm that no command from Step 4 ran.

- [ ] **Step 12: Commit Task 4 only after explicit approval**

```bash
git add src/screens/LiveScreen.tsx tests/keyLaws.test.tsx tests/panelNav.test.tsx tests/library-ui.test.tsx tests/settings-ui.test.tsx AGENTS.md docs/design.md
git commit -m "refactor: delegate keys to active surfaces"
```

### Task 5: Final Pre Push Gate

**Files:**
- Review: every file changed in Tasks 1 through 4
- Do not modify unrelated files to make an unrelated gate pass

**Interfaces:**
- Consumes: all production, test and documentation changes from Tasks 1 through 4.
- Produces: one reviewed subsystem diff whose focused tests, complete repository checks, build and relevant television gates pass before any push.
- Excludes: WebAssembly verification because this subsystem does not change `wasm/`, `public/wasm/`, workers, checksums or repair integration.

- [ ] **Step 1: Confirm the implementation phase ran no automated check**

Review the task record and confirm tests, lint, type checking, builds and television gates were deferred exactly as requested. If any command ran accidentally, record it rather than repeating it.

- [ ] **Step 2: Review the complete diff before automated execution**

Inspect all production, test and documentation changes. Check for unchanged markup and classes, no new VOD screen, no moved runtime ownership into Settings or player adapters, no dead App imports, no duplicate key listeners, no stale absolute finite key law wording and no unrelated change.

- [ ] **Step 3: Review the deferred focused command ledger**

These are the exact focused commands deferred from implementation. Keep them available for diagnosis if the complete suite identifies a failure. Do not run them before the complete suite because `npm test` below already includes every listed test and repository rules prohibit repeating a passing check without an invalidating edit.

```bash
npm test -- tests/surfaceStack.test.ts tests/settings-ui.test.tsx
npm test -- tests/useLongPress.test.tsx tests/keyLaws.test.tsx tests/library-ui.test.tsx
npm test -- tests/tuner.test.tsx tests/keyLaws.test.tsx
npm test -- tests/launch.test.tsx tests/banner.test.tsx tests/resume.test.tsx tests/search.test.tsx tests/favourites.test.tsx tests/guide-ui.test.tsx tests/library-ui.test.tsx
npm test -- tests/keyLaws.test.tsx tests/panelNav.test.tsx tests/library-ui.test.tsx tests/settings-ui.test.tsx tests/search.test.tsx tests/rtl-controls.test.tsx
```

- [ ] **Step 4: Run the complete lint, type and test gate once**

Run these commands only after Tasks 1 through 4 and manual diff review are complete.

```bash
npm run lint
npm run typecheck
npm test
```

Expected: PASS with no lint error, no TypeScript error and every unit and component test passing. If a failure is related to this subsystem, use the matching focused command from Step 3 after a corrective edit. If a failure is unrelated, confirm it against the unchanged baseline when practical and report it without expanding scope.

- [ ] **Step 5: Build the application**

```bash
npm run build
```

Expected: PASS with one production artifact, no new runtime dependency and no development only input code in the production bundle.

- [ ] **Step 6: Run the spacing and engine television gates**

```bash
npm run tv:gap
npm run tv:engines
```

Expected: PASS with the unchanged panel structure matching both spacing paths and with identical key ownership behavior on Chromium 69 and Chromium 120.

- [ ] **Step 7: Run the television performance budget on a quiet machine**

```bash
npm run tv:budget
```

Expected: PASS without a relevant launch, held direction, panel, search or rendering regression. Read the machine load in the report before treating a failure as a product regression.

- [ ] **Step 8: Run repository integrity checks**

```bash
git diff --check
git status --short
git diff --stat
git diff
```

Expected: no whitespace errors, temporary files, generated artifacts, dependency changes, CSS changes, locale changes or unrelated modifications. The complete diff contains only the approved shell subsystem, its tests and its documentation.

- [ ] **Step 9: Perform the subsystem review loop**

Request independent read only reviews for architecture boundaries, key ownership correctness, Samsung remote behavior, right to left behavior, accessibility, Chromium 69 compatibility and television performance. Validate each finding with file and line evidence. Fix confirmed findings with a focused assertion first, then rerun only the invalidated check and the relevant review until no blocking or high confidence finding remains.

- [ ] **Step 10: Prepare for push only after explicit approval**

Confirm all authorised commits use Shayan's personal identity, the branch contains no uncommitted implementation work and Shayan has reviewed the complete diff. Do not push without a separate explicit instruction.
