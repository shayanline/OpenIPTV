import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { SettingsDialog } from "../src/components/settings/SettingsDialog";
import { OptionPicker } from "../src/components/OptionPicker";
import { press, settle } from "./support/app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function dialogElement() {
  return document.querySelector<HTMLElement>("[data-settings-dialog]");
}

function scrim() {
  return document.querySelector<HTMLElement>(".settings-dialog-scrim");
}

function renderDialog(overrides: Partial<Parameters<typeof SettingsDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const view = render(
    <SettingsDialog
      title="Rename"
      inputEnabled
      onClose={onClose}
      onSave={onSave}
      {...overrides}
    >
      <div className="form">
        <label htmlFor="dialog-name">Name</label>
        <input id="dialog-name" data-settings-detail-first defaultValue="Alpha" />
        <label htmlFor="dialog-note">Note</label>
        <input id="dialog-note" defaultValue="Beta" />
        <input id="dialog-disabled" disabled defaultValue="Off" />
      </div>
    </SettingsDialog>,
  );
  return { onClose, onSave, view };
}

test("the dialog is modal, traps Tab and keeps disabled controls out of the cycle", async () => {
  renderDialog();
  const dialog = dialogElement()!;
  expect(dialog.getAttribute("role")).toBe("dialog");
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.getAttribute("aria-label")).toBe("Rename");
  expect(dialog.querySelector(".page-key-guide")?.textContent).toContain("Return");

  const name = document.getElementById("dialog-name")!;
  const cancel = screen.getByRole("button", { name: "Cancel" });
  const save = screen.getByRole("button", { name: "Save" });
  expect(dialog.contains(document.activeElement)).toBe(true);

  // The footer orders Cancel before Save, so Save is the last control in
  // the cycle and Cancel sits between the fields and it.
  expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  save.focus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(document.activeElement).toBe(name);

  name.focus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(save);
});

test("Tab wraps between the enabled controls and skips disabled ones", () => {
  render(
    <SettingsDialog title="Busy" inputEnabled onClose={vi.fn()} onSave={vi.fn()} saveDisabled>
      <button type="button" disabled>
        Only
      </button>
      <input id="dialog-real-first" />
    </SettingsDialog>,
  );
  const first = document.getElementById("dialog-real-first")!;
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(document.activeElement).toBe(first);

  cancel.focus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(document.activeElement).toBe(first);

  first.focus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(cancel);
});

test("with every control disabled Tab keeps focus on the dialog panel", () => {
  render(
    <SettingsDialog title="Busy" inputEnabled onClose={vi.fn()} onSave={vi.fn()} busy>
      <div className="form">
        <input id="dialog-name" data-settings-detail-first disabled defaultValue="Alpha" />
      </div>
    </SettingsDialog>,
  );
  const dialog = dialogElement()!;
  expect(document.activeElement).toBe(dialog);

  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(dialog);
});

test("Back blurs a focused field first and only then closes the dialog", async () => {
  const { onClose } = renderDialog();
  const name = document.getElementById("dialog-name")!;
  name.focus();
  expect(document.activeElement).toBe(name);

  press(KEY.BACK);
  await settle(0);
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(name);

  press(KEY.BACK);
  await settle(0);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the backdrop dismisses but busy blocks dismissal, save and repeat saves", async () => {
  const { onClose, onSave, view } = renderDialog();
  fireEvent.click(scrim()!);
  expect(onClose).toHaveBeenCalledTimes(1);

  view.rerender(
    <SettingsDialog title="Rename" inputEnabled onClose={onClose} onSave={onSave} busy>
      <div className="form">
        <input id="dialog-name" data-settings-detail-first defaultValue="Alpha" />
      </div>
    </SettingsDialog>,
  );
  const save = screen.getByRole("button", { name: "Save" });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  expect(dialogElement()!.getAttribute("aria-busy")).toBe("true");

  fireEvent.click(scrim()!);
  press(KEY.BACK);
  await settle(0);
  expect(onClose).toHaveBeenCalledTimes(1);

  fireEvent.click(save);
  press(KEY.ENTER);
  await settle(0);
  expect(onSave).not.toHaveBeenCalled();
});

