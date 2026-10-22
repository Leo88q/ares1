import test from "node:test";
import assert from "node:assert/strict";
import { COLONY_PACKAGE_CATALOG, colonyPackageCatalogResponse } from "../src/colonies/catalog.js";

test("colony package endpoint is a closed proposal, never a purchasable offer", () => {
  const response = colonyPackageCatalogResponse();
  assert.equal(response.status, "design-only");
  assert.equal(response.saleOpen, false);
  assert.equal(response.purchasable, false);
  assert.equal(response.targetChain, "mainnet-beta");
  assert.match(response.notice, /Покупки закрыты/);
  assert.match(response.notice, /утверждённая спецификация расширений/);
  assert.match(response.notice, /Старый маршрут 1053 SKR создавал одно поле/);
});

test("starter SKU is a deterministic 1053 SKR field + Core + Lab entry point", () => {
  const starter = COLONY_PACKAGE_CATALOG.find((item) => item.id === "STARTER_COLONY_V1");
  assert.ok(starter);
  assert.equal(starter.priceSkr, "1053");
  assert.equal(starter.priceStatus, "owner-proposed");
  assert.deepEqual(starter.grants, {
    fields: 1,
    labLevelCap: 1,
    buildQueues: 1,
    researchQueues: 1,
    storageMultiplier: 1,
    core: true,
    lab: true,
  });
  assert.equal(starter.randomized, false);
});

test("owner-approved expansion SKUs offer scale and parallelism without random outcomes", () => {
  const research = COLONY_PACKAGE_CATALOG.find((item) => item.id === "RESEARCH_WING_V1");
  const frontier = COLONY_PACKAGE_CATALOG.find((item) => item.id === "FRONTIER_EXPANSION_V1");
  const industrial = COLONY_PACKAGE_CATALOG.find((item) => item.id === "INDUSTRIAL_NETWORK_V1");
  assert.ok(research && frontier && industrial);
  assert.equal(research.priceStatus, "owner-approved");
  assert.equal(research.priceSkr, "1053");
  assert.equal(frontier.priceStatus, "owner-approved");
  assert.equal(frontier.priceSkr, "2106");
  assert.equal(industrial.priceStatus, "owner-approved");
  assert.equal(industrial.priceSkr, "4212");
  assert.equal(research.grants.researchQueues, 1);
  assert.equal(frontier.grants.fields, 2);
  assert.equal(frontier.grants.buildQueues, 1);
  assert.equal(industrial.grants.fields, 4);
  assert.equal(industrial.grants.labLevelCap, 4);
  for (const item of [research, frontier, industrial]) {
    assert.equal(item.randomized, false);
    assert.deepEqual(item.requires, ["STARTER_COLONY_V1"]);
  }
});

test("SKR price values use decimal strings, never imprecise JS numbers", () => {
  for (const item of COLONY_PACKAGE_CATALOG) {
    assert.match(item.priceSkr, /^\d+$/);
  }
  assert.deepEqual(new Set(COLONY_PACKAGE_CATALOG.map((item) => item.id)).size, COLONY_PACKAGE_CATALOG.length);
});
