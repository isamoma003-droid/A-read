// "Science & Nature" -> "science-nature". Letters from any alphabet are kept.
export function slugify(name) {
  // Lower-case after normalising: NFKD turns letters like "𝐅" or "℃" into capitals.
  return String(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