test("virtual Enter on Save invokes onSave once per press", async () => {
  const { onSave } = renderDialog();
  const save = screen.getByRole("button", { name: "Save" });
  save.focus();
  press(KEY.ENTER);
  await settle(0);
  expect(onSave).toHaveBeenCalledTimes(1);
});

test("caret arrows stay inside a field until its boundary", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const left = this.id === "dialog-note" ? 0 : this.id === "dialog-name" ? 200 : 400;
    return {
      top: 0,
      bottom: 40,
      left,
      right: left + 200,
      width: 200,
      height: 40,
      x: left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
  renderDialog();
  const name = document.getElementById("dialog-name") as HTMLInputElement;
  name.focus();
  name.setSelectionRange(2, 2);
  press(KEY.LEFT);
  await settle(0);
  expect(document.activeElement).toBe(name);
  press(KEY.RIGHT);
  await settle(0);
  expect(document.activeElement).toBe(name);

  name.setSelectionRange(0, 0);
  press(KEY.LEFT);
  await settle(0);
  expect(document.activeElement).not.toBe(name);
});

test("an open OptionPicker inside the dialog consumes its own keys first", async () => {
  render(
    <SettingsDialog title="Edit" inputEnabled onClose={vi.fn()} onSave={vi.fn()}>
      <OptionPicker
        label="Format"
        value="hls"
        options={[
          { value: "hls", label: "HLS" },
          { value: "ts", label: "MPEG-TS" },
        ]}
        onChange={vi.fn()}
      />
    </SettingsDialog>,
  );
  const picker = document.querySelector<HTMLElement>(".option-picker")!;
  const trigger = picker.querySelector<HTMLElement>(".option-picker-current")!;
  trigger.focus();
  fireEvent.click(trigger);
  await settle(0);
  const list = screen.getByRole("listbox");
  expect(list).toBeTruthy();

  press(KEY.DOWN);
  await settle(0);
  const active = document.activeElement as HTMLElement;
  expect(list.contains(active)).toBe(true);
  expect(dialogElement()).toBeTruthy();
});

test("suspension releases only the dialog's own field and an upper dialog keeps focus", async () => {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const body = (enabled: boolean, busy = false) => (
    <SettingsDialog
      title="Rename"
      inputEnabled={enabled}
      onClose={onClose}
      onSave={onSave}
      busy={busy}
    >
      <div className="form">
        <input id="dialog-name" data-settings-detail-first defaultValue="Alpha" />
      </div>
    </SettingsDialog>
  );
  const view = render(body(true));
  const name = document.getElementById("dialog-name")!;
  expect(document.activeElement).toBe(name);

  view.rerender(body(false));
  await settle(0);
  expect(document.activeElement).not.toBe(name);

  const upper = document.createElement("div");
  upper.setAttribute("role", "dialog");
  const upperButton = document.createElement("button");
  upperButton.textContent = "Upper";
  upper.appendChild(upperButton);
  document.body.appendChild(upper);
  upperButton.focus();

  view.rerender(body(true));
  await settle(0);
  expect(document.activeElement).toBe(upperButton);

  view.rerender(body(false, true));
  await settle(0);
  expect(document.activeElement).toBe(upperButton);

  upper.remove();
  view.rerender(body(true));
  await settle(0);
  expect(dialogElement()!.contains(document.activeElement)).toBe(true);
});

test("a plain outside control does not block focus returning to the dialog", async () => {
  const body = (enabled: boolean) => (
    <SettingsDialog title="Rename" inputEnabled={enabled} onClose={vi.fn()} onSave={vi.fn()}>
      <div className="form">
        <input id="dialog-name" data-settings-detail-first defaultValue="Alpha" />
      </div>
    </SettingsDialog>
  );
  const view = render(body(true));
  view.rerender(body(false));
  await settle(0);

  const outside = document.createElement("button");
  document.body.appendChild(outside);
  outside.focus();
  view.rerender(body(true));
  await settle(0);
  expect(dialogElement()!.contains(document.activeElement)).toBe(true);
  outside.remove();
});

