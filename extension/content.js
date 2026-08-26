(function startMJEffect() {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    sound: true,
    variant: "random",
  });
  const VARIANTS = Object.freeze({
    head: {
      character: "assets-v2/head-character.png",
      audio: "assets/head.m4a",
      duration: 2650,
    },
    body: {
      character: "assets-v2/body-character.png",
      audio: "assets/body.m4a",
      duration: 3150,
    },
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
    for (const animation of effect.animations) animation.cancel();
    effect.layer.remove();
    const index = activeEffects.indexOf(effect);
    if (index >= 0) activeEffects.splice(index, 1);
    if (activeEffects.length === 0 && overlayRoot) {
      overlayRoot.host.remove();
      overlayRoot = null;
    }
  }

  function makeLayer(cssText) {
    const layer = document.createElement("div");
    layer.style.cssText = cssText;
    return layer;
  }

  function makeCharacter(source) {
    const image = document.createElement("img");
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.src = chrome.runtime.getURL(source);
    image.style.cssText = [
      "display:block",
      "width:100%",
      "height:100%",
      "object-fit:contain",
      "pointer-events:none",
      "user-select:none",
      "-webkit-user-drag:none",
      "filter:drop-shadow(0 5px 5px rgba(20,20,28,.16))",
    ].join(";");
    return image;
  }

  function makeWebSvg(kind) {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 1000 620");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible";

    const paths = kind === "head"
      ? ["M492 -40 C492 100 492 230 492 430", "M508 -40 C508 100 508 230 508 430"]
      : ["M486 -40 C486 130 430 260 386 470", "M500 -40 C500 130 444 266 400 474"];

    for (const data of paths) {
      const path = document.createElementNS(namespace, "path");
      path.setAttribute("d", data);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", kind === "head" ? "#35343a" : "#77747b");
      path.setAttribute("stroke-width", kind === "head" ? "5" : "4");
      path.setAttribute("stroke-linecap", "round");
      svg.append(path);
    }
    return svg;
  }

  function animateHead(layer, variant) {
    const animations = [];
    const rig = makeLayer([
      "position:absolute",
      "left:50%",
      "top:-70px",
      "width:min(92vw,760px)",
      "height:min(88vh,820px)",
      "transform-origin:50% 0",
      "will-change:transform",
    ].join(";"));
    const web = makeLayer("position:absolute;left:23%;top:-4%;width:54%;height:53%;pointer-events:none");
    web.append(makeWebSvg("head"));
    const character = makeLayer("position:absolute;left:12%;top:22%;width:76%;aspect-ratio:1;pointer-events:none");
    character.append(makeCharacter(variant.character));
    rig.append(web, character);
    layer.append(rig);

    animations.push(rig.animate([
      { offset: 0, transform: "translate(-50%,-72%) rotate(7deg) scale(.8)" },
      { offset: .16, transform: "translate(-50%,-8%) rotate(-11deg) scale(.96)" },
      { offset: .34, transform: "translate(-50%,4%) rotate(8deg) scale(1)" },
      { offset: .55, transform: "translate(-50%,7%) rotate(-6deg) scale(1)" },
      { offset: .73, transform: "translate(-50%,4%) rotate(4deg) scale(.99)" },
      { offset: .86, transform: "translate(-50%,-2%) rotate(-3deg) scale(.97)" },
      { offset: 1, transform: "translate(-50%,-76%) rotate(8deg) scale(.82)" },
    ], { duration: variant.duration, easing: "cubic-bezier(.36,.05,.2,1)", fill: "both" }));

    animations.push(character.animate([
      { transform: "rotate(-2deg)" },
      { offset: .4, transform: "rotate(3deg)" },
      { offset: .72, transform: "rotate(-2deg)" },
      { transform: "rotate(1deg)" },
    ], { duration: variant.duration, easing: "ease-in-out", fill: "both" }));
    return animations;
  }

  function animateHeart(rig, index, duration) {
    const heart = document.createElement("img");
    heart.src = chrome.runtime.getURL("assets-v2/heart.svg");
    heart.alt = "";
    heart.setAttribute("aria-hidden", "true");
    const sizes = ["13%", "9%", "6.5%"];
    const left = ["73%", "79%", "68%"];
    const top = ["39%", "28%", "19%"];
    heart.style.cssText = [
      "position:absolute",
      `left:${left[index]}`,
      `top:${top[index]}`,
      `width:${sizes[index]}`,
      "height:auto",
      "pointer-events:none",
      "will-change:transform,opacity",
      "filter:drop-shadow(0 3px 3px rgba(60,15,45,.16))",
    ].join(";");
    rig.append(heart);
    return heart.animate([
      { offset: 0, opacity: 0, transform: "translate(0,28px) scale(.35) rotate(-8deg)" },
      { offset: .18 + index * .07, opacity: 0, transform: "translate(0,28px) scale(.35) rotate(-8deg)" },
      { offset: .34 + index * .07, opacity: 1, transform: "translate(8px,0) scale(1) rotate(5deg)" },
      { offset: .72, opacity: .95, transform: "translate(26px,-28px) scale(.9) rotate(-5deg)" },
      { offset: 1, opacity: 0, transform: "translate(44px,-72px) scale(.55) rotate(8deg)" },
    ], { duration, easing: "cubic-bezier(.22,.65,.28,1)", fill: "both" });
  }

  function animateBody(layer, variant) {
    const animations = [];
    const rig = makeLayer([
      "position:absolute",
      "left:50%",
      "top:-90px",
      "width:min(88vw,720px)",
      "height:min(94vh,900px)",
      "transform-origin:50% 0",
      "will-change:transform",
    ].join(";"));
    const web = makeLayer("position:absolute;left:15%;top:-2%;width:70%;height:60%;pointer-events:none");
    web.append(makeWebSvg("body"));
    const character = makeLayer("position:absolute;left:14%;top:34%;width:72%;aspect-ratio:1;pointer-events:none");
    character.append(makeCharacter(variant.character));
    rig.append(web, character);
    layer.append(rig);

    animations.push(rig.animate([
      { offset: 0, transform: "translate(-58%,-53%) rotate(-19deg) scale(.78)" },
      { offset: .15, transform: "translate(-47%,-5%) rotate(16deg) scale(.96)" },
      { offset: .34, transform: "translate(-53%,3%) rotate(-14deg) scale(1)" },
      { offset: .53, transform: "translate(-47%,5%) rotate(12deg) scale(1)" },
      { offset: .70, transform: "translate(-52%,1%) rotate(-9deg) scale(.98)" },
      { offset: .84, transform: "translate(-48%,-4%) rotate(7deg) scale(.95)" },
      { offset: 1, transform: "translate(-61%,-58%) rotate(-18deg) scale(.78)" },
    ], { duration: variant.duration, easing: "cubic-bezier(.34,.04,.23,1)", fill: "both" }));

    animations.push(character.animate([
      { transform: "rotate(4deg) translateY(0)" },
      { offset: .38, transform: "rotate(-3deg) translateY(7px)" },
      { offset: .68, transform: "rotate(2deg) translateY(-4px)" },
      { transform: "rotate(-2deg) translateY(0)" },
    ], { duration: variant.duration, easing: "ease-in-out", fill: "both" }));

    for (let index = 0; index < 3; index += 1) {
      animations.push(animateHeart(rig, index, variant.duration));
    }
    return animations;
  }

  function playEffect() {
    if (!settings.enabled) return;
    const slug = chooseVariant();
    const variant = VARIANTS[slug];
    const root = ensureOverlay();

    while (activeEffects.length >= MAX_ACTIVE_EFFECTS) discard(activeEffects[0]);

    const layer = makeLayer("position:absolute;inset:0;overflow:hidden;pointer-events:none");
    root.stage.append(layer);
    const animations = slug === "head"
      ? animateHead(layer, variant)
      : animateBody(layer, variant);

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

    const effect = { layer, animations, audio, timer: null };
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
