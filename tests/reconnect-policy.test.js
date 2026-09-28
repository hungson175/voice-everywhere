/**
 * What the bar does when the speech-to-text connection drops.
 *
 * Before: a dropped socket was only logged — the bar kept saying LISTENING
 * with the mic on and audio going nowhere. An STT error stopped the mic but
 * the ERROR auto-timer flipped the bar back to LISTENING anyway: a "listening"
 * bar that could not hear.
 *
 * Now (ported from AI-teams-controller 9d8e0eb9 / 214a8a4f): a lost connection
 * retries with bounded exponential backoff; a definite refusal (bad key, no
 * mic) is shown once and the mic goes off; the bar never claims LISTENING
 * unless the engine is really live.
 *
 * Run: npm test
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  ReconnectPolicy,
  decideOnDrop,
  afterFeedback,
} = require("../ui/reconnect-policy.js");

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe("ReconnectPolicy", () => {
  test("backs off 1 s, 2 s, 4 s, 8 s, 16 s, then gives up", () => {
    const policy = new ReconnectPolicy({ now: clock().now });
    const delays = [];
    for (let i = 0; i < 6; i++) delays.push(policy.nextDelay());
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, null]);
  });

  test("a connection that flaps (drops within 30 s) keeps backing off", () => {
    const c = clock();
    const policy = new ReconnectPolicy({ now: c.now });
    assert.equal(policy.nextDelay(), 1000);
    policy.connected();
    c.advance(5000);
    assert.equal(policy.nextDelay(), 2000, "a short-lived connection must not reset the backoff");
  });

  test("a connection that stayed up 30 s starts the backoff over", () => {
    const c = clock();
    const policy = new ReconnectPolicy({ now: c.now });
    policy.nextDelay();
    policy.nextDelay();
    policy.connected();
    c.advance(30000);
    assert.equal(policy.nextDelay(), 1000);
  });

  test("reset() — the user started a fresh session", () => {
    const policy = new ReconnectPolicy({ now: clock().now });
    for (let i = 0; i < 6; i++) policy.nextDelay();
    policy.reset();
    assert.equal(policy.nextDelay(), 1000);
  });

  test("reports the attempt number for the bar", () => {
    const policy = new ReconnectPolicy({ now: clock().now });
    policy.nextDelay();
    policy.nextDelay();
    assert.equal(policy.attempt, 2);
    assert.equal(policy.maxAttempts, 5);
  });
});

describe("decideOnDrop", () => {
  const transient = Object.assign(new Error("closed (1006)"), { transient: true });
  const definite = Object.assign(new Error("Incorrect API key provided"), { transient: false });

  test("a lost connection is retried after the policy's delay", () => {
    const policy = new ReconnectPolicy({ now: clock().now });
    assert.deepEqual(decideOnDrop(transient, policy), { action: "retry", delay: 1000, attempt: 1, maxAttempts: 5 });
  });

  test("an error with no classification counts as a lost connection", () => {
    const policy = new ReconnectPolicy({ now: clock().now });
    assert.equal(decideOnDrop(new Error("socket closed"), policy).action, "retry");
  });

  test("a definite refusal is never retried", () => {
    const policy = new ReconnectPolicy({ now: clock().now });
    assert.deepEqual(decideOnDrop(definite, policy), { action: "fail", reason: "refused" });
    assert.equal(policy.attempt, 0, "a refusal must not use up retries");
  });

  test("retries run out → fail", () => {
    const policy = new ReconnectPolicy({ now: clock().now });
    for (let i = 0; i < 5; i++) decideOnDrop(transient, policy);
    assert.deepEqual(decideOnDrop(transient, policy), { action: "fail", reason: "gave-up" });
  });
});

describe("afterFeedback — where the bar goes after SUCCESS / CLIPBOARD / ERROR", () => {
  test("engine live → LISTENING", () => {
    assert.equal(afterFeedback({ sttLive: true, reconnectPending: false }), "LISTENING");
  });

  test("engine down, reconnect scheduled → RECONNECTING (not a fake LISTENING)", () => {
    assert.equal(afterFeedback({ sttLive: false, reconnectPending: true }), "RECONNECTING");
  });

  test("engine down, nothing scheduled → HIDDEN (the old bug showed LISTENING)", () => {
    assert.equal(afterFeedback({ sttLive: false, reconnectPending: false }), "HIDDEN");
  });
});
