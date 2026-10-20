import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import YAML from "yaml";
import { assetFileId } from "./assets";
import { headshotExtension, logoRepoFile } from "./headshot";
import {
  draftForPublish,
  draftFromClient,
  nextNumberedSlug,
  prefillLandingDraft,
  validateForPublish,
  type SlugContext,
} from "./intake";
import { HS_STOCK_HERO, RM_STOCK_HERO } from "./products";
import { emptyPublish, toLandingResponses } from "./responses";
import { verifyGithubSignature } from "./signature";
import { groupLandingSites, shouldWritePrimaryUrl } from "./sites";
import { landingEditSource } from "./storage";
import type { LandingClient, LandingDraft } from "./types";
import { draftToYaml } from "./yaml";
import type { FormSubmissionRow } from "@/lib/form-submissions";

const openSlug: SlugContext = {
  slugTaken: false,
  repoYamlExists: false,
  clientOwnsSlug: false,
};

function filled(overrides: Partial<LandingDraft> = {}): LandingDraft {
  return {
    slug: "jane-doe",
    theme: "theme-1",
    accent: "",
    preview: false,
    name: "Jane Doe",
    firstName: "Jane",
    title: "DSCR Specialist",
    company: "Acme Lending",
    tagline: "DSCR refinance for rental investors",
    bio: "Reads rental files.",
    phone: "(555) 555-0100",
    email: "jane@acme.example",
    street: "100 Main Street",
    city: "Austin",
    region: "TX",
    postalCode: "78701",
    nmlsIndividual: "111111",
    nmlsCompany: "222222",
    smsStatus: "ready",
    stateNotices: ["texas"],
    applyUrl: "https://example.com/jane-quiz",
    bookingUrl: "",
    brandType: "individual",
    colorway: "stock",
    ink: "",
    action: "",
    mark: "",
    cream: "",
    legalName: "",
    heroHeadline: "",
    fitAge: "",
    fitCredit: "",
    ...overrides,
  };
}

const client: LandingClient = {
  id: "c1",
  name: "Jane Doe",
  reporting_type: "DSCR",
  primary_contact_name: "Jane Doe",
  email: "jane@acme.example",
  phone: "5555550100",
  nmls: "111111",
  brokerage_name: "Acme Lending",
  legal_business_name: null,
  biography: "Reads rental files.",
  street_address: "100 Main Street",
  city: "Austin",
  state: "TX",
  zip_code: "78701",
  states_licensed: ["TX"],
  headshot_url: null,
  logo_url: null,
  landing_page_url: null,
  thank_you_page_url: null,
};

describe("landing page intake", () => {
  it("prefills from the client and suggests texas", () => {
    const draft = draftFromClient(client, "Jane", "DSCR");
    assert.equal(draft.slug, "jane-doe-1");
    assert.equal(draft.nmlsIndividual, "111111");
    assert.equal(draft.company, "Acme Lending");
    assert.deepEqual(draft.stateNotices, ["texas"]);
    assert.equal(draft.smsStatus, "ready");
    assert.equal(draft.preview, true);
  });

  it("lets a saved value win over the client row", () => {
    const saved = filled({ company: "Saved Co", phone: "" });
    const draft = prefillLandingDraft(client, saved, null);
    assert.equal(draft.company, "Saved Co");
    assert.equal(draft.phone, "5555550100");
  });

  it("rejects reserved, demo, and colliding slugs", () => {
    assert.ok(validateForPublish(filled({ slug: "themes" }), openSlug).some(e => /reserved/i.test(e)));
    assert.ok(validateForPublish(filled({ slug: "demo-lo" }), openSlug).some(e => /demo/i.test(e)));
    assert.ok(
      validateForPublish(filled(), { ...openSlug, slugTaken: true }).some(e => /another landing page/i.test(e)),
    );
    assert.ok(
      validateForPublish(filled(), { ...openSlug, repoYamlExists: true }).some(e => /landing repo/i.test(e)),
    );
    assert.equal(
      validateForPublish(filled(), { ...openSlug, repoYamlExists: true, clientOwnsSlug: true }).filter(e =>
        /landing repo/i.test(e),
      ).length,
      0,
    );
  });

  it("rejects a custom color on the dark template and requires one on theme-custom", () => {
    assert.ok(validateForPublish(filled({ accent: "#112233" }), openSlug).some(e => /custom color/i.test(e)));
    assert.ok(
      validateForPublish(filled({ theme: "theme-custom", accent: "" }), openSlug).some(e => /hex/i.test(e)),
    );
    assert.equal(
      validateForPublish(filled({ theme: "theme-custom", accent: "#1B4D3E" }), openSlug).length,
      0,
    );
  });

  it("forces preview on the first publish and allows it off later", () => {
    assert.equal(draftForPublish(filled({ preview: false }), false).preview, true);
    assert.equal(draftForPublish(filled({ preview: false }), true).preview, false);
  });
});

