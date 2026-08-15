import { useState } from "react";
import { ASPECTS, useSettings } from "../../stores/settings";
import { useChannels } from "../../stores/channels";
import { Choice, Row, Toggle } from "./Field";
import { Confirm } from "../Confirm";
import { forgetAll } from "../../services/disk";
import { forgetRepairHosts, stopRepair } from "../../services/repair";

export function Behaviour({ onAsking }: { onAsking: (asking: boolean) => void }) {
  const s = useSettings();
  const { load, clearPersonal } = useChannels();
  const [confirming, setConfirming] = useState(false);

  const ask = (open: boolean) => { setConfirming(open); onAsking(open); };

  return (
    <>
      <h3>Watching</h3>
      <Row
        label="Picture size"
        hint={ASPECTS.find((a) => a.id === s.aspectId)?.note}
      >
        <Choice options={ASPECTS} value={s.aspectId} onChange={(id) => s.set("aspectId", id)} />
      </Row>
      {/*
        * The hint says only what the label does not. "Resume the last channel" and "start playing
        * it" are the same sentence twice, and the one fact a viewer cannot get from the label is
        * when it happens.
        *
        * Sorting used to sit below this row and now lives under Appearance, beside the other two
        * settings that decide what the channel list shows.
        */}
      <Row label="Resume the last channel" hint="When the app opens">
        <Toggle value={s.resumeLast} onChange={(v) => s.set("resumeLast", v)} />
      </Row>
      {/*
        * Last of the toggles, because it is the one nobody should need.
        *
        * Written for what the viewer sees rather than what it does. "Signed 32 bit media
        * sequence" is the truth and no help; "shows a picture for a moment and stops" is what
        * they are looking at when they come here. The warning about the connection is honest:
        * the television fetches each playlist itself while this is on.
        */}
      {/*
        * The label names the symptom, because "compatibility mode" is a phrase from a settings menu
        * and not from anybody's living room: it tells a viewer nothing about whether they need it,
        * so the whole meaning was carried by the hint, in the smallest type on the screen. Now the
        * label says what they are looking at and the hint says only what it costs.
        */}
      {/* Thirty characters, because One UI asks that a setting's name stay within thirty one so it
          cannot spill onto a second line. "Fix channels that stop after a moment" was thirty six. */}
      <Row
        label="Fix channels that stop playing"
        hint="Repairs a playlist this TV reads wrongly. Uses a little more data."
      >
        <Toggle
          value={s.compatibility}
          onChange={(v) => {
            s.set("compatibility", v);
            // Turning it off has to take effect now, not at the next channel: the socket and its
            // refresh loop are exactly what the viewer just asked to be rid of.
            if (!v) stopRepair();
          }}
        />
      </Row>
      {/*
        * "Never" rather than "keep it open", because the label reads into its options: "hide the
        * channel list after keep it open" is not a sentence, and the viewer has to read the other
        * three chips to work out what the row is even asking.
        */}
      <Row label="Hide the channel list after" hint="When you stop pressing anything">
        <Choice
          options={[
            { id: "4", label: "4 seconds" }, { id: "8", label: "8 seconds" },
            { id: "15", label: "15 seconds" }, { id: "30", label: "30 seconds" },
            { id: "0", label: "Never" },
          ]}
          value={String(s.panelTimeout)}
          onChange={(id) => s.set("panelTimeout", Number(id))}
        />
      </Row>
      <div className="actions">
        {/*
          * Asked before done, like every other question the app puts.
          *
          * It is the most destructive action in the application, on a screen where removing
          * a single playlist already stops to confirm, so going unguarded here would be the
          * one press that undoes everything.
          */}
        {/* "Defaults" is a word from a manual. The dialog behind this button already says what
            happens in the viewer's own terms, that the app goes back to how it started. */}
        <button type="button" className="btn flat danger" onClick={() => ask(true)}>
          Start the app over
        </button>
      </div>

      {confirming && (
        <Confirm
          title="Reset everything?"
          body="Your playlists, favourites and preferences are all removed from this device and the app returns to its first run. The playlists themselves are not touched, so they can be added again from the same addresses."
          confirmLabel="Reset everything"
          cancelLabel="Keep my settings"
          destructive
          onCancel={() => ask(false)}
          onConfirm={() => {
            // "Everything" has to mean everything. Favourites and the last played channel
            // live in the other store and used to survive a reset, so the app came back
            // claiming to be freshly installed while still remembering what you liked. The
            // cached playlists and logos are the third store and had the same problem: an
            // app with no playlists configured, holding a copy of one.
            s.reset();
            clearPersonal();
            void forgetAll();
            // The fourth store, and the same rule: "everything" has to mean everything, and which
            // hosts this television cannot read is a diagnosis it made rather than a fact.
            forgetRepairHosts();
            ask(false);
            void load(true);
          }}
        />
      )}
    </>
  );
}
