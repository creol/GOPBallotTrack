const sharp = require('sharp');
const jsQR = require('jsqr');

/**
 * Attempt to decode a QR code from a raw RGBA pixel buffer.
 * Returns the parsed JSON data or null.
 */
function decodeQR(rgbaBuffer, width, height) {
  const code = jsQR(new Uint8ClampedArray(rgbaBuffer), width, height);
  if (!code) return null;
  try {
    return { data: JSON.parse(code.data), location: code.location };
  } catch {
    return { data: code.data, location: code.location };
  }
}

/**
 * Calculate the rotation angle (degrees) from QR finder pattern positions.
 * The bottom-right finder pattern should be at the bottom-right of the ballot.
 * Uses the QR's three finder patterns to determine orientation.
 */
function calculateRotation(qrLocation) {
  // jsQR gives topLeftCorner, topRightCorner, bottomLeftCorner of the QR
  const tl = qrLocation.topLeftCorner;
  const tr = qrLocation.topRightCorner;

  // The angle of the top edge of the QR code
  const dx = tr.x - tl.x;
  const dy = tr.y - tl.y;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  // Round to nearest 90 degrees for clean rotation
  const nearest90 = Math.round(angle / 90) * 90;
  return nearest90;
}

/**
 * Try to decode QR from an image with specific preprocessing.
 */
async function tryDecodeWithPreprocess(imageBuffer, metadata, maxDim, preprocess) {
  let processImg = sharp(imageBuffer);
  let scale = 1;

  if (maxDim && (metadata.width > maxDim || metadata.height > maxDim)) {
    scale = maxDim / Math.max(metadata.width, metadata.height);
    processImg = processImg.resize(Math.round(metadata.width * scale), Math.round(metadata.height * scale));
  }

  // Apply preprocessing
  if (preprocess === 'sharpen') {
    processImg = processImg.sharpen({ sigma: 2 });
  } else if (preprocess === 'binarize') {
    // Convert to greyscale and threshold to pure black/white
    processImg = processImg.greyscale().threshold(128);
  } else if (preprocess === 'highcontrast') {
    // Increase contrast then sharpen
    processImg = processImg.greyscale().normalize().sharpen({ sigma: 3 });
  }

  const { data: rgbaBuffer, info } = await processImg
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const qrResult = decodeQR(rgbaBuffer, info.width, info.height);
  return qrResult ? { ...qrResult, scale } : null;
}

/**
 * Try to find a QR code in an image buffer.
 * Tries multiple scales and preprocessing methods.
 * Returns { qrData, rotation, width, height, scale } or null.
 */
