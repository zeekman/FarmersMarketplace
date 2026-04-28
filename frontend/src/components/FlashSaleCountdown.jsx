import React, { useEffect, useState } from "react";

function getRemaining(endAt) {
  const diff = Math.max(0, new Date(endAt).getTime() - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  return {
    diff,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export default function FlashSaleCountdown({ endsAt }) {
  const [remaining, setRemaining] = useState(() => getRemaining(endsAt));

  useEffect(() => {
    if (remaining.diff <= 0) return;
    const timer = setInterval(() => {
      const next = getRemaining(endsAt);
      setRemaining(next);
      if (next.diff <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  if (remaining.diff <= 0) {
    return (
      <div style={{ fontSize: 12, fontWeight: 700, color: "#b42318", marginTop: 6 }}>
        Sale ended
      </div>
    );
  }

  const label = `${String(remaining.hours).padStart(2, "0")}:${String(remaining.minutes).padStart(2, "0")}:${String(remaining.seconds).padStart(2, "0")}`;

  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: "#b42318", marginTop: 6 }}>
      Flash sale ends in {label}
    </div>
  );
}
