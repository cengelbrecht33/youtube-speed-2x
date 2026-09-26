"use strict";

const ATTR = "data-yt-speed-video";

function videoKey() {
  try {
    const parsed = new URL(location.href);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id ? "v:" + id : "";
    }
    const watchId = parsed.searchParams.get("v");
    if (watchId) return "v:" + watchId;
    const shorts = parsed.pathname.match(/\/shorts\/([^/?#]+)/);
    if (shorts) return "s:" + shorts[1];
    const embed = parsed.pathname.match(/\/embed\/([^/?#]+)/);
    if (embed) return "e:" + embed[1];
    const live = parsed.pathname.match(/\/live\/([^/?#]+)/);
    if (live) return "l:" + live[1];
    return "";
  } catch {
    return "";
  }
}

let current = videoKey();

function consider(next) {
  if (!next) return;
  if (current && next !== current) {
    chrome.runtime.sendMessage({ type: "video-changed" }, () => void chrome.runtime.lastError);
  }
  current = next;
}

function check() {
  const marked = document.documentElement && document.documentElement.getAttribute(ATTR);
  if (marked) consider(marked);
  consider(videoKey());
}

document.addEventListener("yt-navigate-finish", check, true);
document.addEventListener("yt-page-data-updated", check, true);
if (document.documentElement) {
  new MutationObserver(check).observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ATTR],
  });
}
setInterval(check, 250);
