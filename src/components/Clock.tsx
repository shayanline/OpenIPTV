import { useEffect, useState } from "react";
import { useLocale } from "../hooks/useLocale";

export function Clock() {
  const { time } = useLocale();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Tick on the minute rather than every second: nothing on screen shows seconds, and
    // a TV app should not wake the renderer sixty times a minute for nothing.
    const id = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(id);
  }, []);
  return <div className="clock">{time(now)}</div>;
}