async function findQRInImage(imageBuffer) {
  const metadata = await sharp(imageBuffer).metadata();
  console.log(`[OMR] Image dimensions: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

  // Try combinations of scale + preprocessing
  const sizes = [null, 2000, 1500, 1000, 800];
  const preprocessMethods = ['sharpen', 'binarize', 'highcontrast'];

  for (const preprocess of preprocessMethods) {
    for (const maxDim of sizes) {
      const label = `${preprocess}@${maxDim ? maxDim + 'px' : 'full'}`;
      try {
        const result = await tryDecodeWithPreprocess(imageBuffer, metadata, maxDim, preprocess);
        if (result && result.data) {
          // Verify we got real data, not empty string
          const hasData = typeof result.data === 'object'
            ? (result.data.sn || result.data.round_id)
            : (typeof result.data === 'string' && result.data.length > 0);
          if (hasData) {
            console.log(`[OMR] QR found with ${label}: ${JSON.stringify(result.data)}`);
            return {
              qrData: result.data,
              location: result.location,
              rotation: calculateRotation(result.location),
              width: metadata.width,
              height: metadata.height,
              scale: result.scale,
            };
          }
          console.log(`[OMR] QR finder patterns detected at ${label} but data empty/invalid`);
        }
      } catch (err) {
        // Skip errors silently for individual attempts
      }
    }
  }

  // Last resort: try cropping to just the bottom-right quadrant where QR should be
  console.log(`[OMR] Trying bottom-right quadrant crop...`);
  try {
    const cropW = Math.round(metadata.width / 2);
    const cropH = Math.round(metadata.height / 2);
    const croppedBuffer = await sharp(imageBuffer)
      .extract({ left: cropW, top: cropH, width: cropW, height: cropH })
      .greyscale()
      .normalize()
      .sharpen({ sigma: 2 })
      .toBuffer();

    const croppedMeta = await sharp(croppedBuffer).metadata();
    for (const maxDim of [null, 800, 500]) {
      const result = await tryDecodeWithPreprocess(croppedBuffer, croppedMeta, maxDim, 'binarize');
      if (result && result.data) {
        const hasData = typeof result.data === 'object'
          ? (result.data.sn || result.data.round_id)
          : (typeof result.data === 'string' && result.data.length > 0);
        if (hasData) {
          console.log(`[OMR] QR found in bottom-right crop: ${JSON.stringify(result.data)}`);
          // Adjust location back to full image coordinates
          if (result.location) {
            const adjustX = cropW / (result.scale || 1);
            const adjustY = cropH / (result.scale || 1);
            result.location.topLeftCorner.x += adjustX;
            result.location.topLeftCorner.y += adjustY;
            result.location.topRightCorner.x += adjustX;
            result.location.topRightCorner.y += adjustY;
            result.location.bottomLeftCorner.x += adjustX;
            result.location.bottomLeftCorner.y += adjustY;
          }
          return {
            qrData: result.data,
            location: result.location,
            rotation: calculateRotation(result.location),
            width: metadata.width,
            height: metadata.height,
            scale: result.scale,
          };
        }
      }
    }
  } catch (err) {
    console.log(`[OMR] Quadrant crop failed: ${err.message}`);
  }

  console.log(`[OMR] QR not found after all attempts`);
  return null;
}

/**
 * Rotate an image to upright based on detected rotation.
 * Returns a sharp buffer of the corrected image.
 */
async function rotateToUpright(imageBuffer, rotationDeg) {
  if (rotationDeg === 0) return imageBuffer;
  // sharp.rotate uses clockwise degrees; we need to counter-rotate
  const correction = (360 - rotationDeg) % 360;
  if (correction === 0) return imageBuffer;
  return sharp(imageBuffer).rotate(correction).toBuffer();
}

/**
 * Analyze fill ratio of an oval region in a grayscale image.
 * cropX/cropY/cropW/cropH are in actual image pixels.
 * Returns a fill ratio 0.0-1.0 (ratio of dark pixels in the oval zone).
 */
async function analyzeOvalFill(imageBuffer, cropX, cropY, cropW, cropH, imgWidth, imgHeight) {
  // Clamp to image bounds
  cropX = Math.max(0, Math.round(cropX));
  cropY = Math.max(0, Math.round(cropY));
  cropW = Math.round(cropW);
  cropH = Math.round(cropH);

  if (cropX + cropW > imgWidth) cropW = imgWidth - cropX;
  if (cropY + cropH > imgHeight) cropH = imgHeight - cropY;
  if (cropW <= 2 || cropH <= 2) return 0;

  try {
    const { data: pixels, info } = await sharp(imageBuffer)
      .greyscale()
      .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rx = info.width / 2;
    const ry = info.height / 2;
    let darkCount = 0;
    let totalInOval = 0;

    for (let py = 0; py < info.height; py++) {
      for (let px = 0; px < info.width; px++) {
        const relX = (px - rx) / rx;
        const relY = (py - ry) / ry;
        if (relX * relX + relY * relY <= 1) {
          totalInOval++;
          if (pixels[py * info.width + px] < 128) {
            darkCount++;
          }
        }
      }
    }

    return totalInOval > 0 ? darkCount / totalInOval : 0;
  } catch (err) {
    console.log(`[OMR] Oval crop error at (${cropX},${cropY} ${cropW}x${cropH}): ${err.message}`);
    return 0;
  }
}

/**
 * Full OMR pipeline: QR detection, rotation, oval analysis.
 * Uses the QR code position as anchor — oval positions are calculated
 * relative to QR using x_offset_from_qr / y_offset_from_qr from the spec.
 * This works regardless of whether the scan is a full page or a cut ballot.
 */
async function processScannedBallot(imageBuffer, ballotSpec) {
  // 1. Find QR code
  const qrResult = await findQRInImage(imageBuffer);
  if (!qrResult) {
    return {
      serial_number: null,
      race_id: null,
      round_id: null,
      rotation_applied: 0,
      candidates: [],
      detected_vote: null,
      confidence: 0,
      flag_reason: 'qr_not_found',
    };
  }

  const { sn: serialNumber, race_id, round_id } = typeof qrResult.qrData === 'object'
    ? qrResult.qrData
    : { sn: null, race_id: null, round_id: null };

  // 2. Rotate to upright
  const rotation = qrResult.rotation;
  const uprightBuffer = await rotateToUpright(imageBuffer, rotation);

  // 3. Re-find QR in upright image to get accurate pixel position
  const uprightQR = await findQRInImage(uprightBuffer);
  const uprightMeta = await sharp(uprightBuffer).metadata();

  // 4. Calculate scale factor: spec is in 300 DPI pixels, need to map to actual image pixels
  // Use the QR code size as the reference: compare spec QR size to detected QR size in image
  let scaleFromSpec = 1;
  if (uprightQR && uprightQR.location && ballotSpec.qr_code) {
    // Detected QR size in image pixels (accounting for any resize during detection)
    const detectedScale = uprightQR.scale || 1;
    const qrTopLeft = uprightQR.location.topLeftCorner;
    const qrTopRight = uprightQR.location.topRightCorner;
    const qrBottomLeft = uprightQR.location.bottomLeftCorner;
    const detectedQRWidth = Math.sqrt(
      Math.pow((qrTopRight.x - qrTopLeft.x) / detectedScale, 2) +
      Math.pow((qrTopRight.y - qrTopLeft.y) / detectedScale, 2)
    );
    const specQRWidth = ballotSpec.qr_code.width; // in 300 DPI pixels
    if (specQRWidth > 0 && detectedQRWidth > 0) {
      scaleFromSpec = detectedQRWidth / specQRWidth;
    }
    console.log(`[OMR] QR size — spec: ${specQRWidth}px @300dpi, detected: ${Math.round(detectedQRWidth)}px in image, scale: ${scaleFromSpec.toFixed(3)}`);
  }

  // 5. Get QR anchor position in the upright image
  let qrAnchorX = 0, qrAnchorY = 0;
  if (uprightQR && uprightQR.location) {
    const s = uprightQR.scale || 1;
    // Use the center of the QR as anchor (more stable than corner)
    const tl = uprightQR.location.topLeftCorner;
    const tr = uprightQR.location.topRightCorner;
    const bl = uprightQR.location.bottomLeftCorner;
    qrAnchorX = ((tl.x + tr.x + bl.x) / 3) / s;
    qrAnchorY = ((tl.y + tr.y + bl.y) / 3) / s;
    console.log(`[OMR] QR anchor in image: (${Math.round(qrAnchorX)}, ${Math.round(qrAnchorY)}) in ${uprightMeta.width}x${uprightMeta.height} image`);
  }

  // 6. Analyze each candidate oval using QR-relative offsets
  const markedThreshold = ballotSpec.omr_thresholds?.marked ?? 0.25;
  const unmarkedThreshold = ballotSpec.omr_thresholds?.unmarked ?? 0.16;
  console.log(`[OMR] Thresholds — marked: >${markedThreshold}, unmarked: <${unmarkedThreshold}`);

  const candidateResults = [];
  for (const candidate of ballotSpec.candidates) {
    // x_offset_from_qr and y_offset_from_qr are in 300 DPI pixels
    // Scale them to actual image pixels and add to QR anchor
    const ovalCenterX = qrAnchorX + (candidate.oval.x_offset_from_qr * scaleFromSpec);
    const ovalCenterY = qrAnchorY + (candidate.oval.y_offset_from_qr * scaleFromSpec);
    const ovalFullW = candidate.oval.width * scaleFromSpec;
    const ovalFullH = candidate.oval.height * scaleFromSpec;

    // Shrink crop to inner 65% to exclude the printed oval outline
    // and any adjacent candidate name text bleeding into the zone
    const shrink = 0.65;
    const ovalW = ovalFullW * shrink;
    const ovalH = ovalFullH * shrink;

    const cropX = ovalCenterX - ovalW / 2;
    const cropY = ovalCenterY - ovalH / 2;

    console.log(`[OMR] Oval "${candidate.name}": center=(${Math.round(ovalCenterX)},${Math.round(ovalCenterY)}), crop=${Math.round(ovalW)}x${Math.round(ovalH)} (inner ${shrink * 100}% of ${Math.round(ovalFullW)}x${Math.round(ovalFullH)})`);

    const fillRatio = await analyzeOvalFill(uprightBuffer, cropX, cropY, ovalW, ovalH, uprightMeta.width, uprightMeta.height);

    const isMarked = fillRatio > markedThreshold;
    const isUnmarked = fillRatio < unmarkedThreshold;

    candidateResults.push({
      candidate_id: candidate.candidate_id,
      name: candidate.name,
      fill_ratio: Math.round(fillRatio * 10000) / 10000,
      is_marked: isMarked,
      is_uncertain: !isMarked && !isUnmarked,
    });
  }

  // 6. Determine vote
  const markedCandidates = candidateResults.filter(c => c.is_marked);
  const uncertainCandidates = candidateResults.filter(c => c.is_uncertain);

  let detectedVote = null;
  let confidence = 0;
  let flagReason = null;

  if (markedCandidates.length === 1) {
    detectedVote = markedCandidates[0].candidate_id;
    confidence = markedCandidates[0].fill_ratio;
  } else if (markedCandidates.length === 0 && uncertainCandidates.length === 0) {
    flagReason = 'no_mark';
  } else if (markedCandidates.length > 1) {
    flagReason = 'overvote';
  } else {
    flagReason = 'uncertain';
    if (uncertainCandidates.length === 1) {
      confidence = uncertainCandidates[0].fill_ratio;
    }
  }

  return {
    serial_number: serialNumber,
    race_id,
    round_id,
    rotation_applied: rotation,
    candidates: candidateResults,
    detected_vote: detectedVote,
    confidence,
    flag_reason: flagReason,
  };
}

module.exports = { findQRInImage, processScannedBallot, rotateToUpright, analyzeOvalFill };
