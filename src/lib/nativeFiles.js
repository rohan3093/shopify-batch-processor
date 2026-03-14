import { toCSV } from "./csv";

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "avif",
]);

function getExtension(path) {
  const segments = path.split(/[\\/]/);
  const filename = segments[segments.length - 1] || "";
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function fileNameFromPath(path) {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

function guessMimeType(path) {
  const extension = getExtension(path);
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "bmp") return "image/bmp";
  if (extension === "avif") return "image/avif";
  if (extension === "tif" || extension === "tiff") return "image/tiff";
  return "application/octet-stream";
}

function normalizeRelativePath(root, fullPath) {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  const candidate = fullPath.startsWith(normalizedRoot)
    ? fullPath.slice(normalizedRoot.length)
    : fullPath;

  return candidate.replace(/^[\\/]+/, "").replace(/\\/g, "/");
}

function describeError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const maybeMessage = error.message || error.error || error.reason;
    if (typeof maybeMessage === "string") {
      return maybeMessage;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown object error";
    }
  }

  return "Unknown error";
}

async function getDesktopModules() {
  const [dialogModule, fsModule, pathModule] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
    import("@tauri-apps/api/path"),
  ]);

  return {
    ...fsModule,
    ...pathModule,
    open: dialogModule.open,
    message: dialogModule.message,
  };
}

async function readImageEntriesRecursively(rootPath, currentPath, modules, files) {
  const { readDir, readFile, join } = modules;
  const entries = await readDir(currentPath);

  for (const entry of entries) {
    const entryPath = await join(currentPath, entry.name);
    if (entry.isDirectory) {
      await readImageEntriesRecursively(rootPath, entryPath, modules, files);
      continue;
    }

    if (!entry.isFile) {
      continue;
    }

    const extension = getExtension(entryPath);
    if (!IMAGE_EXTENSIONS.has(extension)) {
      continue;
    }

    const bytes = await readFile(entryPath);
    const relativePath = normalizeRelativePath(rootPath, entryPath);
    const filename = fileNameFromPath(entryPath);
    const file = new File([bytes], filename, { type: guessMimeType(entryPath) });
    Object.defineProperty(file, "webkitRelativePath", {
      value: relativePath,
      configurable: true,
    });
    files.push(file);
  }
}

export async function pickInputDirectory() {
  const { open } = await getDesktopModules();
  const selected = await open({
    directory: true,
    multiple: false,
    recursive: true,
    title: "Choose product image folder",
  });

  return typeof selected === "string" ? selected : null;
}

export async function readImageFilesFromDirectory(rootPath) {
  const modules = await getDesktopModules();
  const files = [];
  await readImageEntriesRecursively(rootPath, rootPath, modules, files);
  return files;
}

export async function pickExportDirectory() {
  const { open } = await getDesktopModules();
  const selected = await open({
    directory: true,
    multiple: false,
    recursive: true,
    title: "Choose export folder",
  });

  return typeof selected === "string" ? selected : null;
}

export async function exportBatchToDirectory({
  outputDir,
  products,
  settings,
  csvRows,
  manifest,
}) {
  const { mkdir, writeFile, writeTextFile, join } = await getDesktopModules();
  let imagesDir;

  try {
    imagesDir = await join(outputDir, "images");
    await mkdir(imagesDir, { recursive: true });
  } catch (error) {
    throw new Error(`Could not create images folder: ${describeError(error)}`);
  }

  try {
    await writeTextFile(await join(outputDir, "shopify-batch.csv"), toCSV(csvRows));
  } catch (error) {
    throw new Error(`Could not write shopify-batch.csv: ${describeError(error)}`);
  }

  try {
    await writeTextFile(
      await join(outputDir, "batch-manifest.json"),
      JSON.stringify(manifest, null, 2)
    );
  } catch (error) {
    throw new Error(`Could not write batch-manifest.json: ${describeError(error)}`);
  }

  for (const product of products) {
    for (const image of product.images) {
      if (!image.processedBlob) {
        continue;
      }

      try {
        const arrayBuffer = await image.processedBlob.arrayBuffer();
        await writeFile(
          await join(imagesDir, image.processedName),
          new Uint8Array(arrayBuffer)
        );
      } catch (error) {
        throw new Error(`Could not write image ${image.processedName}: ${describeError(error)}`);
      }
    }
  }
}

export async function showDesktopMessage(text, kind = "info", title = "Shopify Batch Processor") {
  const { message } = await getDesktopModules();
  await message(text, { title, kind });
}