describe("landing page yaml", () => {
  it("round-trips the fields the factory requires", () => {
    const yaml = draftToYaml(draftForPublish(filled({ preview: false }), false));
    const parsed = YAML.parse(yaml) as Record<string, unknown>;
    const compliance = parsed.compliance as Record<string, unknown>;
    const sms = compliance.sms as Record<string, unknown>;
    const assets = parsed.assets as Record<string, unknown>;
    const products = parsed.products as Record<string, unknown>;
    assert.equal(parsed.draft, false);
    assert.equal(parsed.preview, true);
    assert.equal(parsed.slug, "jane-doe");
    assert.equal(parsed.theme, "theme-1");
    assert.equal(parsed.brand, undefined);
    assert.equal(compliance.nmlsCompany, "222222");
    assert.equal(sms.status, "ready");
    assert.deepEqual(compliance.stateNotices, ["texas"]);
    assert.equal(parsed.applyUrl, "https://example.com/jane-quiz");
    assert.equal(assets.headshot, "");
    assert.equal(products.primaryResidence, false);
    assert.equal(parsed.colorway, undefined);
    assert.equal(parsed.brandType, undefined);
    assert.equal(parsed.copy, undefined);
    assert.equal(parsed.fit, undefined);
    assert.equal((parsed.contacts as { phoneE164: string }).phoneE164, "15555550100");
    assert.equal((sms as { programName: string }).programName, "Jane Doe / Acme Lending");

    const later = YAML.parse(draftToYaml(draftForPublish(filled({ preview: false }), true))) as {
      preview: boolean;
    };
    assert.equal(later.preview, false);
  });

  it("writes a reverse page the factory can build", () => {
    const ready = draftForPublish(filled({ heroHeadline: "" }), false, "RM");
    assert.equal(ready.heroHeadline, RM_STOCK_HERO);
    assert.equal(ready.preview, false);
    const parsed = YAML.parse(draftToYaml(ready, "RM")) as Record<string, unknown>;
    const compliance = parsed.compliance as { sms: Record<string, string>; stateNotices: string[] };
    const assets = parsed.assets as Record<string, string>;
    const identity = parsed.identity as Record<string, string>;
    assert.equal(parsed.draft, false);
    assert.equal(parsed.preview, undefined);
    assert.equal(parsed.theme, "theme-1");
    assert.equal(parsed.colorway, "stock");
    assert.equal(parsed.brandColors, undefined);
    assert.equal(parsed.brandType, "individual");
    assert.equal(parsed.products, undefined);
    assert.equal(parsed.bookingUrl, undefined);
    assert.equal(identity.bio, undefined);
    assert.equal(identity.name, "Jane Doe");
    assert.equal(assets.headshot, "");
    assert.equal(assets.logo, "");
    assert.equal(compliance.sms.status, "ready");
    assert.equal(compliance.sms.programName, "Jane Doe");
    assert.equal(compliance.sms.frequency, "Message frequency varies.");
    assert.equal((parsed.copy as { heroHeadline: string }).heroHeadline, RM_STOCK_HERO);
    assert.equal(parsed.fit, undefined);
    assert.deepEqual(compliance.stateNotices, ["texas"]);
  });

  it("writes custom colors and a blank first name for a company brand", () => {
    const parsed = YAML.parse(
      draftToYaml(
        filled({
          brandType: "company",
          colorway: "custom",
          ink: "#1B3A2F",
          action: "#2F6B4F",
          mark: "#C4A35A",
          legalName: "Acme Lending LLC",
          heroHeadline: RM_STOCK_HERO,
        }),
        "RM",
      ),
    ) as {
      brandColors: Record<string, string>;
      identity: Record<string, string>;
    };
    assert.equal(parsed.brandColors.ink, "#1B3A2F");
    assert.equal(parsed.brandColors.action, "#2F6B4F");
    assert.equal(parsed.brandColors.mark, "#C4A35A");
    assert.equal(parsed.brandColors.cream, undefined);
    assert.equal(parsed.identity.firstName, "");
    assert.equal(parsed.identity.legalName, "Acme Lending LLC");
  });
});

