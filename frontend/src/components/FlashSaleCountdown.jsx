import React, { useEffect, useMemo, useState } from "react";

function getRemaining(endAt) {
  const diff = Math.max(0, new Date(endAt).getTime() - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { diff, hours, minutes, seconds };
}

export default function FlashSaleCountdown({ endsAt }) {
  const [remaining, setRemaining] = useState(() => getRemaining(endsAt));

  useEffect(() => {
    const timer = setInterval(() => setRemaining(getRemaining(endsAt)), 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  const label = useMemo(() => {
    if (remaining.diff <= 0) return "Ended";
    return `${String(remaining.hours).padStart(2, "0")}:${String(
      remaining.minutes,
    ).padStart(2, "0")}:${String(remaining.seconds).padStart(2, "0")}`;
  }, [remaining]);

  return (
    <div
      style={{ fontSize: 12, fontWeight: 700, color: "#b42318", marginTop: 6 }}
    >
      Flash sale ends in {label}
    </div>
  );
}
