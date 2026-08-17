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
            OpenIPTV is a free, open source player for M3U playlists. It includes no channels and
            sends no analytics. The app connects only to the playlists, streams, and logos you
            choose. Your playlist addresses and settings stay on this device.
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
            OpenIPTV is not affiliated with broadcasters or streaming services. Watch only content
            you are authorised to access.
          </p>
          <p className="sheet-lead">
            Scan the QR code to view the source code or report a problem.
          </p>
        </div>
        <img className="qr" src="./repo-qr.svg" alt={`QR code linking to ${REPO_URL}`} />
      </div>
    </>
  );
}
