import { APP_VERSION, REPO_URL } from "../../meta";

export function About() {
  return (
    <>
      <h3>About</h3>
      <div className="about">
        <div>
          <h4>SimpleIPTV</h4>
          <p>Version {APP_VERSION}</p>
          <p className="link">{REPO_URL}</p>
          <p className="sheet-lead">
            A free and open source player for any M3U playlist. It carries no channels of its
            own, and it reports nothing to anybody: it talks only to the playlist and the
            channels you point it at, and what you add stays on this device.
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
