"use strict";

const TITLE_TO_2X = "Set YouTube playback to 2×";
const TITLE_TO_1X = "Set YouTube playback to 1×";

const badgeTokens = new Map();

function rateForBadge(badgeText) {
  return badgeText === "2x" ? 1 : 2;
}

function isYouTubeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    );
  } catch {
    return false;
  }
}

async function showBadge(tabId, text, color, persist) {
  const token = (badgeTokens.get(tabId) || 0) + 1;
  badgeTokens.set(tabId, token);
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" });
    await chrome.action.setBadgeText({ tabId, text });
  } catch {
    return;
  }
  if (persist) return;
  setTimeout(() => {
    if (badgeTokens.get(tabId) !== token) return;
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    chrome.action.setTitle({ tabId, title: TITLE_TO_2X }).catch(() => {});
  }, 2500);
}

async function showSpeed2(tabId) {
  await showBadge(tabId, "2x", "#166534", true);
  await chrome.action.setTitle({ tabId, title: TITLE_TO_1X });
}

async function clearSpeed(tabId) {
  const token = (badgeTokens.get(tabId) || 0) + 1;
  badgeTokens.set(tabId, token);
  await chrome.action.setBadgeText({ tabId, text: "" });
  await chrome.action.setTitle({ tabId, title: TITLE_TO_2X });
}

// Injected into the page. YouTube reverts a bare video.playbackRate write,
// so the player API has to be set as well. Kept self-contained: executeScript
// serializes this function alone.
function setSpeedInPage(rate) {
  const RATE = rate === 1 ? 1 : 2;

  function onYouTube() {
    const host = location.hostname.replace(/^www\./, "");
    return (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    );
  }

  function apply(player, video) {
    let ok = false;
    if (player && typeof player.setPlaybackRate === "function") {
      try {
        player.setPlaybackRate(RATE);
        if (typeof player.getPlaybackRate === "function") {
          ok = Math.abs(player.getPlaybackRate() - RATE) < 0.05;
        }
      } catch {
        // Player exists but is not ready yet.
      }
    }
    if (video) {
      try {
        video.playbackRate = RATE;
        video.defaultPlaybackRate = RATE;
        if (Math.abs(video.playbackRate - RATE) < 0.05) ok = true;
      } catch {
        // Some media elements reject the assignment.
      }
    }
    return ok;
  }

  function find() {
    const player =
      document.getElementById("movie_player") ||
      document.getElementById("shorts-player");
    const directVideo =
      (player && player.querySelector && player.querySelector("video")) ||
      document.querySelector("video.html5-main-video");
    if (player || directVideo) return { player, video: directVideo };

    const videos = [];
    const audios = [];
    const players = [];
    const seen = new Set();

    function visit(root, depth) {
      if (!root || depth > 8 || seen.has(root) || !root.querySelectorAll) return;
      seen.add(root);
      const foundPlayer = root.querySelector("#movie_player, #shorts-player");
      if (foundPlayer) players.push(foundPlayer);
      root.querySelectorAll("video").forEach((video) => videos.push(video));
      root.querySelectorAll("audio").forEach((audio) => audios.push(audio));
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
      });
    }

    visit(document, 0);
    const shadowPlayer =
      players.find((el) => el.id === "movie_player") ||
      players.find((el) => el.id === "shorts-player") ||
      null;
    const insidePlayer =
      shadowPlayer && shadowPlayer.querySelector && shadowPlayer.querySelector("video, audio");
    const media = insidePlayer || largestMedia(videos) || largestMedia(audios);
    return { player: shadowPlayer, video: media };
  }

  function largestMedia(elements) {
    return elements.sort((a, b) => {
      const area = (el) => (el.clientWidth || 0) * (el.clientHeight || 0);
      return area(b) - area(a);
    })[0] || null;
  }

  if (!onYouTube()) return { ok: false, reason: "not-youtube" };

  const deadline = Date.now() + 2000;
  return new Promise((resolve) => {
    function tick() {
      const found = find();
      if (apply(found.player, found.video)) {
        resolve({ ok: true });
        return;
      }
      if (Date.now() >= deadline) {
        resolve({ ok: false, reason: "no-player" });
        return;
      }
      setTimeout(tick, 200);
    }
    tick();
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id == null) return;

  let badge = "";
  try {
    badge = await chrome.action.getBadgeText({ tabId: tab.id });
  } catch {
    badge = "";
  }
  const rate = rateForBadge(badge);

  if (tab.url && !isYouTubeUrl(tab.url)) {
    await showBadge(tab.id, "!", "#9a3412", false);
    return;
  }

  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: setSpeedInPage,
      args: [rate],
    });
    const ok = Boolean(injected && injected.result && injected.result.ok);
    if (!ok) {
      if (rate !== 1) await showBadge(tab.id, "!", "#9a3412", false);
      return;
    }
    if (rate === 2) await showSpeed2(tab.id);
    else await clearSpeed(tab.id);
  } catch {
    if (rate !== 1) await showBadge(tab.id, "!", "#9a3412", false);
  }
});
