import { useState } from "react";
import { useSettings } from "../../stores/settings";
import { clearCache, useChannels } from "../../stores/channels";
import { Confirm } from "../Confirm";
import { forgetAll } from "../../services/disk";
import { forgetRepairHosts } from "../../services/repair";
import { Row, Toggle } from "./Field";

export function General({ onAsking }: { onAsking: (asking: boolean) => void }) {
  const s = useSettings();
  const { load, clearPersonal } = useChannels();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  const ask = (open: boolean) => { setConfirming(open); onAsking(open); };
  const askClear = (open: boolean) => { setClearing(open); onAsking(open); };

  return (
    <>
      <h3>General</h3>
      <Row label="Resume last channel" hint="Open the last channel when the app starts">
        <Toggle label="Resume last channel" value={s.resumeLast} onChange={(v) => s.set("resumeLast", v)} />
      </Row>
      <Row
        label="Clear cache"
        hint="Remove downloaded playlists, logos, and compatibility data from this device"
      >
        <button
          type="button"
          className="btn flat"
          aria-label="Clear cache"
          onClick={() => askClear(true)}
        >
          Clear
        </button>
      </Row>
      {/**
        * Asked before done, like every other question the app puts.
        *
        * It is the most destructive action in the application, on a screen where removing
        * a single playlist already stops to confirm, so going unguarded here would be the
        * one press that undoes everything.
        */}
      <Row
        label="Reset app data"
        hint="Remove playlists, favourites, settings, and cached data from this device"
      >
        <button
          type="button"
          className="btn flat danger"
          aria-label="Reset app data"
          onClick={() => ask(true)}
        >
          Reset
        </button>
      </Row>

      {clearing && (
        <Confirm
          title="Clear cache?"
          body="Cached playlist data, channel logos, and compatibility data are removed from this device. Your playlists, settings, favourites, and last watched channel stay."
          confirmLabel="Clear cache"
          cancelLabel="Cancel"
          onCancel={() => askClear(false)}
          onConfirm={() => {
            void clearCache();
            forgetRepairHosts();
            askClear(false);
          }}
        />
      )}

      {confirming && (
        <Confirm
          title="Reset app data?"
          body="This removes your playlists, favourites, preferences, cached data, and compatibility data from this device. It does not delete the source playlists, so you can add them again."
          confirmLabel="Reset app data"
          cancelLabel="Cancel"
          destructive
          onCancel={() => ask(false)}
          onConfirm={() => {
            // App data has to mean all app data. Favourites and the last played channel
            // live in the other store and used to survive a reset, so the app came back
            // claiming to be freshly installed while still remembering what you liked. The
            // cached playlists and logos are the third store and had the same problem: an
            // app with no playlists configured, holding a copy of one.
            s.reset();
            clearPersonal();
            void forgetAll();
            // The fourth store follows the same rule, and which hosts this television cannot read
            // is a diagnosis it made rather than a fact.
            forgetRepairHosts();
            ask(false);
            void load(true);
          }}
        />
      )}
    </>
  );
}
