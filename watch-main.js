"use strict";

// Publishes the playing video id. YouTube can start the next video before
// the address bar changes, and the toolbar badge has to follow the video.
(function () {
  const ATTR = "data-yt-speed-video";

  function fromUrl() {
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
    } catch {
      // location can be unreadable during a navigation.
    }
    return "";
  }

  function fromPlayer() {
    const player = document.getElementById("movie_player") || document.getElementById("shorts-player");
    if (!player || typeof player.getVideoData !== "function") return "";
    try {
      const data = player.getVideoData();
      const id = data && data.video_id;
      if (!id) return "";
      if (location.pathname.includes("/shorts/")) return "s:" + id;
      return "v:" + id;
    } catch {
      return "";
    }
  }

  let seenUrl = "";
  let seenPlayer = "";
  let published = "";

  function publish(id) {
    const root = document.documentElement;
    if (!root || !id || id === published) return;
    published = id;
    if (root.getAttribute(ATTR) !== id) root.setAttribute(ATTR, id);
  }

  function tick() {
    const urlId = fromUrl();
    const playerId = fromPlayer();
    const urlChanged = Boolean(urlId && urlId !== seenUrl);
    const playerChanged = Boolean(playerId && playerId !== seenPlayer);
    if (urlId) seenUrl = urlId;
    if (playerId) seenPlayer = playerId;
    if (playerChanged) publish(playerId);
    else if (urlChanged) publish(urlId);
  }

  document.addEventListener("yt-navigate-finish", tick, true);
  document.addEventListener("yt-page-data-updated", tick, true);
  setInterval(tick, 250);
  tick();
})();
