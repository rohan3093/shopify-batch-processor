function colorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt(
    Math.pow(r1 - r2, 2) +
      Math.pow(g1 - g2, 2) +
      Math.pow(b1 - b2, 2)
  );
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadImage(src) {
  return await new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () =>
      resolve({
        image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    image.onerror = reject;
    image.src = src;
  });
}

function detectContentBounds(
  img,
  whiteThreshold = 245,
  alphaThreshold = 8,
  padding = 8,
  backgroundTolerance = 22
) {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const samplePoints = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), height - 1],
    [0, Math.floor(height / 2)],
    [width - 1, Math.floor(height / 2)],
  ];

  let bgR = 0;
  let bgG = 0;
  let bgB = 0;

  samplePoints.forEach(([x, y]) => {
    const index = (y * width + x) * 4;
    bgR += data[index];
    bgG += data[index + 1];
    bgB += data[index + 2];
  });

  bgR /= samplePoints.length;
  bgG /= samplePoints.length;
  bgB /= samplePoints.length;

  const pixelLooksBackground = (r, g, b, a) => {
    const isVisible = a > alphaThreshold;
    const isWhiteish = r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold;
    const matchesEdgeBackground =
      colorDistance(r, g, b, bgR, bgG, bgB) <= backgroundTolerance;

    return !isVisible || isWhiteish || matchesEdgeBackground;
  };

  function findForegroundBand(length, crossLength, readPixel, requiredRatio = 0.015) {
    let start = 0;
    let end = length - 1;
    const requiredCount = Math.max(3, Math.floor(crossLength * requiredRatio));

    while (start < length) {
      let foregroundCount = 0;
      for (let cross = 0; cross < crossLength; cross += 1) {
        const [r, g, b, a] = readPixel(start, cross);
        if (!pixelLooksBackground(r, g, b, a)) {
          foregroundCount += 1;
        }
      }

      if (foregroundCount >= requiredCount) {
        break;
      }
      start += 1;
    }

    while (end >= start) {
      let foregroundCount = 0;
      for (let cross = 0; cross < crossLength; cross += 1) {
        const [r, g, b, a] = readPixel(end, cross);
        if (!pixelLooksBackground(r, g, b, a)) {
          foregroundCount += 1;
        }
      }

      if (foregroundCount >= requiredCount) {
        break;
      }
      end -= 1;
    }

    return { start, end };
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      if (!pixelLooksBackground(r, g, b, a)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return { x: 0, y: 0, width, height, found: false, bg: { r: bgR, g: bgG, b: bgB } };
  }

  const rowBand = findForegroundBand(
    height,
    width,
    (row, col) => {
      const index = (row * width + col) * 4;
      return [data[index], data[index + 1], data[index + 2], data[index + 3]];
    },
    0.012
  );
  const colBand = findForegroundBand(
    width,
    height,
    (col, row) => {
      const index = (row * width + col) * 4;
      return [data[index], data[index + 1], data[index + 2], data[index + 3]];
    },
    0.018
  );

  minX = Math.max(minX, colBand.start);
  maxX = Math.min(maxX, colBand.end);
  minY = Math.max(minY, rowBand.start);
  maxY = Math.min(maxY, rowBand.end);

  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const boundedWidth = Math.min(width - x, maxX - minX + 1 + padding * 2);
  const boundedHeight = Math.min(height - y, maxY - minY + 1 + padding * 2);

  return {
    x,
    y,
    width: boundedWidth,
    height: boundedHeight,
    found: true,
    bg: { r: bgR, g: bgG, b: bgB },
  };
}

export async function processProductImage(file, settings) {
  const src = await fileToDataUrl(file);
  const loaded = await loadImage(src);
  const crop = settings.trimWhitespace
    ? detectContentBounds(
        loaded.image,
        Number(settings.whiteThreshold),
        8,
        Number(settings.cropPadding),
        Number(settings.backgroundTolerance)
      )
    : {
        x: 0,
        y: 0,
        width: loaded.width,
        height: loaded.height,
        found: false,
        bg: { r: 255, g: 255, b: 255 },
      };

  const canvas = document.createElement("canvas");
  const size = Number(settings.imageSize);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = settings.background;
  ctx.fillRect(0, 0, size, size);

  const left = Number(settings.offsetLeft);
  const right = Number(settings.offsetRight);
  const top = Number(settings.offsetTop);
  const bottom = Number(settings.offsetBottom);
  const availableW = Math.max(1, size - left - right);
  const availableH = Math.max(1, size - top - bottom);
  const targetProductWidthRatio = Number(settings.targetProductWidthRatio || 0.74);
  const baselineLift = Number(settings.baselineLift || 0);

  const sourceW = crop.width;
  const sourceH = crop.height;
  const fitScale =
    settings.fit === "cover"
      ? Math.max(availableW / sourceW, availableH / sourceH)
      : Math.min(availableW / sourceW, availableH / sourceH);
  const widthScale = (size * targetProductWidthRatio) / Math.max(1, sourceW);
  const scale = Math.min(fitScale, widthScale);

  const drawW = sourceW * scale;
  const drawH = sourceH * scale;
  const dx = left + (availableW - drawW) / 2;
  const desiredBaselineY = size - bottom - baselineLift;
  const minDy = top;
  const maxDy = size - bottom - drawH;
  const dy = Math.max(minDy, Math.min(maxDy, desiredBaselineY - drawH));

  ctx.drawImage(
    loaded.image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    dx,
    dy,
    drawW,
    drawH
  );

  const preview = canvas.toDataURL("image/jpeg", 0.92);
  const blob = await new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/jpeg", 0.92);
  });

  return {
    blob,
    preview,
    sourcePreview: src,
    crop,
    originalDimensions: { width: loaded.width, height: loaded.height },
    placement: {
      drawW,
      drawH,
      dx,
      dy,
      baselineY: dy + drawH,
    },
  };
}

export function assessReviewStatus(crop, originalDimensions) {
  const cropWidth = Number(crop?.width || 0);
  const cropHeight = Number(crop?.height || 0);
  const bg = crop?.bg || { r: 255, g: 255, b: 255 };
  const bgDark = bg.r < 30 && bg.g < 30 && bg.b < 30;
  const fullFrameLike = originalDimensions
    ? cropWidth >= originalDimensions.width * 0.94 ||
      cropHeight >= originalDimensions.height * 0.94
    : false;

  if (!crop?.found || bgDark || fullFrameLike) {
    return {
      level: "review",
      label: "Needs Review",
      reason: !crop?.found
        ? "No clear product bounds found."
        : bgDark
          ? "Background detection appears unreliable."
          : "Crop still fills nearly the entire source image.",
    };
  }

  return {
    level: "ok",
    label: "Auto Approved",
    reason: "The crop and placement look usable.",
  };
}
