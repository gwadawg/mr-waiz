import { landingPageUrl, type LandingProduct } from "./products";

export async function productionPageIsLive(
  product: LandingProduct,
  slug: string,
  attempts = 1,
): Promise<boolean> {
  const url = landingPageUrl(product, slug);
  const tries = Math.max(1, attempts);
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (res.status === 200) return true;
    } catch {
      // The next attempt, or the form's check action, retries.
    }
    if (i < tries - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return false;
}
