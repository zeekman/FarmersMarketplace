import React, { useState, useCallback } from "react";

const s = {
  wrap: { marginTop: 16 },
  title: { fontSize: 13, color: "#666", marginBottom: 8, fontWeight: 600 },
  row: { display: "flex", flexWrap: "wrap", gap: 8 },
  btn: {
    border: "1px solid #d9e2dc",
    borderRadius: 999,
    background: "#fff",
    color: "#1f2937",
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  toast: {
    position: "fixed",
    bottom: 24,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "10px 20px",
    borderRadius: 8,
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    zIndex: 9999,
    transition: "opacity 0.3s ease",
  },
  toastSuccess: { background: "#16a34a" },
  toastError: { background: "#dc2626" },
};

export default function ShareButtons({ title, url, onShare }) {
  const [toast, setToast] = useState(null);
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(`${title} ${url}`);

  const showToast = useCallback((message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  function track(platform) {
    if (typeof onShare === "function") onShare(platform);
  }

  function shareWhatsApp() {
    track("whatsapp");
    window.open(
      `https://wa.me/?text=${encodedText}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function shareTwitter() {
    track("twitter");
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        title,
      )}&url=${encodedUrl}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function shareFacebook() {
    track("facebook");
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function copyLink() {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for older browsers
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      track("copy_link");
      showToast("Copied!", "success");
    } catch {
      showToast("Failed to copy link", "error");
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.title}>Share this product</div>
      <div style={s.row}>
        <button type="button" style={s.btn} onClick={shareWhatsApp}>
          WhatsApp
        </button>
        <button type="button" style={s.btn} onClick={shareTwitter}>
          Twitter/X
        </button>
        <button type="button" style={s.btn} onClick={shareFacebook}>
          Facebook
        </button>
        <button type="button" style={s.btn} onClick={copyLink}>
          Copy link
        </button>
      </div>
      {toast && (
        <div
          style={{
            ...s.toast,
            ...(toast.type === "success" ? s.toastSuccess : s.toastError),
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
