const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadEnvFile } = require("../electron/env-loader.js");

function writeTempEnv(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ve-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, contents);
  return file;
}

test("parses KEY=VALUE lines, strips quotes, skips comments and blanks", () => {
  const file = writeTempEnv(
    '# comment line\n\nDEEPSEEK_VOICE_API_KEY="sk-abc123"\nPLAIN=hello\n'
  );
  assert.deepEqual(loadEnvFile(file), {
    DEEPSEEK_VOICE_API_KEY: "sk-abc123",
    PLAIN: "hello",
  });
});

test("keeps = inside values and supports single quotes and export prefix", () => {
  const file = writeTempEnv(
    "export TOKEN='a=b=c'\nURL=https://x.example/?a=1&b=2\n"
  );
  assert.deepEqual(loadEnvFile(file), {
    TOKEN: "a=b=c",
    URL: "https://x.example/?a=1&b=2",
  });
});

test("returns {} for a missing file instead of throwing", () => {
  assert.deepEqual(
    loadEnvFile(path.join(os.tmpdir(), "ve-env-does-not-exist-12345")),
    {}
  );
});

test("later lines win on duplicate keys", () => {
  const file = writeTempEnv("K=first\nK=second\n");
  assert.equal(loadEnvFile(file).K, "second");
});