describe("reverse landing validation", () => {
  const rmClient: LandingClient = { ...client, reporting_type: "RM" };

  it("prefills the stock hero and leaves texting pending", () => {
    const draft = draftFromClient(rmClient, "Jane", "RM");
    assert.equal(draft.heroHeadline, RM_STOCK_HERO);
    assert.equal(draft.smsStatus, "pending");
    assert.equal(draft.tagline, "");
    assert.equal(draft.brandType, "individual");
    assert.equal(draft.colorway, "stock");
    assert.equal(draft.theme, "theme-1");
  });

  it("requires ink and action only on a custom colorway", () => {
    assert.ok(
      validateForPublish(filled({ colorway: "custom" }), openSlug, "RM").some(e => /Ink is required/i.test(e)),
    );
    assert.ok(
      validateForPublish(filled({ colorway: "stock", ink: "#1B3A2F" }), openSlug, "RM").some(e => /colorway/i.test(e)),
    );
    assert.equal(
      validateForPublish(
        filled({ colorway: "custom", ink: "#1B3A2F", action: "#2F6B4F" }),
        openSlug,
        "RM",
      ).length,
      0,
    );
  });

  it("does not require an individual NMLS for a company brand", () => {
    const company = filled({ brandType: "company", nmlsIndividual: "", company: "" });
    assert.equal(validateForPublish(company, openSlug, "RM").length, 0);
    assert.ok(
      validateForPublish(filled({ nmlsIndividual: "" }), openSlug, "RM").some(e => /Individual NMLS/i.test(e)),
    );
  });

  it("refuses host paths, demos, tracking params, and a long hero", () => {
    assert.ok(validateForPublish(filled({ slug: "guides" }), openSlug, "RM").some(e => /reserved/i.test(e)));
    assert.ok(
      validateForPublish(filled({ slug: "demo-specialist" }), openSlug, "RM").some(e => /demo/i.test(e)),
    );
    assert.ok(
      validateForPublish(
        filled({ applyUrl: "https://example.com/quiz?utm_source=facebook" }),
        openSlug,
        "RM",
      ).some(e => /plain link/i.test(e)),
    );
    assert.ok(
      validateForPublish(filled({ heroHeadline: "a".repeat(81) }), openSlug, "RM").some(e => /80/.test(e)),
    );
    assert.equal(
      validateForPublish(filled({ heroHeadline: `*${"a".repeat(80)}*` }), openSlug, "RM").length,
      0,
    );
  });
});