test("the close-only variant renders one labelled close button and focuses the marked option", async () => {
  const onClose = vi.fn();
  render(
    <SettingsDialog title="Category order" inputEnabled onClose={onClose} closeLabel="Done">
      <div role="listbox" aria-label="Category order">
        <button type="button" role="option" aria-selected="true" data-settings-detail-first>
          Provider order
        </button>
        <button type="button" role="option" aria-selected="false">
          Custom Order
        </button>
      </div>
    </SettingsDialog>,
  );
  const dialog = dialogElement()!;
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.querySelector(".dialog-actions-close")).toBeTruthy();
  const actions = [...dialog.querySelectorAll<HTMLElement>(".dialog-actions button")];
  expect(actions).toHaveLength(1);
  expect(actions[0].textContent?.trim()).toBe("Done");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

  const selected = dialog.querySelector('[role="option"][aria-selected="true"]')!;
  expect(document.activeElement).toBe(selected);

  actions[0].focus();
  press(KEY.ENTER);
  await settle(0);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the close-only variant keeps dismissal blocked while busy", async () => {
  const onClose = vi.fn();
  render(
    <SettingsDialog
      title="Category order"
      inputEnabled
      onClose={onClose}
      closeLabel="Done"
      busy
    >
      <div role="listbox" aria-label="Category order">
        <button type="button" role="option" aria-selected="true" disabled>
          Provider order
        </button>
      </div>
    </SettingsDialog>,
  );
  const done = screen.getByRole("button", { name: "Done" });
  expect((done as HTMLButtonElement).disabled).toBe(true);
  expect(dialogElement()!.getAttribute("aria-busy")).toBe("true");

  fireEvent.click(scrim()!);
  press(KEY.BACK);
  await settle(0);
  expect(onClose).not.toHaveBeenCalled();
});

