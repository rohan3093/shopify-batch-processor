export function slugify(text) {
  return (text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseTitleFromFilename(filename) {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function inferSku(filename) {
  const match = filename.match(/([A-Z0-9]{3,}[-_][A-Z0-9_-]{2,})/i);
  return match ? match[1].replace(/_/g, "-").toUpperCase() : "";
}

export function groupKeyFromFile(file) {
  const relativePath = file.webkitRelativePath || "";
  const source = relativePath || file.name;
  const sku = inferSku(source);

  if (sku) {
    return sku;
  }

  const base = source
    .split("/")
    .pop()
    .replace(/\.[^/.]+$/, "")
    .replace(/(?:[_-]?(front|side|angle|detail|pair|hero|alt)\d*)$/i, "");

  return slugify(base) || slugify(file.name);
}

export function createEmptyProduct(groupKey, file) {
  const title = parseTitleFromFilename(groupKey.replace(/-/g, " "));
  return {
    id: groupKey,
    groupKey,
    title,
    handle: slugify(title),
    sku: inferSku(file.name) || groupKey.toUpperCase(),
    price: "",
    compareAtPrice: "",
    inventoryQty: "1",
    status: "draft",
    reviewState: "pending",
    notes: "",
    images: [],
  };
}
