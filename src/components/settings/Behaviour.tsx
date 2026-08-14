import { useState } from "react";
import { ASPECTS, useSettings } from "../../stores/settings";
import { useChannels } from "../../stores/channels";
import { Choice, Row, Toggle } from "./Field";
import { Confirm } from "../Confirm";
import { forgetAll } from "../../services/disk";

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
      <Row label="Resume the last channel" hint="Start playing it when the app opens">
        <Toggle value={s.resumeLast} onChange={(v) => s.set("resumeLast", v)} />
      </Row>
      <Row label="Sort channels A to Z" hint="Otherwise the playlist's own order is kept">
        <Toggle value={s.sortAlphabetically} onChange={async (v) => {
          s.set("sortAlphabetically", v);
          await load();
        }} />
      </Row>
      <Row label="Hide the channel list after" hint="When you stop pressing anything">
        <Choice
          options={[
            { id: "8", label: "8 seconds" }, { id: "15", label: "15 seconds" },
            { id: "30", label: "30 seconds" }, { id: "0", label: "Keep it open" },
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
        <button type="button" className="btn flat danger" onClick={() => ask(true)}>
          Reset everything to defaults
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
            ask(false);
            void load(true);
          }}
        />
      )}
    </>
  );
}
