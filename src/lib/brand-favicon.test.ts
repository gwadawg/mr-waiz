import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { showsBrandFavicon, withBrandFavicon } from "./brand-favicon";

const page = "<html><head><title>Sheet</title></head><body></body></html>";

describe("showsBrandFavicon", () => {
  it("allows the dashboard and offer-sheet hosts", () => {
    assert.equal(showsBrandFavicon(null, "os.waizmedia.net"), true);
    assert.equal(showsBrandFavicon(null, "offerletter.waizmedia.net"), true);
    assert.equal(showsBrandFavicon(null, "offersheet.waizmedia.net:443"), true);
    assert.equal(showsBrandFavicon("os.waizmedia.net, internal", "localhost:3000"), true);
  });

  it("hides the mark on every other host", () => {
    assert.equal(showsBrandFavicon(null, "loanofficer.me"), false);
    assert.equal(showsBrandFavicon(null, "retirementmortgagexperts.com"), false);
    assert.equal(showsBrandFavicon(null, "localhost:3000"), false);
    assert.equal(showsBrandFavicon(null, null), false);
  });
});

describe("withBrandFavicon", () => {
  it("adds the icon link only on a branded host", () => {
    const branded = withBrandFavicon(page, null, "offerletter.waizmedia.net");
    assert.match(branded, /rel="icon"/);
    assert.equal(withBrandFavicon(page, null, "loanofficer.me"), page);
  });
});
