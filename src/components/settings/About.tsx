import { APP_VERSION, REPO_URL } from "../../meta";

export function About() {
  return (
    <>
      <h3>About</h3>
      <div className="about">
        <div>
          <h4>OpenIPTV</h4>
          <p>Version {APP_VERSION}</p>
          <p className="link">{REPO_URL}</p>
          <p className="sheet-lead">
            A free and open source player for any M3U playlist. It carries no channels of its
            own, and it reports nothing to anybody: it talks only to the playlist and the
            channels you point it at, and what you add stays on this device.
          </p>
          {/*
            * The disclaimer, for the person holding the remote rather than the one reading the
            * repository, and kept to two lines for a reason beyond brevity. Font sizes here are
            * calc(22px * scale) with a unitless line height, so line boxes are fractional, and
            * Chromium 69 rounds each one where a current engine does not. The drift accumulates
            * per line, and a longer paragraph than this puts this sheet over the parity gate's
            * four pixel tolerance, which is the gate telling the truth rather than complaining.
            */}
          <p className="sheet-lead">
            No broadcaster or service is connected to this app. Please watch only what you have
            the right to.
          </p>
          <p className="sheet-lead">
            Scan the code to read the source or report a problem.
          </p>
        </div>
        <img className="qr" src="./repo-qr.svg" alt={`QR code linking to ${REPO_URL}`} />
      </div>
    </>
  );
}
