(function exposeDetector(globalScope) {
  "use strict";

  const ALLOWED_INPUT_TYPES = new Set([
    "insertText",
    "insertCompositionText",
    "insertReplacementText",
  ]);

  function isAllowedInputType(inputType) {
    return !inputType || ALLOWED_INPUT_TYPES.has(inputType);
  }

  function shouldTrigger({ textBeforeCaret, inputType, isComposing }) {
    if (isComposing || !isAllowedInputType(inputType)) {
      return false;
    }
    return typeof textBeforeCaret === "string" && /mj$/i.test(textBeforeCaret);
  }

  const api = Object.freeze({ isAllowedInputType, shouldTrigger });
  globalScope.MJDetector = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

