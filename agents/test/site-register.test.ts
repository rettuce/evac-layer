import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSite, MunicipalityLookupFailed } from "../src/site-register.js";

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
});

test("no code from GSI and none given fails instead of writing an empty municipality_id", async () => {
  await assert.rejects(buildSite({ id: "sea", lat: 0, lng: 0, facing_deg: 0 }, gsiAnswering({}).fn), MunicipalityLookupFailed);
});
