"use strict";

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "MJ_TRIGGER_TOP" && sender.tab?.id !== undefined) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "MJ_PLAY_EFFECT" }, { frameId: 0 });
  }

  if (message?.type === "MJ_AUDIO_BLOCKED") {
    chrome.action.setBadgeBackgroundColor({ color: "#C62828" });
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setTitle({ title: "MJ 特效：当前页面阻止了声音播放" });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: "" });
});

