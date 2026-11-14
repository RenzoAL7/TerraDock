/** Saves text (as UTF-8) or a Blob as a file, without leaving the page. */
export function download(name: string, content: string | Blob) {
  const blob =
    typeof content === "string"
      ? new Blob([content], { type: "text/plain;charset=utf-8" })
      : content;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from free text: lowercase letters, digits and dashes. */
export function fileSlug(text: string, fallback = "terradock") {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}