describe("numbered landing pages", () => {
  it("starts at 1 and skips numbers already used on that offer", () => {
    assert.equal(nextNumberedSlug("jane-doe", new Set(), "DSCR"), "jane-doe-1");
    assert.equal(nextNumberedSlug("jane-doe", new Set(["jane-doe", "jane-doe-1"]), "DSCR"), "jane-doe-2");
    assert.equal(
      draftFromClient(client, "Jane", "RM", new Set(["jane-doe-1"])).slug,
      "jane-doe-2",
    );
  });

  it("keeps a second page off the client's primary URL", () => {
    assert.equal(shouldWritePrimaryUrl(null, "https://dscrexperts.com/jane-doe-1/"), true);
    assert.equal(
      shouldWritePrimaryUrl("https://dscrexperts.com/jane-doe-1", "https://dscrexperts.com/jane-doe-1/"),
      true,
    );
    assert.equal(
      shouldWritePrimaryUrl("https://dscrexperts.com/jane-doe-1/", "https://dscrexperts.com/jane-doe-2/"),
      false,
    );
  });

  it("lists each offer and each number as its own page", () => {
    const legacy = toLandingResponses(filled({ slug: "jane-doe" }), emptyPublish(), { product: "DSCR" });
    const dscr = toLandingResponses(filled({ slug: "jane-doe-2" }), emptyPublish(), {
      siteId: "11111111-1111-4111-8111-111111111111",
      product: "DSCR",
    });
    const reverse = toLandingResponses(filled({ slug: "jane-doe-1" }), emptyPublish(), {
      siteId: "22222222-2222-4222-8222-222222222222",
      product: "RM",
    });
    const sites = groupLandingSites([
      { id: "a", client_id: "c1", status: "applied", submitted_at: "2026-10-01T00:00:00.000Z", responses: legacy },
      { id: "b", client_id: "c1", status: "applied", submitted_at: "2026-10-02T00:00:00.000Z", responses: legacy },
      { id: "c", client_id: "c1", status: "draft", submitted_at: "2026-10-03T00:00:00.000Z", responses: dscr },
      { id: "d", client_id: "c1", status: "applied", submitted_at: "2026-10-04T00:00:00.000Z", responses: reverse },
    ]);
    assert.deepEqual(
      sites.map(site => [site.product, site.slug, site.landingPageUrl]),
      [
        ["DSCR", "jane-doe", "https://dscrexperts.com/jane-doe/"],
        ["DSCR", "jane-doe-2", null],
        ["RM", "jane-doe-1", "https://retirementmortgagexpert.com/jane-doe-1/"],
      ],
    );
  });

  it("uses the chosen offer on a client filed under another product", () => {
    const draft = draftFromClient(client, "Jane", "RM");
    assert.equal(draft.heroHeadline, RM_STOCK_HERO);
    assert.equal(draft.smsStatus, "pending");
    assert.equal(client.reporting_type, "DSCR");
  });
});

describe("homesafe landing", () => {
  it("prefills the HomeSafe hero, fit floors, and pending texting", () => {
    const draft = draftFromClient(client, "Jane", "HS");
    assert.equal(draft.heroHeadline, HS_STOCK_HERO);
    assert.equal(draft.fitAge, "55");
    assert.equal(draft.fitCredit, "640");
    assert.equal(draft.smsStatus, "pending");
    assert.equal(draft.tagline, "");
    assert.equal(draft.theme, "theme-1");
    assert.equal(draft.slug, "jane-doe-1");
  });

  it("writes a HomeSafe page the factory can build", () => {
    const ready = draftForPublish(filled({ heroHeadline: "", fitAge: "", fitCredit: "" }), false, "HS");
    assert.equal(ready.heroHeadline, HS_STOCK_HERO);
    assert.equal(ready.fitAge, "55");
    assert.equal(ready.preview, false);
    const parsed = YAML.parse(draftToYaml(ready, "HS")) as Record<string, unknown>;
    const fit = parsed.fit as { age: number; creditScore?: number };
    assert.equal(parsed.draft, false);
    assert.equal(parsed.preview, undefined);
    assert.equal(parsed.theme, "theme-1");
    assert.equal(parsed.products, undefined);
    assert.equal(parsed.bookingUrl, undefined);
    assert.equal((parsed.copy as { heroHeadline: string }).heroHeadline, HS_STOCK_HERO);
    assert.equal(fit.age, 55);
    assert.equal(fit.creditScore, undefined);
    const withCredit = YAML.parse(
      draftToYaml(draftForPublish(filled({ fitCredit: "640" }), false, "HS"), "HS"),
    ) as { fit: { creditScore: number } };
    assert.equal(withCredit.fit.creditScore, 640);
  });

  it("allows several italic phrases and refuses a broken pair", () => {
    const two = filled({
      heroHeadline: "Keep *your rate* and skip *a new payment*.",
      fitAge: "55",
      fitCredit: "640",
    });
    assert.equal(validateForPublish(two, openSlug, "HS").length, 0);
    assert.ok(
      validateForPublish(filled({ heroHeadline: "Keep *your rate" }), openSlug, "HS").some(e =>
        /matching pair/i.test(e),
      ),
    );
    assert.ok(
      validateForPublish(filled({ heroHeadline: "a".repeat(81) }), openSlug, "HS").some(e => /80/.test(e)),
    );
  });

  it("keeps reverse to one italic pair", () => {
    assert.ok(
      validateForPublish(
        filled({ heroHeadline: "Keep *your rate* and skip *a new payment*." }),
        openSlug,
        "RM",
      ).some(e => /one pair/i.test(e)),
    );
  });

  it("refuses host paths and a bad fit, and stores its own site", () => {
    assert.ok(validateForPublish(filled({ slug: "faq" }), openSlug, "HS").some(e => /reserved/i.test(e)));
    assert.ok(
      validateForPublish(filled({ slug: "demo-company" }), openSlug, "HS").some(e => /demo/i.test(e)),
    );
    assert.ok(validateForPublish(filled({ fitAge: "5" }), openSlug, "HS").some(e => /Fit age/i.test(e)));
    assert.ok(validateForPublish(filled({ fitCredit: "64" }), openSlug, "HS").some(e => /credit/i.test(e)));
    const saved = toLandingResponses(filled({ slug: "jane-doe-1" }), emptyPublish(), {
      siteId: "33333333-3333-4333-8333-333333333333",
      product: "HS",
    });
    assert.equal(saved.product, "HS");
    assert.equal(saved.template_repo, "gwadawg/homesafe-landing");
    assert.equal(saved.template_id, "theme-1");
    const sites = groupLandingSites([
      {
        id: "e",
        client_id: "c1",
        status: "applied",
        submitted_at: "2026-10-05T00:00:00.000Z",
        responses: saved,
      },
    ]);
    assert.equal(sites[0]?.landingPageUrl, "https://hs.retirementmortgagexpert.com/jane-doe-1/");
  });
});

