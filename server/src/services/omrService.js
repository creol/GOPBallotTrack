const sharp = require('sharp');
const jsQR = require('jsqr');

/**
 * Attempt to decode a QR code from a raw RGBA pixel buffer.
 * Returns { data: string, location } or null.
 * QR encodes only the serial number as a plain string.
 */
function decodeQR(rgbaBuffer, width, height) {
  const code = jsQR(new Uint8ClampedArray(rgbaBuffer), width, height);
  if (!code || !code.data) return null;
  // Return raw string — no JSON parsing needed
  return { data: code.data.trim(), location: code.location };
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

  // Try QR decode — fastest methods first
  // Step 1: Try raw decode at small size (fastest, works for clean scans)
  try {
    const smallSize = 600;
    const scale = smallSize / Math.max(metadata.width, metadata.height);
    const { data: rgbaBuffer, info } = await sharp(imageBuffer)
      .resize(Math.round(metadata.width * scale), Math.round(metadata.height * scale))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const qr = decodeQR(rgbaBuffer, info.width, info.height);
    if (qr && qr.data && qr.data.length >= 8) {
      console.log(`[OMR] QR found with raw@600px: ${JSON.stringify(qr.data)}`);
      return { qrData: qr.data, location: qr.location, rotation: calculateRotation(qr.location), width: metadata.width, height: metadata.height, scale };
    }
  } catch {}

  // Step 2: Try with sharpening at progressively larger sizes
  const fastAttempts = [
    { preprocess: 'sharpen', maxDim: 800 },
    { preprocess: 'sharpen', maxDim: 1000 },
  ];
  const slowAttempts = [
    { preprocess: 'sharpen', maxDim: 1500 },
    { preprocess: 'binarize', maxDim: 800 },
    { preprocess: 'highcontrast', maxDim: 800 },
  ];

  for (const { preprocess, maxDim } of [...fastAttempts, ...slowAttempts]) {
    const label = `${preprocess}@${maxDim ? maxDim + 'px' : 'full'}`;
    try {
      const result = await tryDecodeWithPreprocess(imageBuffer, metadata, maxDim, preprocess);
      if (result && result.data) {
        const hasData = typeof result.data === 'string' && result.data.length >= 8;
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
      }
    } catch {
      // Skip errors silently
    }
  }

  // Last resort: try cropping to just the bottom-right quadrant where QR should be
  // Skip if image is already small (e.g. already a quadrant crop)
  if (metadata.width < 800 || metadata.height < 800) {
    console.log(`[OMR] QR not found after all attempts (image too small for quadrant crop)`);
    return null;
  }
  console.log(`[OMR] Trying bottom-right quadrant crop...`);
  try {
    const cropLeft = Math.round(metadata.width / 2);
    const cropTop = Math.round(metadata.height / 2);
    const cropW = metadata.width - cropLeft;
    const cropH = metadata.height - cropTop;
    const croppedBuffer = await sharp(imageBuffer)
      .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
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
            const adjustX = cropLeft / (result.scale || 1);
            const adjustY = cropTop / (result.scale || 1);
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

    // Adaptive threshold: compute mean pixel value, then use mean * 0.65
    let pixelSum = 0;
    let pixelCount = 0;
    for (let py = 0; py < info.height; py++) {
      for (let px = 0; px < info.width; px++) {
        const relX = (px - rx) / rx;
        const relY = (py - ry) / ry;
        if (relX * relX + relY * relY <= 1) {
          pixelSum += pixels[py * info.width + px];
          pixelCount++;
        }
      }
    }
    const meanPixel = pixelCount > 0 ? pixelSum / pixelCount : 128;
    const darkThreshold = Math.max(100, Math.min(200, Math.round(meanPixel * 0.80)));

    let darkCount = 0;
    let totalInOval = 0;

    for (let py = 0; py < info.height; py++) {
      for (let px = 0; px < info.width; px++) {
        const relX = (px - rx) / rx;
        const relY = (py - ry) / ry;
        if (relX * relX + relY * relY <= 1) {
          totalInOval++;
          if (pixels[py * info.width + px] < darkThreshold) {
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
async function processScannedBallot(imageBuffer, ballotSpec, preDecodedQR) {
  // 1. Use pre-decoded QR if available, otherwise find it
  const qrResult = preDecodedQR || await findQRInImage(imageBuffer);
  if (!qrResult) {
    return {
      serial_number: null,
      rotation_applied: 0,
      candidates: [],
      detected_vote: null,
      confidence: 0,
      flag_reason: 'qr_not_found',
    };
  }

  const serialNumber = typeof qrResult.qrData === 'string' ? qrResult.qrData : null;

  // 2. Use the image as-is (scanner middleware already rotates correctly)
  const finalBuffer = imageBuffer;
  const uprightQR = qrResult;
  const uprightMeta = await sharp(imageBuffer).metadata();

  // 3. Calculate scale from image dimensions vs spec ballot dimensions
  // This is the most reliable method — no guessing about QR bounding boxes.
  // The spec is at 300 DPI. A quarter-letter ballot = 4.25" x 5.5" = 1275 x 1650 px at 300 DPI.
  const BALLOT_SIZES_PX = {
    'letter': { w: 2550, h: 3300 },
    'half_letter': { w: 1650, h: 2550 },
    'quarter_letter': { w: 1275, h: 1650 },
    'eighth_letter': { w: 825, h: 1275 },
  };
  const specBallot = BALLOT_SIZES_PX[ballotSpec.ballot_size] || BALLOT_SIZES_PX['quarter_letter'];
  const scaleX = uprightMeta.width / specBallot.w;
  const scaleY = uprightMeta.height / specBallot.h;
  const scaleFromSpec = (scaleX + scaleY) / 2;

  // Anchor = QR top-left corner in the image, estimated from finder pattern center
  // The QR center in the spec is at (qr.x + qr.width/2, qr.y + qr.height/2)
  // The QR center in the image is detected by jsQR
  const specQR = ballotSpec.qr_code;
  const us = uprightQR.scale || 1;
  const qrImgCx = (uprightQR.location.topLeftCorner.x + uprightQR.location.topRightCorner.x) / 2 / us;
  const qrImgCy = (uprightQR.location.topLeftCorner.y + uprightQR.location.bottomLeftCorner.y) / 2 / us;
  const specQRcx = specQR.x + specQR.width / 2;
  const specQRcy = specQR.y + specQR.height / 2;

  // The anchor is the QR's spec top-left position mapped to image coordinates
  const anchorX = qrImgCx - (specQRcx - specQR.x) * scaleFromSpec;
  const anchorY = qrImgCy - (specQRcy - specQR.y) * scaleFromSpec;

  console.log(`[OMR] Scale: ${scaleFromSpec.toFixed(4)} (imgW=${uprightMeta.width}, specW=${specBallot.w}), QR center img=(${Math.round(qrImgCx)},${Math.round(qrImgCy)}), anchor=(${Math.round(anchorX)},${Math.round(anchorY)})`);

  // 5. Map oval positions using QR-relative offsets and analyze fills
  const candidateResults = [];
  for (const candidate of ballotSpec.candidates) {
    const ovalCenterX = anchorX + (candidate.oval.x_offset_from_qr * scaleFromSpec);
    const ovalCenterY = anchorY + (candidate.oval.y_offset_from_qr * scaleFromSpec);
    const ovalFullW = candidate.oval.width * scaleFromSpec;
    const ovalFullH = candidate.oval.height * scaleFromSpec;

    // Shrink to inner 65% width, 70% height to exclude outline + adjacent text
    const shrinkW = 0.65;
    const shrinkH = 0.70;
    const ovalW = ovalFullW * shrinkW;
    const ovalH = ovalFullH * shrinkH;

    // Shift crop 15% left to avoid candidate name text on the right
    const shiftLeft = ovalFullW * 0.15;
    const cropX = ovalCenterX - shiftLeft - ovalW / 2;
    const cropY = ovalCenterY - ovalH / 2;

    console.log(`[OMR] Oval "${candidate.name}": center=(${Math.round(ovalCenterX)},${Math.round(ovalCenterY)}), crop=pos(${Math.round(cropX)},${Math.round(cropY)}) size=${Math.round(ovalW)}x${Math.round(ovalH)}`);

    const fillRatio = await analyzeOvalFill(finalBuffer, cropX, cropY, ovalW, ovalH, uprightMeta.width, uprightMeta.height);

    candidateResults.push({
      candidate_id: candidate.candidate_id,
      name: candidate.name,
      fill_ratio: Math.round(fillRatio * 10000) / 10000,
    });
  }

  // 7. Adaptive vote detection — look for the outlier, not absolute thresholds
  //    A filled oval will have a MUCH higher fill than all other ovals on the same ballot.
  //    Compare to the BASELINE (bottom half median), not just the second highest,
  //    because positional noise (divider lines, nearby text) can inflate specific ovals.
  const sorted = [...candidateResults].sort((a, b) => b.fill_ratio - a.fill_ratio);
  const highest = sorted[0];
  const secondHighest = sorted.length > 1 ? sorted[1] : { fill_ratio: 0 };

  // Baseline: median of the bottom half of candidates (the truly unmarked ones)
  const bottomHalf = sorted.slice(Math.ceil(sorted.length / 2));
  const baseline = bottomHalf.length > 0
    ? bottomHalf.reduce((sum, c) => sum + c.fill_ratio, 0) / bottomHalf.length
    : 0;

  // Signal: how far above baseline is the highest fill?
  const signalAboveBaseline = highest.fill_ratio - baseline;
  const secondSignal = secondHighest.fill_ratio - baseline;

  // Ratio of highest signal to second highest signal (both relative to baseline)
  const signalRatio = secondSignal > 0.01 ? signalAboveBaseline / secondSignal : Infinity;

  console.log(`[OMR] Adaptive analysis: highest=${highest.name}@${highest.fill_ratio}, 2nd=${secondHighest.name}@${secondHighest.fill_ratio}, baseline=${baseline.toFixed(4)}, signal=${signalAboveBaseline.toFixed(4)}, 2ndSignal=${secondSignal.toFixed(4)}, signalRatio=${signalRatio.toFixed(2)}`);

  let detectedVote = null;
  let confidence = 0;
  let flagReason = null;

  for (const c of candidateResults) {
    c.is_marked = false;
    c.is_uncertain = false;
  }

  if (highest.fill_ratio < 0.03 || signalAboveBaseline < 0.008) {
    // No meaningful signal above baseline — blank ballot
    flagReason = 'no_mark';
    console.log(`[OMR] Decision: NO_MARK — no signal above baseline (highest=${highest.fill_ratio}, baseline=${baseline.toFixed(4)})`);
  } else if (signalAboveBaseline >= 0.02 && signalRatio >= 1.4) {
    // Clear winner: one candidate's signal is at least 1.4x the next
    // Low signal threshold (0.02) handles pencil marks which have fill ratios of 0.10-0.35
    const winner = candidateResults.find(c => c.candidate_id === highest.candidate_id);
    winner.is_marked = true;
    detectedVote = winner.candidate_id;
    // Normalized confidence: base from signal strength + boost from signal ratio + fill ratio
    const baseConf = Math.min(signalAboveBaseline / 0.8, 1.0);
    const ratioBoost = Math.min(signalRatio / 10, 1.0);
    confidence = baseConf * 0.6 + ratioBoost * 0.3 + Math.min(highest.fill_ratio, 1.0) * 0.1;
    console.log(`[OMR] Decision: CLEAR VOTE — ${winner.name} (fill=${highest.fill_ratio}, signal=${signalAboveBaseline.toFixed(4)}, ${signalRatio.toFixed(1)}x above 2nd, confidence=${confidence.toFixed(4)})`);
  } else if (signalAboveBaseline >= 0.02 && secondSignal >= 0.02 && signalRatio < 1.2) {
    // Two candidates with very similar signal above baseline — real overvote
    const markedOnes = sorted.filter(c => (c.fill_ratio - baseline) >= 0.02);
    for (const c of markedOnes) {
      const match = candidateResults.find(r => r.candidate_id === c.candidate_id);
      match.is_marked = true;
    }
    flagReason = 'overvote';
    console.log(`[OMR] Decision: OVERVOTE — ${markedOnes.map(c => c.name).join(', ')} all above baseline by 0.04+`);
  } else {
    // Some signal but not conclusive
    flagReason = 'uncertain';
    const baseConf = Math.min(signalAboveBaseline / 0.8, 1.0);
    const ratioBoost = Math.min(signalRatio / 10, 1.0);
    confidence = baseConf * 0.6 + ratioBoost * 0.3 + Math.min(highest.fill_ratio, 1.0) * 0.1;
    const winner = candidateResults.find(c => c.candidate_id === highest.candidate_id);
    winner.is_uncertain = true;
    console.log(`[OMR] Decision: UNCERTAIN — highest ${highest.name}@${highest.fill_ratio}, signal=${signalAboveBaseline.toFixed(4)}, ratio=${signalRatio.toFixed(2)}`);
  }

  return {
    serial_number: serialNumber,
    rotation_applied: 0,
    candidates: candidateResults,
    detected_vote: detectedVote,
    confidence,
    flag_reason: flagReason,
  };
}

module.exports = { findQRInImage, processScannedBallot, rotateToUpright, analyzeOvalFill };
