import { useLayoutEffect, useRef } from "react";
import { useToasts, type ToastNotice } from "../services/toast";
import { Icon } from "./Icon";
function ToastContent({ notice }: { notice: ToastNotice }) {
  return (
    <div className={`toast toast-${notice.kind}`} data-toast-kind={notice.kind}>
      {notice.kind === "loading" ? (
        <span className="spinner toast-spinner" aria-hidden="true" />
      ) : (
        <Icon
          name={
            notice.kind === "success"
              ? "check"
              : notice.kind === "error" || notice.kind === "warning"
                ? "warn"
                : "about"
          }
        />
      )}
      <span>{notice.message}</span>
    </div>
  );
}
export function ToastHost({
  avoidPlayback = false,
  layoutKey = "",
}: {
  avoidPlayback?: boolean;
  layoutKey?: string;
}) {
  const notice = useToasts((state) => state.notice);
  const visible = notice !== null;
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node || !visible || !avoidPlayback) {
      node?.style.removeProperty("--toast-clearance");
      return;
    }
    const measure = () => {
      let clearance = 120;
      for (const element of document.querySelectorAll<HTMLElement>(
        ".playback-deck, .subtitle-layer",
      )) {
        if (element.offsetHeight) {
          const bottom = Number.parseFloat(getComputedStyle(element).bottom) || 0;
          clearance = Math.max(clearance, element.offsetHeight + bottom + 16);
        }
      }
      node.style.setProperty("--toast-clearance", `${clearance}px`);
    };
    const observer = new ResizeObserver(measure);
    const observe = () => {
      observer.disconnect();
      document.querySelectorAll(".playback-deck, .subtitle-layer").forEach((element) => {
        observer.observe(element);
      });
      measure();
    };
    observe();
    const contents = new MutationObserver(observe);
    document.querySelectorAll(".live-host, .vod-host").forEach((element) => {
      contents.observe(element, { childList: true, subtree: true });
    });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      contents.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [visible, avoidPlayback, layoutKey]);
  return (
    <div ref={host} className="toast-host">
      <div role="status" aria-atomic="true">
        {notice && notice.kind !== "error" && <ToastContent key={notice.id} notice={notice} />}
      </div>
      <div role="alert" aria-atomic="true">
        {notice?.kind === "error" && <ToastContent key={notice.id} notice={notice} />}
      </div>
    </div>
  );
}