test("the split footer variant places footerStart before Close outside the body", async () => {
  const onClose = vi.fn();
  render(
    <SettingsDialog
      title="Channel order"
      inputEnabled
      onClose={onClose}
      footerStart={
        <button type="button" className="btn tonal" data-lineup-reset-order>
          Reset
        </button>
      }
    >
      <div role="listbox" aria-label="Channel order">
        <button type="button" role="option" aria-selected="true" data-settings-detail-first>
          Provider order
        </button>
        <button type="button" role="option" aria-selected="false">
          Custom Order
        </button>
      </div>
    </SettingsDialog>,
  );
  const dialog = dialogElement()!;
  const actions = dialog.querySelector<HTMLElement>(".dialog-actions")!;
  expect(actions.classList.contains("dialog-actions-split")).toBe(true);
  const body = dialog.querySelector(".settings-dialog-body")!;
  expect(body.contains(actions)).toBe(false);
  expect(actions.closest("[role='listbox']")).toBeNull();
  const buttons = [...actions.querySelectorAll<HTMLButtonElement>("button")];
  expect(buttons).toHaveLength(2);
  expect(buttons[0].textContent).toContain("Reset");
  expect(buttons[1].textContent).toContain("Close");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

  const selected = dialog.querySelector('[role="option"][aria-selected="true"]')!;
  expect(document.activeElement).toBe(selected);

  buttons[1].focus();
  press(KEY.ENTER);
  await settle(0);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("feedback renders outside the scrolling body and before the footer", () => {
  renderDialog({
    feedback: (
      <p className="field-problem" role="alert">
        Check the address.
      </p>
    ),
  });
  const dialog = dialogElement()!;
  const body = dialog.querySelector(".settings-dialog-body")!;
  const slot = dialog.querySelector(".settings-dialog-feedback")!;
  const actions = dialog.querySelector(".dialog-actions")!;
  expect(body.contains(slot)).toBe(false);
  expect(slot.contains(body)).toBe(false);
  expect(slot.textContent).toContain("Check the address.");
  expect(body.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(slot.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(actions.classList.contains("dialog-actions-save")).toBe(true);
});

test("the footer orders Cancel before Save with icons and a stable busy button", () => {
  const busyView = renderDialog({ busy: true, busyLabel: "Validating playlist" });
  const busyActions = document.querySelector<HTMLElement>(".dialog-actions")!;
  const busyButtons = [...busyActions.querySelectorAll<HTMLButtonElement>("button")];
  expect(busyButtons).toHaveLength(2);
  expect(busyButtons[0].className).toContain("tonal");
  expect(busyButtons[0].textContent).toContain("Cancel");
  expect(busyButtons[0].querySelector("svg")).toBeTruthy();
  expect(busyButtons[1].className).toContain("filled");
  expect(busyButtons[1].textContent).toContain("Validating playlist");
  expect(busyButtons[1].getAttribute("aria-busy")).toBe("true");
  expect(busyButtons[1].getAttribute("aria-label")).toBe("Validating playlist");
  expect(busyButtons[1].querySelector(".spinner.small")).toBeTruthy();
  expect(busyButtons[1].querySelector("svg")).toBeNull();
  busyView.view.unmount();

  renderDialog();
  const actions = document.querySelector<HTMLElement>(".dialog-actions")!;
  const buttons = [...actions.querySelectorAll<HTMLButtonElement>("button")];
  expect(buttons).toHaveLength(2);
  expect(buttons[1].querySelector("svg")).toBeTruthy();
  expect(buttons[1].querySelector(".spinner.small")).toBeNull();
  expect(buttons[1].getAttribute("aria-busy")).toBeNull();
});

test("className lands on the dialog panel without a wrapper", () => {
  renderDialog({ className: "playlist-dialog" });
  const dialog = dialogElement()!;
  expect(dialog.className).toContain("settings-dialog");
  expect(dialog.className).toContain("playlist-dialog");
  expect(dialog.parentElement?.className).toBe("settings-dialog-scrim");
});

test.each(["ltr", "rtl"] as const)(
  "option popups remain inside the 48px safe area near viewport edges in %s",
  (direction) => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(600);
    render(
      <OptionPicker
        label="Format"
        value="0"
        options={Array.from({ length: 10 }, (_, index) => ({
          value: String(index),
          label: `Format ${index}`,
        }))}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Format 0/ });
    trigger.style.direction = direction;
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
      direction === "ltr" ? new DOMRect(700, 520, 100, 64) : new DOMRect(0, 0, 100, 64),
    );
    fireEvent.click(trigger);
    const popup = screen.getByRole("listbox");
    const { top, left, width, maxHeight } = popup.style;
    expect(Number.parseFloat(top)).toBeGreaterThanOrEqual(48);
    expect(Number.parseFloat(left)).toBeGreaterThanOrEqual(48);
    expect(Number.parseFloat(top) + Number.parseFloat(maxHeight)).toBeLessThanOrEqual(552);
    expect(Number.parseFloat(left) + Number.parseFloat(width)).toBeLessThanOrEqual(752);
  },
);

test("the OptionPicker keeps check slots as selection moves between labeled options", async () => {
  const onChange = vi.fn();
  const pickerOptions = [
    { value: "m3u8", label: "HLS", secondary: "adaptive" },
    { value: "ts", label: "MPEG-TS", secondary: "legacy" },
  ] as const;
  const picker = (value: "m3u8" | "ts") => (
    <OptionPicker label="Format" value={value} options={pickerOptions} onChange={onChange} />
  );
  const view = render(picker("m3u8"));
  fireEvent.click(screen.getByRole("button", { name: /HLS/ }));
  const options = [...document.querySelectorAll<HTMLElement>(".option-picker-option")];
  expect(options).toHaveLength(2);
  expect(options.every((option) => option.querySelector(".option-picker-check"))).toBe(true);
  expect(
    options.map((option) => option.querySelectorAll(".option-picker-check svg").length),
  ).toEqual([1, 0]);
  expect(options[0]?.querySelector(".option-picker-secondary")?.textContent).toBe("adaptive");
  expect(options[1]?.querySelector(".option-picker-secondary")?.textContent).toBe("legacy");
  fireEvent.click(screen.getByRole("option", { name: "MPEG-TS legacy" }));
  expect(onChange).toHaveBeenCalledWith("ts");
  view.rerender(picker("ts"));
  fireEvent.click(screen.getByRole("button", { name: /MPEG-TS/ }));
  const moved = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(
    moved.find((option) => option.dataset.value === "ts")?.getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    moved.find((option) => option.dataset.value === "m3u8")?.getAttribute("aria-selected"),
  ).toBe("false");
  expect(
    moved.map((option) => option.querySelectorAll(".option-picker-check svg").length),
  ).toEqual([0, 1]);
  expect(moved.every((option) => option.querySelector(".option-picker-check"))).toBe(true);
});
