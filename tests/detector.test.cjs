const test = require("node:test");
const assert = require("node:assert/strict");
const { isAllowedInputType, shouldTrigger } = require("../extension/lib/detector.js");

test("matches mj without case sensitivity", () => {
  for (const text of ["mj", "MJ", "Mj", "mJ", "hello mj", "中文mJ"]) {
    assert.equal(
      shouldTrigger({ textBeforeCaret: text, inputType: "insertText", isComposing: false }),
      true
    );
  }
});

test("does not match unrelated suffixes", () => {
  for (const text of ["", "m", "jm", "mjx", "hello"]) {
    assert.equal(
      shouldTrigger({ textBeforeCaret: text, inputType: "insertText", isComposing: false }),
      false
    );
  }
});

test("waits for IME composition to finish", () => {
  assert.equal(
    shouldTrigger({ textBeforeCaret: "mj", inputType: "insertCompositionText", isComposing: true }),
    false
  );
  assert.equal(
    shouldTrigger({ textBeforeCaret: "mj", inputType: "insertCompositionText", isComposing: false }),
    true
  );
});

test("excludes paste, deletion and script replacement", () => {
  for (const inputType of ["insertFromPaste", "deleteContentBackward", "historyUndo"]) {
    assert.equal(isAllowedInputType(inputType), false);
    assert.equal(
      shouldTrigger({ textBeforeCaret: "mj", inputType, isComposing: false }),
      false
    );
  }
});

