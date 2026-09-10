export function resolvePublicUrl(pathFromPublicDir: string): string {
  const normalizedPath = pathFromPublicDir.replace(/^\/+/, "")
  const base = import.meta.env.BASE_URL ?? "/"
  const normalizedBase = base.endsWith("/") ? base : `${base}/`
  return `${normalizedBase}${normalizedPath}`
}
