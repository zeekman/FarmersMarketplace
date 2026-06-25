import React, { useEffect, useRef, useState } from "react";

const css = `
@keyframes fsc-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.05); }
}
.fsc-pulse { animation: fsc-pulse 1s ease-in-out infinite; }
.fsc-pulse-fast { animation: fsc-pulse 0.5s ease-in-out infinite; }
`;

function getRemaining(endAt) {
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

export default function FlashSaleCountdown({ endsAt }) {
  const [remaining, setRemaining] = useState(() => getRemaining(endsAt));
  const announcedRef = useRef(false);

  useEffect(() => {
    if (remaining.diff <= 0) return;
    const tick = remaining.totalSeconds < 10 ? 250 : 1000;
    const timer = setInterval(() => {
      const next = getRemaining(endsAt);
      setRemaining(next);
      if (next.diff <= 0) clearInterval(timer);
    }, tick);
    return () => clearInterval(timer);
  }, [endsAt, remaining.totalSeconds < 10]);

  // Announce at 10 seconds once
  const shouldAnnounce = remaining.totalSeconds <= 10 && remaining.diff > 0 && !announcedRef.current;
  if (shouldAnnounce) announcedRef.current = true;

  if (remaining.diff <= 0) {
    return <div style={{ fontSize: 12, fontWeight: 700, color: "#b42318", marginTop: 6 }}>Sale ended</div>;
  }

  const label = `${String(remaining.hours).padStart(2, "0")}:${String(remaining.minutes).padStart(2, "0")}:${String(remaining.seconds).padStart(2, "0")}`;
  const urgent = remaining.totalSeconds < 60;
  const veryUrgent = remaining.totalSeconds < 10;

  return (
    <>
      <style>{css}</style>
      <div
        className={veryUrgent ? "fsc-pulse-fast" : urgent ? "fsc-pulse" : undefined}
        style={{ fontSize: 12, fontWeight: 700, color: urgent ? "red" : "#b42318", marginTop: 6 }}
      >
        Flash sale ends in {label}
      </div>
      <div
        aria-live="assertive"
        aria-atomic="true"
        style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}
      >
        {shouldAnnounce ? "10 seconds remaining" : ""}
      </div>
    </>
  );
}
