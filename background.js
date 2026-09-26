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

function videoKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
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
  await chrome.action.setTitle({ tabId, title: TITLE_TO_1X }).catch(() => {});
}

async function clearSpeed(tabId) {
  const token = (badgeTokens.get(tabId) || 0) + 1;
  badgeTokens.set(tabId, token);
  await chrome.action.setBadgeText({ tabId, text: "" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#00000000" });
  await chrome.action.setTitle({ tabId, title: TITLE_TO_2X });
}

async function badgeText(tabId) {
  try {
    return await chrome.action.getBadgeText({ tabId });
  } catch {
    return "";
  }
}

async function rememberedKey(tabId) {
  try {
    const stored = await chrome.storage.session.get("videoKeys");
    const keys = stored.videoKeys || {};
    return keys[String(tabId)] || "";
  } catch {
    return "";
  }
}

async function rememberKey(tabId, key) {
  try {
    const stored = await chrome.storage.session.get("videoKeys");
    const keys = stored.videoKeys || {};
    if (key) keys[String(tabId)] = key;
    else delete keys[String(tabId)];
    await chrome.storage.session.set({ videoKeys: keys });
  } catch {
    // Session storage is only the backup for the in-page watcher.
  }
}

async function clearBadge(tabId) {
  if ((await badgeText(tabId)) !== "2x") return;
  try {
    await clearSpeed(tabId);
  } catch {
    return;
  }
  await rememberKey(tabId, "");
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      if (document.documentElement) document.documentElement.removeAttribute("data-yt-speed");
    },
  }).catch(() => {});
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
      root.querySelectorAll("video").forEach((node) => videos.push(node));
      root.querySelectorAll("audio").forEach((node) => audios.push(node));
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

async function handleAction(tab) {
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
    if (rate === 2) {
      await showSpeed2(tab.id);
      await rememberKey(tab.id, videoKeyFromUrl(tab.url || ""));
    } else {
      await clearSpeed(tab.id);
      await rememberKey(tab.id, "");
    }
  } catch {
    if (rate !== 1) await showBadge(tab.id, "!", "#9a3412", false);
  }
}

async function noteUrl(tabId, url) {
  if (!isYouTubeUrl(url)) {
    await clearBadge(tabId);
    await rememberKey(tabId, "");
    return;
  }
  const key = videoKeyFromUrl(url);
  if (!key) return;
  const previous = await rememberedKey(tabId);
  if (!previous) {
    if ((await badgeText(tabId)) === "2x") await rememberKey(tabId, key);
    return;
  }
  if (previous === key) return;
  await clearBadge(tabId);
  await rememberKey(tabId, "");
}

chrome.action.onClicked.addListener((tab) => {
  void handleAction(tab);
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "video-changed") return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return;
  void clearBadge(tabId);
  void rememberKey(tabId, "");
});

const YOUTUBE_NAV = {
  url: [
    { hostSuffix: "youtube.com" },
    { hostSuffix: "youtube-nocookie.com" },
    { hostEquals: "youtu.be" },
  ],
};

function onYouTubeNavigation(details) {
  if (details.frameId !== 0 || !details.url) return;
  void noteUrl(details.tabId, details.url);
}

chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
  if (!tab.url) return;
  void noteUrl(tabId, tab.url);
});

chrome.webNavigation.onHistoryStateUpdated.addListener(onYouTubeNavigation, YOUTUBE_NAV);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(onYouTubeNavigation, YOUTUBE_NAV);
chrome.webNavigation.onCompleted.addListener(onYouTubeNavigation, YOUTUBE_NAV);

chrome.tabs.onRemoved.addListener((tabId) => {
  badgeTokens.delete(tabId);
  void rememberKey(tabId, "");
});
