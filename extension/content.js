(function startMJEffect() {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    sound: true,
    variant: "random",
  });
  const VARIANTS = Object.freeze({
    head: { animation: "assets/head.png", audio: "assets/head.m4a", duration: 2530 },
    body: { animation: "assets/body.png", audio: "assets/body.m4a", duration: 3030 },
  });
  const ALLOWED_TEXT_INPUT_TYPES = new Set(["", "text", "search"]);
  const MAX_ACTIVE_EFFECTS = 3;

  let settings = { ...DEFAULT_SETTINGS };
  let compositionInProgress = false;
  let overlayRoot = null;
  let lastTrigger = new WeakMap();
  const activeEffects = [];

  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    settings = { ...DEFAULT_SETTINGS, ...stored };
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }
  });

  function editableFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node instanceof HTMLTextAreaElement) {
        return node.disabled || node.readOnly ? null : node;
      }
      if (node instanceof HTMLInputElement) {
        const type = (node.type || "text").toLowerCase();
        return ALLOWED_TEXT_INPUT_TYPES.has(type) && !node.disabled && !node.readOnly
          ? node
          : null;
      }
      const editableAttribute = node.getAttribute("contenteditable");
      if (editableAttribute === "" || editableAttribute === "true" || editableAttribute === "plaintext-only") {
        return node;
      }
    }
    return null;
  }

  function textAndCaret(editable) {
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
      const caret = editable.selectionStart;
      if (typeof caret !== "number") return null;
      return { text: editable.value.slice(0, caret), caret };
    }

    const selection = editable.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
    const activeRange = selection.getRangeAt(0);
    if (!editable.contains(activeRange.endContainer)) return null;
    const prefix = activeRange.cloneRange();
    prefix.selectNodeContents(editable);
    prefix.setEnd(activeRange.endContainer, activeRange.endOffset);
    const text = prefix.toString();
    return { text, caret: text.length };
  }

  function triggerSignature(editable, context) {
    const tail = context.text.slice(-12);
    return `${context.caret}:${tail}:${editable.textContent?.length ?? editable.value?.length ?? 0}`;
  }

  function inspectInput(event) {
    if (!settings.enabled || compositionInProgress || event.isComposing) return;
    const editable = editableFromEvent(event);
    if (!editable) return;
    const context = textAndCaret(editable);
    if (!context) return;
    if (
      !MJDetector.shouldTrigger({
        textBeforeCaret: context.text,
        inputType: event.inputType,
        isComposing: event.isComposing,
      })
    ) {
      lastTrigger.delete(editable);
      return;
    }

    const signature = triggerSignature(editable, context);
    if (lastTrigger.get(editable) === signature) return;
    lastTrigger.set(editable, signature);
    requestEffect();
  }

  function inspectAfterComposition(event) {
    compositionInProgress = false;
    queueMicrotask(() =>
      inspectInput({
        ...event,
        isComposing: false,
        inputType: "insertCompositionText",
        composedPath: () => event.composedPath(),
      })
    );
  }

  function requestEffect() {
    if (window === window.top) {
      playEffect();
      return;
    }
    chrome.runtime.sendMessage({ type: "MJ_TRIGGER_TOP" });
  }

  function chooseVariant() {
    if (settings.variant === "head" || settings.variant === "body") {
      return settings.variant;
    }
    return Math.random() < 0.5 ? "head" : "body";
  }

  function ensureOverlay() {
    if (overlayRoot?.isConnected) return overlayRoot;
    const host = document.createElement("div");
    host.id = `mj-effect-${chrome.runtime.id}`;
    host.style.cssText = [
      "all:initial",
      "position:fixed",
      "inset:0",
      "width:100vw",
      "height:100vh",
      "overflow:hidden",
      "pointer-events:none",
      "z-index:2147483647",
      "contain:strict",
    ].join(";");
    const shadow = host.attachShadow({ mode: "closed" });
    const stage = document.createElement("div");
    stage.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none";
    shadow.append(stage);
    (document.documentElement || document.body).append(host);
    overlayRoot = { host, stage, isConnected: true };
    return overlayRoot;
  }

  function discard(effect) {
    clearTimeout(effect.timer);
    effect.audio?.pause();
    effect.image.remove();
    const index = activeEffects.indexOf(effect);
    if (index >= 0) activeEffects.splice(index, 1);
    if (activeEffects.length === 0 && overlayRoot) {
      overlayRoot.host.remove();
      overlayRoot = null;
    }
  }

  function playEffect() {
    if (!settings.enabled) return;
    const slug = chooseVariant();
    const variant = VARIANTS[slug];
    const root = ensureOverlay();

    while (activeEffects.length >= MAX_ACTIVE_EFFECTS) discard(activeEffects[0]);

    const image = document.createElement("img");
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.src = `${chrome.runtime.getURL(variant.animation)}?instance=${Date.now()}-${Math.random()}`;
    image.style.cssText = [
      "position:absolute",
      "top:0",
      "left:50%",
      "width:min(100vw,960px)",
      "height:auto",
      "transform:translateX(-50%)",
      "pointer-events:none",
      "user-select:none",
      "-webkit-user-drag:none",
    ].join(";");
    root.stage.append(image);

    let audio = null;
    if (settings.sound) {
      audio = new Audio(chrome.runtime.getURL(variant.audio));
      audio.preload = "auto";
      audio.volume = 0.9;
      const playback = audio.play();
      if (playback) {
        playback.catch(() => chrome.runtime.sendMessage({ type: "MJ_AUDIO_BLOCKED" }));
      }
    }

    const effect = { image, audio, timer: null };
    effect.timer = setTimeout(() => discard(effect), variant.duration + 180);
    activeEffects.push(effect);
  }

  document.addEventListener("compositionstart", () => {
    compositionInProgress = true;
  }, true);
  document.addEventListener("compositionend", inspectAfterComposition, true);
  document.addEventListener("input", inspectInput, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "MJ_PLAY_EFFECT" && window === window.top) playEffect();
  });
})();
