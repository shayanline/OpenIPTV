import { ASPECTS, useSettings } from "../../stores/settings";
import { Choice, Row, Toggle } from "./Field";
import { stopRepair } from "../../services/repair";

export function Playback() {
  const s = useSettings();

  return (
    <>
      <h3>Playback</h3>
      <Row
        label="Screen fit"
        hint={ASPECTS.find((a) => a.id === s.aspectId)?.note}
      >
        <Choice label="Screen fit" options={ASPECTS} value={s.aspectId} onChange={(id) => s.set("aspectId", id)} />
      </Row>
      <Row
        label="Compatibility mode"
        hint="Use this if a channel shows one frame, then stops. It may use additional data while repairing the stream."
      >
        <Toggle
          label="Compatibility mode"
          value={s.compatibility}
          onChange={(v) => {
            s.set("compatibility", v);
            // Turning it off has to take effect now, not at the next channel: the socket and its
            // refresh loop are exactly what the viewer just asked to be rid of.
            if (!v) stopRepair();
          }}
        />
      </Row>
    </>
  );
}
