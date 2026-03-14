import { useEffect, useMemo, useRef, useState } from "react";
import { csvHeaders, defaultSettings } from "./data/defaults";
import { getDesktopShellInfo, isTauriDesktop } from "./lib/desktop";
import { downloadBlob, toCSV } from "./lib/csv";
import { assessReviewStatus, processProductImage } from "./lib/imageProcessing";
import {
  exportBatchToDirectory,
  pickExportDirectory,
  pickInputDirectory,
  readImageFilesFromDirectory,
  showDesktopMessage,
} from "./lib/nativeFiles";
import {
  createEmptyProduct,
  groupKeyFromFile,
  parseTitleFromFilename,
  slugify,
} from "./lib/productGrouping";

function formatStat(value) {
  return Intl.NumberFormat("en-US").format(value);
}

function buildReviewReason(product) {
  if (!product.images.length) return "No images imported yet.";
  if (!product.sku) return "Missing SKU.";
  if (!product.price) return "Missing price.";
  if (!product.images.some((image) => image.isPrimary)) return "Pick a main image.";
  if (product.images.some((image) => image.review.level === "review")) {
    return "One or more images need review.";
  }
  if (product.images.length < 2) return "Only one image attached.";
  return "Ready to export.";
}

function getProductStage(product) {
  if (!product.sku || !product.price) return "Needs data";
  if (!product.images.some((image) => image.isPrimary)) return "Pick main image";
  if (product.images.some((image) => image.review.level === "review")) return "Check images";
  if (product.images.length < 2) return "Add more images";
  return "Ready";
}

function normalizeImageFilename(value) {
  const trimmed = String(value || "").trim();
  const withoutExtension = trimmed.replace(/\.[^.]+$/, "");
  const normalized = slugify(withoutExtension) || "product-image";
  return `${normalized}.jpg`;
}

function createImageRecord(file, processed, groupKey, isPrimary = false, productTitle = "") {
  const review = assessReviewStatus(processed.crop, processed.originalDimensions);
  const title = parseTitleFromFilename(file.name);
  const altText = productTitle || title;
  return {
    id: `${groupKey}-${file.name}-${crypto.randomUUID()}`,
    file,
    title,
    altText,
    processedName: `${slugify(title) || "product-image"}.jpg`,
    preview: processed.preview,
    sourcePreview: processed.sourcePreview,
    processedBlob: processed.blob,
    crop: processed.crop,
    review,
    originalDimensions: processed.originalDimensions,
    placement: processed.placement,
    role: isPrimary ? "primary" : "gallery",
    isPrimary,
  };
}

function createCsvRows(products, settings) {
  const rows = [csvHeaders];

  products.forEach((product) => {
    if (!product.images.length) {
      rows.push([
        product.handle,
        product.title,
        settings.bodyHtml,
        product.vendor || settings.vendor,
        settings.category,
        product.productType || settings.productType,
        product.tags || settings.tags,
        product.published || settings.published,
        settings.optionName,
        settings.optionValue,
        product.sku,
        settings.grams,
        settings.inventoryTracker,
        product.inventoryQty,
        settings.inventoryPolicy,
        settings.fulfillmentService,
        product.price,
        product.compareAtPrice,
        "",
        "",
        "",
        product.status || settings.status,
      ]);
      return;
    }

    product.images.forEach((image, index) => {
      const isFirstRow = index === 0;
      rows.push([
        product.handle,
        isFirstRow ? product.title : "",
        isFirstRow ? settings.bodyHtml : "",
        isFirstRow ? (product.vendor || settings.vendor) : "",
        isFirstRow ? settings.category : "",
        isFirstRow ? (product.productType || settings.productType) : "",
        isFirstRow ? (product.tags || settings.tags) : "",
        isFirstRow ? (product.published || settings.published) : "",
        isFirstRow ? settings.optionName : "",
        isFirstRow ? settings.optionValue : "",
        isFirstRow ? product.sku : "",
        isFirstRow ? settings.grams : "",
        isFirstRow ? settings.inventoryTracker : "",
        isFirstRow ? product.inventoryQty : "",
        isFirstRow ? settings.inventoryPolicy : "",
        isFirstRow ? settings.fulfillmentService : "",
        isFirstRow ? product.price : "",
        isFirstRow ? product.compareAtPrice : "",
        `images/${image.processedName}`,
        index + 1,
        image.altText,
        isFirstRow ? (product.status || settings.status) : "",
      ]);
    });
  });

  return rows;
}

