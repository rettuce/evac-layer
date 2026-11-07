import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSite, InvalidCoordinates, municipalityAt, MunicipalityLookupFailed } from "../src/site-register.js";

const gsiAnswering = (body: unknown) => {
  const calls: string[] = [];
  const fn = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
};

test("a site without municipality_id takes the code from the GSI reverse geocoder", async () => {
  const gsi = gsiAnswering({ results: { muniCd: "05210", lv01Nm: "花畑町一丁目" } });
  const { site, warnings } = await buildSite({ id: "honjo-test", lat: 39.38633978, lng: 140.0563304, facing_deg: 0, name: "Honjo" }, gsi.fn);
  assert.equal(site.municipality_id, "05210");
  assert.deepEqual(warnings, []);
  assert.equal(gsi.calls.length, 1);
  assert.match(gsi.calls[0], /LonLatToAddress\?lat=39\.38633978&lon=140\.0563304$/);
});

test("a given municipality_id wins over the GSI code, with a warning when they differ", async () => {
  const gsi = gsiAnswering({ results: { muniCd: "05210" } });
  const { site, warnings } = await buildSite({ id: "honjo-test", lat: 39.38633978, lng: 140.0563304, facing_deg: 0, municipality_id: "05203" }, gsi.fn);
  assert.equal(site.municipality_id, "05203");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /05203.*05210/);
  assert.equal(gsi.calls.length, 1);
});

test("a given municipality_id is written with a warning when the reverse geocoder does not answer", async () => {
  const down = (async () => new Response("unavailable", { status: 500 })) as typeof fetch;
  const { site, warnings } = await buildSite({ id: "honjo-test", lat: 39.38633978, lng: 140.0563304, facing_deg: 0, municipality_id: "05210" }, down);
  assert.equal(site.municipality_id, "05210");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HTTP 500.*keeping the given municipality_id 05210/);
});

test("no code from GSI and none given fails instead of writing an empty municipality_id", async () => {
  await assert.rejects(buildSite({ id: "sea", lat: 0, lng: 0, facing_deg: 0 }, gsiAnswering({}).fn), MunicipalityLookupFailed);
});

const HONJO = { lat: 39.38633978, lng: 140.0563304 };

function counting(respond: (init?: RequestInit) => Promise<Response>) {
  let calls = 0;
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    return respond(init);
  }) as typeof fetch;
  return { fn, calls: () => calls };
}

for (const [name, respond] of [
  ["HTTP 500", async () => new Response("{}", { status: 500 })],
  ["invalid JSON", async () => new Response("<html>", { status: 200 })],
  ["a muniCd that is not 5 digits", async () => new Response(JSON.stringify({ results: { muniCd: "5210" } }), { status: 200 })],
] as const) {
  test(`the reverse geocoder answering ${name} fails after one request`, async () => {
    const gsi = counting(respond);
    await assert.rejects(municipalityAt(HONJO.lat, HONJO.lng, gsi.fn), MunicipalityLookupFailed);
    assert.equal(gsi.calls(), 1);
  });
}

test("a reverse geocoder that does not answer in time is aborted after one request", async () => {
  const gsi = counting(
    (init) =>
      new Promise<Response>((_resolve, reject) => {
        const openSocket = setInterval(() => {}, 1_000);
        init?.signal?.addEventListener("abort", () => {
          clearInterval(openSocket);
          reject(init.signal!.reason);
        });
      }),
  );
  await assert.rejects(municipalityAt(HONJO.lat, HONJO.lng, gsi.fn, 20), (e: Error) => e instanceof MunicipalityLookupFailed && /timeout|abort/i.test(e.message));
  assert.equal(gsi.calls(), 1);
});

test("coordinates out of range or not finite are refused before any request", async () => {
  const gsi = counting(async () => new Response("{}"));
  for (const [lat, lng] of [[91, 140], [39, 181], [Number.NaN, 140], [39, Number.POSITIVE_INFINITY]]) {
    await assert.rejects(municipalityAt(lat, lng, gsi.fn), InvalidCoordinates);
    await assert.rejects(buildSite({ id: "x-site", lat, lng, facing_deg: 0, municipality_id: "05210" }, gsi.fn), InvalidCoordinates);
  }
  assert.equal(gsi.calls(), 0);
});
