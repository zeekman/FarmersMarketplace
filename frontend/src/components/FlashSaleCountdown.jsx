import React, { useEffect, useRef, useState } from "react";

const css = `
@keyframes fsc-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.05); }
}
.fsc-pulse { animation: fsc-pulse 1s ease-in-out infinite; }
.fsc-pulse-fast { animation: fsc-pulse 0.5s ease-in-out infinite; }

/* Respect prefers-reduced-motion — disable urgency animation */
@media (prefers-reduced-motion: reduce) {
  .fsc-pulse,
  .fsc-pulse-fast {
    animation: none;
  }
}
`;

/**
 * Screen-reader announcements fire only when one of these thresholds is
 * crossed (and when the sale ends) — never on every tick (#1502).
 */
export const ANNOUNCE_THRESHOLDS = [
  { seconds: 3600, message: "1 hour left in the flash sale" },
  { seconds: 600, message: "10 minutes left in the flash sale" },
  { seconds: 60, message: "1 minute left in the flash sale" },
];
export const ENDED_MESSAGE = "The flash sale has ended";

export function getRemaining(endAt) {
  const diff = Math.max(0, new Date(endAt).getTime() - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  return {
    diff,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalSeconds,
  };
}

/** Message for crossing from `prevSeconds` to `nextSeconds`, or null. */
export function announcementFor(prevSeconds, nextSeconds) {
  if (prevSeconds > 0 && nextSeconds <= 0) return ENDED_MESSAGE;
  const crossed = ANNOUNCE_THRESHOLDS.filter((t) => prevSeconds > t.seconds && nextSeconds <= t.seconds);
  return crossed.length ? crossed[crossed.length - 1].message : null;
}

export default function FlashSaleCountdown({ endsAt }) {
  const [remaining, setRemaining] = useState(() => getRemaining(endsAt));
  const [announcement, setAnnouncement] = useState("");
  const prevSecondsRef = useRef(remaining.totalSeconds);

  useEffect(() => {
    if (remaining.diff <= 0) return;
    const tick = remaining.totalSeconds < 10 ? 250 : 1000;
    const timer = setInterval(() => {
      const next = getRemaining(endsAt);
      const msg = announcementFor(prevSecondsRef.current, next.totalSeconds);
      prevSecondsRef.current = next.totalSeconds;
      if (msg) setAnnouncement(msg);
      setRemaining(next);
      if (next.diff <= 0) clearInterval(timer);
    }, tick);
    return () => clearInterval(timer);
  }, [endsAt, remaining.totalSeconds < 10]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = `${String(remaining.hours).padStart(2, "0")}:${String(remaining.minutes).padStart(2, "0")}:${String(remaining.seconds).padStart(2, "0")}`;
  const urgent = remaining.totalSeconds < 60;
  const veryUrgent = remaining.totalSeconds < 10;
  const ended = remaining.diff <= 0;

  return (
    <>
      {!ended && <style>{css}</style>}
      {ended ? (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#b42318", marginTop: 6 }}>Sale ended</div>
      ) : (
        <div
          className={veryUrgent ? "fsc-pulse-fast" : urgent ? "fsc-pulse" : undefined}
          style={{ fontSize: 12, fontWeight: 700, color: urgent ? "red" : "#b42318", marginTop: 6 }}
        >
          {/* The ticking clock itself is not a live region. */}
          Flash sale ends in <span aria-hidden="true">{label}</span>
          <span className="sr-only" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
            {remaining.hours > 0 ? `${remaining.hours} h ` : ""}{remaining.minutes} min
          </span>
        </div>
      )}
      <div
        aria-live="assertive"
        aria-atomic="true"
        style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}
      >
        {announcement}
      </div>
    </>
  );
}