describe("landing headshot", () => {
  it("maps png and rejects gif", () => {
    assert.equal(headshotExtension({ contentType: "image/png" }), "png");
    assert.equal(headshotExtension({ filename: "photo.jpeg" }), "jpeg");
    assert.throws(() => headshotExtension({ contentType: "image/gif" }), /PNG, JPG, or WEBP/);
  });

  it("reads the storage id from a public URL and builds the logo path", () => {
    assert.equal(
      assetFileId(
        "https://example.supabase.co/storage/v1/object/public/client-headshots/logos/abc-123.png",
      ),
      "abc-123.png",
    );
    assert.equal(assetFileId(null), null);
    assert.equal(assetFileId("   "), null);
    assert.equal(
      logoRepoFile("jane-doe", { filename: "mark.webp" }).path,
      "brand_assets/clients/jane-doe/logo.webp",
    );
  });
});

describe("landing edit source", () => {
  function row(
    status: FormSubmissionRow["status"],
    submittedAt: string,
    company: string,
  ): FormSubmissionRow {
    return {
      id: `${status}-${submittedAt}`,
      client_id: "c1",
      form_type: "landing_page",
      status,
      submitted_by: null,
      match_email: null,
      match_phone: null,
      responses: toLandingResponses(filled({ company }), emptyPublish(), {
        siteId: "11111111-1111-4111-8111-111111111111",
        product: "DSCR",
      }),
      applied_patch: null,
      submitted_at: submittedAt,
    };
  }

  it("ignores a create-time draft that is older than the applied publish", () => {
    const draft = row("draft", "2026-10-01T00:00:00.000Z", "Old Draft Co");
    const applied = row("applied", "2026-10-05T00:00:00.000Z", "Live Co");
    const source = landingEditSource(null, draft, applied);
    assert.equal(source?.id, applied.id);
  });

  it("keeps a draft saved after the last applied publish", () => {
    const applied = row("applied", "2026-10-05T00:00:00.000Z", "Live Co");
    const draft = row("draft", "2026-10-06T00:00:00.000Z", "WIP Co");
    const source = landingEditSource(null, draft, applied);
    assert.equal(source?.id, draft.id);
  });

  it("prefers an open publish over draft and applied", () => {
    const draft = row("draft", "2026-10-06T00:00:00.000Z", "WIP Co");
    const applied = row("applied", "2026-10-05T00:00:00.000Z", "Live Co");
    const submitted = row("submitted", "2026-10-07T00:00:00.000Z", "Publishing Co");
    const source = landingEditSource(submitted, draft, applied);
    assert.equal(source?.id, submitted.id);
  });
});

describe("github webhook signature", () => {
  it("accepts a matching signature and rejects a mismatch", () => {
    const body = JSON.stringify({ zen: "test" });
    const secret = "secret";
    const header = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    assert.equal(verifyGithubSignature(body, header, secret), true);
    assert.equal(verifyGithubSignature(body, header, "other"), false);
    assert.equal(verifyGithubSignature(body, null, secret), false);
  });
});