function createManifest(products, settings, stats) {
  return {
    generatedAt: new Date().toISOString(),
    summary: stats,
    settings,
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      sku: product.sku,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      vendor: product.vendor,
      productType: product.productType,
      tags: product.tags,
      inventoryQty: product.inventoryQty,
      published: product.published,
      status: product.status,
      reviewState: product.reviewState,
      notes: product.notes,
      images: product.images.map((image) => ({
        title: image.title,
        altText: image.altText,
        processedName: image.processedName,
        role: image.role,
        isPrimary: image.isPrimary,
        review: image.review,
      })),
    })),
  };
}

export default function App() {
  const fileInputRef = useRef(null);
  const [settings] = useState(defaultSettings);
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [fileImportMode, setFileImportMode] = useState("batch");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, current: "" });
  const [desktopInfo, setDesktopInfo] = useState({
    platform: "browser",
    shell: "web-preview",
    storageMode: "downloads",
  });
  const [lastInputFolder, setLastInputFolder] = useState("");
  const [lastExportFolder, setLastExportFolder] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  const selectedProduct =
    products.find((product) => product.id === selectedProductId) || products[0] || null;
  const primaryImage = selectedProduct?.images.find((image) => image.isPrimary) || null;

  const stats = useMemo(() => {
    const productCount = products.length;
    const imageCount = products.reduce((sum, product) => sum + product.images.length, 0);
    const readyCount = products.filter((product) => getProductStage(product) === "Ready").length;
    const actionCount = productCount - readyCount;

    return { productCount, imageCount, readyCount, actionCount };
  }, [products]);

  const csvRows = useMemo(() => createCsvRows(products, settings), [products, settings]);
  const manifest = useMemo(
    () => createManifest(products, settings, stats),
    [products, settings, stats]
  );

  function createManualProduct() {
    const timestamp = Date.now();
    const id = `manual-product-${timestamp}`;
    const product = {
      id,
      groupKey: id,
      title: "New Product",
      handle: `new-product-${timestamp}`,
      sku: "",
      price: "",
      compareAtPrice: "",
      vendor: settings.vendor,
      productType: settings.productType,
      tags: settings.tags,
      inventoryQty: "1",
      published: settings.published,
      status: settings.status,
      reviewState: "pending",
      notes: "Add product info and attach images.",
      images: [],
    };

    setProducts((current) => [product, ...current]);
    setSelectedProductId(id);
    setStatusMessage("New product created.");
  }

  useEffect(() => {
    let cancelled = false;

    getDesktopShellInfo()
      .then((info) => {
        if (!cancelled) {
          setDesktopInfo(info);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopInfo({
            platform: "browser",
            shell: "web-preview",
            storageMode: "downloads",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFiles(fileList) {
    if (fileImportMode === "selected" && selectedProductId) {
      await attachFilesToProduct(selectedProductId, fileList);
      return;
    }

    const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;

    setStatusMessage("");
    setIsProcessing(true);
    setProgress({ completed: 0, total: files.length, current: "" });

    try {
      const grouped = new Map(products.map((product) => [product.groupKey, product]));

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setProgress({ completed: index, total: files.length, current: file.name });

        const groupKey = groupKeyFromFile(file);
        const processed = await processProductImage(file, settings);
        const existing = grouped.get(groupKey) || createEmptyProduct(groupKey, file);
        const isPrimary = existing.images.length === 0;
        const imageRecord = createImageRecord(file, processed, groupKey, isPrimary, existing.title);

        grouped.set(groupKey, {
          ...existing,
          title: existing.title || parseTitleFromFilename(file.name),
          handle: existing.handle || slugify(existing.title),
          reviewState: "pending",
          images: [...existing.images, imageRecord],
        });
      }

      const nextProducts = Array.from(grouped.values()).map((product) => ({
        ...product,
        notes: buildReviewReason(product),
      }));

      setProducts(nextProducts);
      setSelectedProductId((current) => current || nextProducts[0]?.id || "");
      setStatusMessage(`Imported ${files.length} images into ${nextProducts.length} products.`);
    } finally {
      setIsProcessing(false);
      setProgress({ completed: files.length, total: files.length, current: "" });
    }
  }

  async function attachFilesToProduct(productId, incomingFiles) {
    const files = Array.from(incomingFiles || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length || !productId) return;

    setStatusMessage("");
    setIsProcessing(true);
    setProgress({ completed: 0, total: files.length, current: "" });

    try {
      const existingProduct = products.find((product) => product.id === productId);
      if (!existingProduct) return;

      const nextImages = [...existingProduct.images];

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setProgress({ completed: index, total: files.length, current: file.name });
        const processed = await processProductImage(file, settings);
        nextImages.push(
          createImageRecord(file, processed, existingProduct.groupKey, nextImages.length === 0, existingProduct.title)
        );
      }

      setProducts((current) =>
        current.map((product) =>
          product.id === productId
            ? {
                ...product,
                images: nextImages,
                notes: buildReviewReason({ ...product, images: nextImages }),
              }
            : product
        )
      );
      setStatusMessage(`Added ${files.length} images to ${existingProduct.title}.`);
    } finally {
      setIsProcessing(false);
      setProgress({ completed: files.length, total: files.length, current: "" });
    }
  }

  async function handleNativeFolderImport() {
    try {
      const inputFolder = await pickInputDirectory();
      if (!inputFolder) return;

      setLastInputFolder(inputFolder);
      setStatusMessage("Reading images from the selected folder...");
      const files = await readImageFilesFromDirectory(inputFolder);
      await handleFiles(files);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not import the selected folder."
      );
    }
  }

  function openFilePicker(mode) {
    setFileImportMode(mode);
    fileInputRef.current?.click();
  }

  function updateProduct(productId, key, value) {
    setProducts((current) =>
      current.map((product) =>
        product.id === productId
          ? {
              ...product,
              [key]: value,
              handle: key === "title" ? slugify(value) : product.handle,
              notes: buildReviewReason({ ...product, [key]: value }),
            }
          : product
      )
    );
  }

  function updateImage(productId, imageId, key, value) {
    setProducts((current) =>
      current.map((product) => {
        if (product.id !== productId) return product;

        const images =
          key === "role" && value === "primary"
            ? product.images.map((image) => ({
                ...image,
                role: image.id === imageId ? "primary" : image.role === "primary" ? "gallery" : image.role,
                isPrimary: image.id === imageId,
              }))
            : product.images.map((image) =>
                image.id === imageId
                  ? {
                      ...image,
                      [key]: key === "processedName" ? normalizeImageFilename(value) : value,
                      ...(key === "role" && value !== "primary" && image.isPrimary
                        ? { isPrimary: false }
                        : {}),
                    }
                  : image
              );

        return {
          ...product,
          images,
          notes: buildReviewReason({ ...product, images }),
        };
      })
    );
  }

  function setPrimaryImage(productId, imageId) {
    setProducts((current) =>
      current.map((product) => {
        if (product.id !== productId) return product;

        const images = product.images.map((image) => ({
          ...image,
          isPrimary: image.id === imageId,
          role: image.id === imageId ? "primary" : image.role === "primary" ? "gallery" : image.role,
        }));

        return {
          ...product,
          images,
          notes: buildReviewReason({ ...product, images }),
        };
      })
    );
  }

  function exportCsv() {
    try {
      const csv = toCSV(csvRows);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "shopify-batch.csv");
      setStatusMessage(`Exported shopify-batch.csv with ${csvRows.length - 1} rows.`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not export CSV."
      );
    }
  }

  function exportManifest() {
    try {
      downloadBlob(
        new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
        "batch-manifest.json"
      );
      setStatusMessage("Exported batch-manifest.json.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not export manifest."
      );
    }
  }

  async function exportToDesktopFolder() {
    try {
      setStatusMessage("Choose an export folder...");
      const outputDir = await pickExportDirectory();
      if (!outputDir) {
        setStatusMessage("Export cancelled.");
        if (isTauriDesktop()) {
          await showDesktopMessage("Export was cancelled before a folder was chosen.", "info");
        }
        return;
      }

      setLastExportFolder(outputDir);
      setStatusMessage("Writing batch output to the selected folder...");
      await exportBatchToDirectory({ outputDir, products, settings, csvRows, manifest });
      setStatusMessage(`Export complete: ${outputDir}`);
      if (isTauriDesktop()) {
        await showDesktopMessage(
          `Export complete.\n\nFolder: ${outputDir}\nFiles: shopify-batch.csv, batch-manifest.json, images/`,
          "info",
          "Export Complete"
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not export the selected batch.";
      setStatusMessage(message);
      if (isTauriDesktop()) {
        await showDesktopMessage(message, "error", "Export Failed");
      }
    }
  }

  const stageColor = (stage) => {
    if (stage === "Ready") return "stage-ready";
    if (stage === "Needs data" || stage === "Pick main image") return "stage-warn";
    return "stage-info";
  };

  return (
    <div className="workspace-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-icon">S</div>
          <div>
            <h1>Shopify Batch Processor</h1>
            <p className="subtitle">Prepare, review, and export product batches</p>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={createManualProduct}>
            + New Product
          </button>
          <button
            className="btn btn-secondary"
            onClick={() =>
              isTauriDesktop() ? handleNativeFolderImport() : openFilePicker("batch")
            }
          >
            Batch Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={(event) => handleFiles(event.target.files)}
            style={{ display: "none" }}
          />
          {isTauriDesktop() ? (
            <button
              className="btn btn-accent"
              onClick={exportToDesktopFolder}
              disabled={!products.length}
            >
              Export Batch
            </button>
          ) : (
            <button
              className="btn btn-accent"
              onClick={exportCsv}
              disabled={!products.length}
            >
              Export CSV
            </button>
          )}
        </div>
      </header>

      {statusMessage && (
        <div className="status-toast">
          <span>{statusMessage}</span>
          <button className="toast-dismiss" onClick={() => setStatusMessage("")} type="button">
            &times;
          </button>
        </div>
      )}

      <section className="summary-row">
        <article className="summary-card">
          <span className="summary-label">Products</span>
          <strong className="summary-value">{formatStat(stats.productCount)}</strong>
        </article>
        <article className="summary-card">
          <span className="summary-label">Images</span>
          <strong className="summary-value">{formatStat(stats.imageCount)}</strong>
        </article>
        <article className="summary-card accent">
          <span className="summary-label">Ready</span>
          <strong className="summary-value">{formatStat(stats.readyCount)}</strong>
        </article>
        <article className="summary-card warn">
          <span className="summary-label">Need attention</span>
          <strong className="summary-value">{formatStat(stats.actionCount)}</strong>
        </article>
      </section>

      {isProcessing && (
        <section className="card progress-card">
          <div className="progress-row">
            <div>
              <h3>Processing batch</h3>
              <p className="text-muted">{progress.current || "Preparing files..."}</p>
            </div>
            <strong className="progress-count">
              {progress.completed}/{progress.total}
            </strong>
          </div>
          <div className="progress-bar">
            <span
              className="progress-fill"
              style={{
                width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </section>
      )}

      <section className="main-grid">
        <aside className="card sidebar">
          <div className="sidebar-header">
            <h3>Products</h3>
            <span className="product-count-badge">{products.length}</span>
          </div>
          <p className="text-muted text-sm">
            {lastInputFolder
              ? `Source: ${lastInputFolder}`
              : "Create a product or batch import a folder."}
          </p>

          <div className="product-list">
            {products.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">+</div>
                <strong>No products yet</strong>
                <span>Create a new product or batch import a folder of images.</span>
              </div>
            ) : (
              products.map((product) => {
                const stage = getProductStage(product);
                return (
                  <button
                    key={product.id}
                    className={`product-row${selectedProduct?.id === product.id ? " active" : ""}`}
                    onClick={() => setSelectedProductId(product.id)}
                  >
                    <div className="product-row-top">
                      <strong>{product.title}</strong>
                      <span className={`stage-dot ${stageColor(stage)}`} />
                    </div>
                    <div className="product-row-meta">
                      <span>{product.images.length} images</span>
                      <span className="product-stage-text">{stage}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="card editor-panel">
          {selectedProduct ? (
            <>
              {/* ── 1. Identity ── */}
              <div className="editor-identity">
                <div className="identity-main">
                  <input
                    className="title-input"
                    value={selectedProduct.title}
                    onChange={(event) =>
                      updateProduct(selectedProduct.id, "title", event.target.value)
                    }
                    placeholder="Product title"
                  />
                  <span className="text-muted text-sm">
                    Handle: {selectedProduct.handle}
                  </span>
                </div>
                <span className={`stage-pill ${stageColor(getProductStage(selectedProduct))}`}>
                  {getProductStage(selectedProduct)}
                </span>
              </div>

              {/* ── 2. Key fields ── */}
              <div className="key-fields">
                <label className="form-field">
                  <span>SKU</span>
                  <input
                    value={selectedProduct.sku}
                    onChange={(event) =>
                      updateProduct(selectedProduct.id, "sku", event.target.value)
                    }
                    placeholder="e.g. SKU-001"
                  />
                </label>
                <label className="form-field">
                  <span>Price</span>
                  <input
                    value={selectedProduct.price}
                    onChange={(event) =>
                      updateProduct(selectedProduct.id, "price", event.target.value)
                    }
                    placeholder="0.00"
                  />
                </label>
                <label className="form-field">
                  <span>Compare-at price</span>
                  <input
                    value={selectedProduct.compareAtPrice}
                    onChange={(event) =>
                      updateProduct(selectedProduct.id, "compareAtPrice", event.target.value)
                    }
                    placeholder="0.00"
                  />
                </label>
              </div>

              {/* ── 3. Images ── */}
              <section className="images-zone">
                {selectedProduct.images.length === 0 ? (
                  <div className="images-empty-cta">
                    <div className="cta-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="m21 15-5-5L5 21" />
                      </svg>
                    </div>
                    <strong>Add product images</strong>
                    <span className="text-muted">
                      The first image you add becomes the main product photo.
                    </span>
                    <button
                      className="btn btn-primary"
                      onClick={() => openFilePicker("selected")}
                      type="button"
                    >
                      Choose Images
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="images-layout">
                      <div className="main-image-col">
                        {primaryImage ? (
                          <div className="main-image-stage">
                            <img src={primaryImage.preview} alt={primaryImage.altText} />
                            <span className="primary-badge">Main</span>
                          </div>
                        ) : (
                          <div className="main-image-stage main-image-empty">
                            <span className="text-muted">Select a main image</span>
                          </div>
                        )}
                      </div>
                      <div className="gallery-col">
                        <div className="gallery-header">
                          <span className="text-muted text-sm">
                            {selectedProduct.images.length} image{selectedProduct.images.length !== 1 ? "s" : ""}
                          </span>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => openFilePicker("selected")}
                            type="button"
                          >
                            + Add
                          </button>
                        </div>
                        <div className="gallery-thumbs">
                          {selectedProduct.images.map((image) => (
                            <button
                              key={image.id}
                              className={`gallery-thumb${image.isPrimary ? " is-primary" : ""}`}
                              onClick={() => setPrimaryImage(selectedProduct.id, image.id)}
                              type="button"
                              title={image.isPrimary ? "Main image" : "Click to set as main"}
                            >
                              <img src={image.preview} alt={image.altText} />
                              {image.isPrimary && <span className="thumb-badge">Main</span>}
                              {image.review.level === "review" && (
                                <span className="thumb-warn" title={image.review.reason}>!</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="image-details-list">
                      {selectedProduct.images.map((image, idx) => (
                        <div key={image.id} className="image-detail-row">
                          <span className="image-detail-index">{idx + 1}</span>
                          <strong className="image-detail-title">{image.title}</strong>
                          <select
                            className="image-detail-role"
                            value={image.role}
                            onChange={(event) =>
                              updateImage(selectedProduct.id, image.id, "role", event.target.value)
                            }
                          >
                            <option value="primary">Primary</option>
                            <option value="gallery">Gallery</option>
                            <option value="detail">Detail</option>
                            <option value="angle">Angle</option>
                          </select>
                          <input
                            className="image-detail-alt"
                            value={image.altText}
                            onChange={(event) =>
                              updateImage(selectedProduct.id, image.id, "altText", event.target.value)
                            }
                            placeholder="Alt text"
                          />
                          <input
                            className="image-detail-filename"
                            value={image.processedName}
                            onChange={(event) =>
                              updateImage(selectedProduct.id, image.id, "processedName", event.target.value)
                            }
                            placeholder="filename.jpg"
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              {/* ── 4. More Details (collapsible) ── */}
              <section className="more-details">
                <button
                  className="more-details-toggle"
                  onClick={() => setShowMoreDetails((v) => !v)}
                  type="button"
                >
                  <span>More Details</span>
                  <span className="toggle-arrow">{showMoreDetails ? "\u25B2" : "\u25BC"}</span>
                </button>
                {showMoreDetails && (
                  <div className="more-details-grid">
                    <label className="form-field">
                      <span>Handle</span>
                      <input
                        value={selectedProduct.handle}
                        onChange={(event) =>
                          updateProduct(selectedProduct.id, "handle", event.target.value)
                        }
                      />
                    </label>
                    <label className="form-field">
                      <span>Vendor</span>
                      <input
                        value={selectedProduct.vendor || ""}
                        onChange={(event) =>
                          updateProduct(selectedProduct.id, "vendor", event.target.value)
                        }
                      />
                    </label>
                    <label className="form-field">
                      <span>Product type</span>
                      <input
                        value={selectedProduct.productType || ""}
                        onChange={(event) =>
                          updateProduct(selectedProduct.id, "productType", event.target.value)
                        }
                      />
                    </label>
                    <label className="form-field">
                      <span>Tags</span>
                      <input
                        value={selectedProduct.tags || ""}
                        onChange={(event) =>
                          updateProduct(selectedProduct.id, "tags", event.target.value)
                        }
                      />
                    </label>
                    <label className="form-field">
                      <span>Inventory qty</span>
                      <input
                        value={selectedProduct.inventoryQty}
                        onChange={(event) =>
                          updateProduct(selectedProduct.id, "inventoryQty", event.target.value)
                        }
                      />
                    </label>
                    <label className="form-field">
                      <span>Status</span>
                      <select
                        value={selectedProduct.status || "draft"}
                        onChange={(event) =>
                          updateProduct(selectedProduct.id, "status", event.target.value)
                        }
                      >
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                      </select>
                    </label>
                    <label className="form-field">
                      <span>Published</span>
                      <select
                        value={selectedProduct.published || "FALSE"}
                        onChange={(event) =>
                          updateProduct(selectedProduct.id, "published", event.target.value)
                        }
                      >
                        <option value="FALSE">FALSE</option>
                        <option value="TRUE">TRUE</option>
                      </select>
                    </label>
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="empty-state large">
              <div className="empty-icon large-icon">S</div>
              <strong>No product selected</strong>
              <span>Create a new product or import a batch to get started.</span>
            </div>
          )}
        </main>
      </section>

    </div>
  );
}
