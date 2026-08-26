"use strict";

const DEFAULTS = { enabled: true, sound: true, variant: "random" };
const enabled = document.querySelector("#enabled");
const sound = document.querySelector("#sound");
const variant = document.querySelector("#variant");
const saved = document.querySelector("#saved");
let savedTimer;

chrome.storage.local.get(DEFAULTS, (settings) => {
  enabled.checked = settings.enabled;
  sound.checked = settings.sound;
  variant.value = settings.variant;
});

function persist() {
  chrome.storage.local.set(
    { enabled: enabled.checked, sound: sound.checked, variant: variant.value },
    () => {
      saved.textContent = "已保存";
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (saved.textContent = ""), 1200);
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "MJ 特效" });
    }
  );
}

enabled.addEventListener("change", persist);
sound.addEventListener("change", persist);
variant.addEventListener("change", persist);

