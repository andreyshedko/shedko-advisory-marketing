import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const template = readFileSync("public/google-ads-script.js", "utf8");
const script = template.replace(
  "SET_A_PRIVATE_RANDOM_SECRET_24_OR_MORE_CHARACTERS",
  "test-only-shedko-secret-with-no-real-access",
);
function run(rowCount: number, reply?: { status: number; body: string }) {
  const requests: { payload: string }[] = [];
  const logs: string[] = [];
  let index = 0;
  const context = {
    AdsApp: {
      currentAccount: () => ({
        getCustomerId: () => "123-456-7890",
        getCurrencyCode: () => "EUR",
      }),
      search: () => ({
        hasNext: () => index < rowCount,
        next: () => ({
          campaign: { id: ++index, name: "Test campaign" },
          segments: { date: "2026-10-24" },
          metrics: { impressions: 10, clicks: 1, costMicros: 500000, conversions: 0 },
        }),
      }),
    },
    UrlFetchApp: {
      fetch: (_url: string, options: { payload: string }) => {
        requests.push(options);
        return {
          getResponseCode: () => reply?.status ?? 200,
          getContentText: () =>
            reply?.body ?? JSON.stringify({ imported: JSON.parse(options.payload).length }),
        };
      },
    },
    Logger: { log: (value: string) => logs.push(value) },
  };
  return { requests, logs, execute: () => runInNewContext(script + "\nmain();", context) };
}

describe("Google Ads read-only script acknowledgements", () => {
  it("confirms the connection even when Google returns no campaign rows", () => {
    const r = run(0);
    r.execute();
    expect(r.requests.map((x) => JSON.parse(x.payload))).toEqual([[]]);
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0]).toContain("Получено строк за 7 завершённых дней: 0");
  });

  it("reports the confirmed total across full and partial batches", () => {
    const r = run(501);
    r.execute();
    expect(r.requests.map((x) => JSON.parse(x.payload).length)).toEqual([500, 1]);
    expect(r.logs[0]).toContain("завершённых дней: 501");
  });

  it.each([
    { status: 401, body: "{}" },
    { status: 200, body: "<html>Sign in</html>" },
    { status: 200, body: '{"imported":1}' },
  ])("does not report success for an unconfirmed import: $status / $body", (reply) => {
    const r = run(0, reply);
    expect(r.execute).toThrow();
    expect(r.logs).toEqual([]);
  });
});
