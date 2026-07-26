const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  createScratchpadUpdate,
  applyScratchpadUpdate,
} = require("../ui/scratchpad-model.js");

describe("Scratchpad transcript updates", () => {
  test("inserts the next transcript at the caret in the focused editor", () => {
    const update = createScratchpadUpdate("new ", true);
    const result = applyScratchpadUpdate(
      "hello world",
      6,
      6,
      update,
      true
    );

    assert.deepEqual(result, {
      value: "hello new world",
      selectionStart: 10,
      selectionEnd: 10,
      inserted: true,
    });
  });

  test("replaces the selected text like a normal paste", () => {
    const update = createScratchpadUpdate("there", true);
    const result = applyScratchpadUpdate(
      "hello world",
      6,
      11,
      update,
      true
    );

    assert.deepEqual(result, {
      value: "hello there",
      selectionStart: 11,
      selectionEnd: 11,
      inserted: true,
    });
  });

  test("replaces the whole draft when the scratchpad window was not focused", () => {
    const update = createScratchpadUpdate("fresh transcript", false);
    const result = applyScratchpadUpdate(
      "old draft",
      4,
      4,
      update,
      true
    );

    assert.deepEqual(result, {
      value: "fresh transcript",
      selectionStart: 16,
      selectionEnd: 16,
      inserted: false,
    });
  });

  test("replaces the whole draft when focus is in the window but not the editor", () => {
    const update = createScratchpadUpdate("fresh transcript", true);
    const result = applyScratchpadUpdate(
      "old draft",
      4,
      4,
      update,
      false
    );

    assert.equal(result.value, "fresh transcript");
    assert.equal(result.inserted, false);
  });
});
