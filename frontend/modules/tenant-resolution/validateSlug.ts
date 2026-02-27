const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

export function validateSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return SLUG_REGEX.test(normalized);
}

export function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}
