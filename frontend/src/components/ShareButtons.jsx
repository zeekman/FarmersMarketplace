import React from "react";

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
};

export default function ShareButtons({ title, url, onShare }) {
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(`${title} ${url}`);

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
      await navigator.clipboard.writeText(url);
      track("copy_link");
    } catch {
      // Clipboard may fail on insecure contexts; ignore gracefully.
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
    </div>
  );
}
