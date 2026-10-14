import {
  DEFAULT_TAGLINE,
  HEX_COLOR,
  HERO_HEADLINE_MAX,
  RM_STOCK_HERO,
  SLUG_PATTERN,
  demoSlugs,
  landingProductFor,
  reservedSlugs,
  type LandingProduct,
  type LandingTheme,
} from "./products";
import type { BrandType, Colorway, LandingClient, LandingDraft, SmsStatus, StateNotice } from "./types";

const THEMES = new Set<LandingTheme>(["theme-1", "theme-light", "theme-custom"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function emptyLandingDraft(): LandingDraft {
  return {
    slug: "",
    theme: "theme-1",
    accent: "",
    preview: true,
    name: "",
    firstName: "",
    title: "",
    company: "",
    tagline: DEFAULT_TAGLINE,
    bio: "",
    phone: "",
    email: "",
    street: "",
    city: "",
    region: "",
    postalCode: "",
    nmlsIndividual: "",
    nmlsCompany: "",
    smsStatus: "ready",
    stateNotices: [],
    applyUrl: "",
    bookingUrl: "",
    brandType: "individual",
    colorway: "stock",
    ink: "",
    action: "",
    mark: "",
    cream: "",
    legalName: "",
    heroHeadline: "",
  };
}

function suggestNotices(states: string[] | null | undefined): StateNotice[] {
  const set = new Set((states ?? []).map(s => s.trim().toUpperCase()));
  const notices: StateNotice[] = [];
  if (set.has("TX") || set.has("TEXAS")) notices.push("texas");
  if (set.has("IL") || set.has("ILLINOIS")) notices.push("illinois");
  return notices;
}

export function draftFromClient(
  client: LandingClient,
  onboardingFirstName: string | null,
): LandingDraft {
  const product = landingProductFor(client.reporting_type) ?? "DSCR";
  const name = text(client.primary_contact_name) || text(client.name);
  const suggested = suggestSlug(name);
  const demos = demoSlugs(product);
  const slug =
    suggested && !reservedSlugs(product).has(suggested) && !demos.includes(suggested)
      ? suggested
      : "";
  const first = text(onboardingFirstName) || name.split(/\s+/)[0] || "";
  const notices = suggestNotices(client.states_licensed);
  return {
    ...emptyLandingDraft(),
    slug,
    name,
    firstName: first,
    company: text(client.brokerage_name) || text(client.legal_business_name),
    tagline: product === "RM" ? "" : DEFAULT_TAGLINE,
    bio: text(client.biography),
    phone: text(client.phone),
    email: text(client.email),
    street: text(client.street_address),
    city: text(client.city),
    region: text(client.state),
    postalCode: text(client.zip_code),
    nmlsIndividual: text(client.nmls),
    smsStatus: product === "RM" ? "pending" : "ready",
    stateNotices: product === "RM" ? notices.filter(notice => notice === "texas") : notices,
    heroHeadline: product === "RM" ? RM_STOCK_HERO : "",
  };
}

function asTheme(value: unknown): LandingTheme | null {
  return typeof value === "string" && THEMES.has(value as LandingTheme) ? (value as LandingTheme) : null;
}

function asSms(value: unknown): SmsStatus | null {
  return value === "ready" || value === "pending" ? value : null;
}

function asBrandType(value: unknown): BrandType {
  return value === "company" ? "company" : "individual";
}

function asColorway(value: unknown): Colorway {
  return value === "custom" ? "custom" : "stock";
}

function asNotices(value: unknown): StateNotice[] {
  if (!Array.isArray(value)) return [];
  const out: StateNotice[] = [];
  for (const item of value) {
    if (item === "texas" || item === "illinois") {
      if (!out.includes(item)) out.push(item);
    }
  }
  return out;
}

/** Parse a stored or posted draft. Missing keys fall back to an empty draft. */
export function parseLandingDraft(input: unknown): LandingDraft {
  const raw =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const base = emptyLandingDraft();
  return {
    slug: text(raw.slug).toLowerCase(),
    theme: asTheme(raw.theme) ?? base.theme,
    accent: text(raw.accent),
    preview: typeof raw.preview === "boolean" ? raw.preview : base.preview,
    name: text(raw.name),
    firstName: text(raw.firstName),
    title: text(raw.title),
    company: text(raw.company),
    tagline: text(raw.tagline) || base.tagline,
    bio: text(raw.bio),
    phone: text(raw.phone),
    email: text(raw.email),
    street: text(raw.street),
    city: text(raw.city),
    region: text(raw.region).toUpperCase(),
    postalCode: text(raw.postalCode),
    nmlsIndividual: text(raw.nmlsIndividual),
    nmlsCompany: text(raw.nmlsCompany),
    smsStatus: asSms(raw.smsStatus) ?? base.smsStatus,
    stateNotices: asNotices(raw.stateNotices),
    applyUrl: text(raw.applyUrl),
    bookingUrl: text(raw.bookingUrl),
    brandType: asBrandType(raw.brandType),
    colorway: asColorway(raw.colorway),
    ink: text(raw.ink),
    action: text(raw.action),
    mark: text(raw.mark),
    cream: text(raw.cream),
    legalName: text(raw.legalName),
    heroHeadline: text(raw.heroHeadline),
  };
}

function pick(saved: string, fallback: string): string {
  return saved.trim() || fallback;
}

/** Saved non-empty values win. Empty saved strings fall through to the client. */
export function prefillLandingDraft(
  client: LandingClient,
  saved: LandingDraft | null,
  onboardingFirstName: string | null,
): LandingDraft {
  const fromClient = draftFromClient(client, onboardingFirstName);
  if (!saved) return fromClient;
  return {
    slug: pick(saved.slug, fromClient.slug),
    theme: saved.theme,
    accent: saved.accent,
    preview: saved.preview,
    name: pick(saved.name, fromClient.name),
    firstName: pick(saved.firstName, fromClient.firstName),
    title: saved.title,
    company: pick(saved.company, fromClient.company),
    tagline: pick(saved.tagline, fromClient.tagline),
    bio: pick(saved.bio, fromClient.bio),
    phone: pick(saved.phone, fromClient.phone),
    email: pick(saved.email, fromClient.email),
    street: pick(saved.street, fromClient.street),
    city: pick(saved.city, fromClient.city),
    region: pick(saved.region, fromClient.region),
    postalCode: pick(saved.postalCode, fromClient.postalCode),
    nmlsIndividual: pick(saved.nmlsIndividual, fromClient.nmlsIndividual),
    nmlsCompany: pick(saved.nmlsCompany, fromClient.nmlsCompany),
    smsStatus: saved.smsStatus,
    stateNotices: saved.stateNotices,
    applyUrl: pick(saved.applyUrl, fromClient.applyUrl),
    bookingUrl: saved.bookingUrl,
    brandType: saved.brandType,
    colorway: saved.colorway,
    ink: saved.ink,
    action: saved.action,
    mark: saved.mark,
    cream: saved.cream,
    legalName: pick(saved.legalName, fromClient.legalName),
    heroHeadline: pick(saved.heroHeadline, fromClient.heroHeadline),
  };
}

/** DSCR first publish is live and noindex. Later publishes keep that choice. Reverse pages publish live. */
export function draftForPublish(
  draft: LandingDraft,
  hasApplied: boolean,
  product: LandingProduct = "DSCR",
): LandingDraft {
  if (product === "RM") {
    return {
      ...draft,
      theme: "theme-1",
      heroHeadline: draft.heroHeadline.trim() || RM_STOCK_HERO,
    };
  }
  if (!hasApplied) return { ...draft, preview: true };
  return draft;
}

/** Visible characters, ignoring one *italic* pair. Empty is valid and uses the stock line. */
export function reviewHeroHeadline(raw: string): { length: number; error: string | null } {
  const input = raw.replace(/\s+/g, " ").trim();
  if (!input) return { length: 0, error: null };
  if (/[<>]/.test(input)) {
    return {
      length: [...input].length,
      error: "Hero line cannot include HTML. Wrap one phrase in *asterisks* for the italic.",
    };
  }
  const stars = input.match(/\*/g);
  if (stars && stars.length !== 2) {
    return {
      length: [...input.replace(/\*/g, "")].length,
      error: "Hero line can use one pair of *asterisks* for the italic.",
    };
  }
  let text = input;
  if (stars) {
    const match = input.match(/^(.*)\*([^*]+)\*(.*)$/);
    if (!match || !match[2].trim()) {
      return {
        length: [...input.replace(/\*/g, "")].length,
        error: "Hero line can use one pair of *asterisks* for the italic.",
      };
    }
    text = `${match[1]}${match[2]}${match[3]}`.replace(/\s+/g, " ").trim();
  }
  const length = [...text].length;
  if (length > HERO_HEADLINE_MAX) {
    return { length, error: `Hero line is ${length} characters. Theme 1 allows ${HERO_HEADLINE_MAX}.` };
  }
  return { length, error: null };
}

function hasTrackingParams(url: string): boolean {
  try {
    const parsed = new URL(url);
    for (const key of parsed.searchParams.keys()) {
      const name = key.toLowerCase();
      if (name.startsWith("utm_") || name === "fbclid" || name === "gclid") return true;
    }
    return false;
  } catch {
    return false;
  }
}

export type SlugContext = {
  slugTaken: boolean;
  repoYamlExists: boolean;
  clientOwnsSlug: boolean;
};

export function validateSlug(slug: string, ctx: SlugContext, product: LandingProduct = "DSCR"): string[] {
  const errors: string[] = [];
  if (!slug) {
    errors.push("Slug is required");
    return errors;
  }
  if (!SLUG_PATTERN.test(slug)) {
    errors.push("Slug must be lowercase letters, numbers, and single hyphens");
  }
  if (reservedSlugs(product).has(slug)) {
    errors.push(`Slug "${slug}" is reserved by the site`);
  }
  if (demoSlugs(product).includes(slug)) {
    errors.push(`Slug "${slug}" is a demo page`);
  }
  if (ctx.slugTaken) {
    errors.push(`Slug "${slug}" is already used by another client`);
  }
  if (ctx.repoYamlExists && !ctx.clientOwnsSlug) {
    errors.push(`Slug "${slug}" already has a page in the landing repo`);
  }
  return errors;
}

function pushHexError(errors: string[], label: string, value: string, required: boolean) {
  if (!value) {
    if (required) errors.push(`${label} is required`);
    return;
  }
  if (!HEX_COLOR.test(value)) errors.push(`${label} must be a hex color like #1B3A2F`);
}

export function validateForPublish(
  draft: LandingDraft,
  ctx: SlugContext,
  product: LandingProduct = "DSCR",
): string[] {
  const errors = validateSlug(draft.slug, ctx, product);
  const individualBrand = product !== "RM" || draft.brandType === "individual";
  if (!draft.name) errors.push("Public name is required");
  if (individualBrand && !draft.company) errors.push("Company is required");
  if (!draft.phone) errors.push("Phone is required");
  if (!draft.email) errors.push("Email is required");
  if (!draft.street || !draft.city || !draft.region || !draft.postalCode) {
    errors.push("Street, city, state, and ZIP are required");
  }
  if (individualBrand && !draft.nmlsIndividual) errors.push("Individual NMLS is required");
  if (!draft.nmlsCompany) errors.push("Company NMLS is required");
  if (!draft.applyUrl) errors.push("Quiz URL is required");
  else if (!/^https?:\/\/\S+$/i.test(draft.applyUrl)) {
    errors.push("Quiz URL must be a full http(s) link");
  } else if (product === "RM" && hasTrackingParams(draft.applyUrl)) {
    errors.push("Quiz URL must be a plain link. Leave off utm, fbclid, and gclid.");
  }
  if (product === "DSCR") {
    if (draft.bookingUrl && !/^https?:\/\/\S+$/i.test(draft.bookingUrl)) {
      errors.push("Booking URL must be a full http(s) link");
    }
    if (draft.theme === "theme-1" && draft.accent) {
      errors.push("The dark template does not take a custom color");
    }
    if (draft.theme === "theme-custom" && !HEX_COLOR.test(draft.accent)) {
      errors.push("Custom color must be a hex color like #1B4D3E");
    }
    if (draft.theme === "theme-light" && draft.accent && !HEX_COLOR.test(draft.accent)) {
      errors.push("Accent must be a hex color like #1B4D3E");
    }
  }
  if (product === "RM") {
    const colors = [draft.ink, draft.action, draft.mark, draft.cream].some(value => value.trim());
    if (draft.colorway === "stock" && colors) {
      errors.push("Set colorway to custom to use brand colors, or clear them");
    }
    if (draft.colorway === "custom") {
      pushHexError(errors, "Ink", draft.ink, true);
      pushHexError(errors, "Action", draft.action, true);
      pushHexError(errors, "Mark", draft.mark, false);
      pushHexError(errors, "Cream", draft.cream, false);
    }
    const hero = reviewHeroHeadline(draft.heroHeadline);
    if (hero.error) errors.push(hero.error);
  }
  if (draft.smsStatus !== "ready" && draft.smsStatus !== "pending") {
    errors.push("Texting status must be ready or pending");
  }
  return errors;
}
