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
          // QR encodes plain serial number string — just check it's non-empty
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
          console.log(`[OMR] QR finder patterns detected at ${label} but data empty/invalid`);
        }
      } catch (err) {
        // Skip errors silently for individual attempts
      }
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
      rotation_applied: 0,
      candidates: [],
      detected_vote: null,
      confidence: 0,
      flag_reason: 'qr_not_found',
    };
  }

  // QR encodes only the serial number as a plain string
  const serialNumber = typeof qrResult.qrData === 'string' ? qrResult.qrData : null;

  // 2. Determine orientation using QR position and rotate to upright
  const imgMeta = await sharp(imageBuffer).metadata();
  const s = qrResult.scale || 1;
  const qrCx = (qrResult.location.topLeftCorner.x + qrResult.location.topRightCorner.x) / 2 / s;
  const qrCy = (qrResult.location.topLeftCorner.y + qrResult.location.bottomLeftCorner.y) / 2 / s;
  const inRight = qrCx > imgMeta.width / 2;
  const inBottom = qrCy > imgMeta.height / 2;

  let rotation = 0;
  if (inRight && inBottom) rotation = 0;
  else if (!inRight && inBottom) rotation = 90;
  else if (!inRight && !inBottom) rotation = 180;
  else if (inRight && !inBottom) rotation = 270;

  console.log(`[OMR] QR at (${Math.round(qrCx)},${Math.round(qrCy)}) in ${imgMeta.width}x${imgMeta.height}, right=${inRight}, bottom=${inBottom}, rotation=${rotation}°`);

  let finalBuffer = await rotateToUpright(imageBuffer, rotation);

  // 3. Re-find QR in upright image for accurate position
  let uprightQR = await findQRInImage(finalBuffer);
  let uprightMeta = await sharp(finalBuffer).metadata();

  // Check if mirrored (face-down scan) — QR should be in bottom-right
  if (uprightQR) {
    const us = uprightQR.scale || 1;
    const uCx = (uprightQR.location.topLeftCorner.x + uprightQR.location.topRightCorner.x) / 2 / us;
    if (uCx < uprightMeta.width / 2) {
      console.log(`[OMR] QR in left half after rotation — flipping (face-down scan)`);
      finalBuffer = await sharp(finalBuffer).flop().toBuffer();
      uprightQR = await findQRInImage(finalBuffer);
      uprightMeta = await sharp(finalBuffer).metadata();
    }
  }

  if (!uprightQR) {
    console.log(`[OMR] Lost QR after rotation — using original`);
    uprightQR = qrResult;
    finalBuffer = imageBuffer;
    uprightMeta = imgMeta;
  }

  // 4. Calculate scale and anchor from QR finder patterns
  const us = uprightQR.scale || 1;
  const tl = uprightQR.location.topLeftCorner;
  const tr = uprightQR.location.topRightCorner;
  const bl = uprightQR.location.bottomLeftCorner;

  const f2fX = Math.abs(tr.x - tl.x) / us;
  const f2fY = Math.abs(bl.y - tl.y) / us;
  const expansion = 1.44;
  const mX = (f2fX * expansion - f2fX) / 2;
  const mY = (f2fY * expansion - f2fY) / 2;
  const anchorX = (tl.x / us) - mX;
  const anchorY = (tl.y / us) - mY;

  const specQR = ballotSpec.qr_code;
  const detectedQRWidth = f2fX * expansion;
  const scaleFromSpec = detectedQRWidth / specQR.width;

  console.log(`[OMR] Anchor=(${Math.round(anchorX)},${Math.round(anchorY)}), scale=${scaleFromSpec.toFixed(3)}, f2f=${Math.round(f2fX)}x${Math.round(f2fY)}`);

  // 5. Map oval positions using QR-relative offsets and analyze fills
  const candidateResults = [];
  for (const candidate of ballotSpec.candidates) {
    const ovalCenterX = anchorX + (candidate.oval.x_offset_from_qr * scaleFromSpec);
    const ovalCenterY = anchorY + (candidate.oval.y_offset_from_qr * scaleFromSpec);
    const ovalFullW = candidate.oval.width * scaleFromSpec;
    const ovalFullH = candidate.oval.height * scaleFromSpec;

    // Shrink to inner 55% width, 60% height to exclude outline + adjacent text
    const shrinkW = 0.55;
    const shrinkH = 0.60;
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

  if (highest.fill_ratio < 0.05 || signalAboveBaseline < 0.03) {
    // No meaningful signal above baseline — blank ballot
    flagReason = 'no_mark';
    console.log(`[OMR] Decision: NO_MARK — no signal above baseline (highest=${highest.fill_ratio}, baseline=${baseline.toFixed(4)})`);
  } else if (signalAboveBaseline >= 0.05 && signalRatio >= 1.4) {
    // Clear winner: one candidate's signal is at least 1.4x the next
    // This covers the common case where positional noise inflates one neighbor
    const winner = candidateResults.find(c => c.candidate_id === highest.candidate_id);
    winner.is_marked = true;
    detectedVote = winner.candidate_id;
    confidence = signalAboveBaseline;
    console.log(`[OMR] Decision: CLEAR VOTE — ${winner.name} (fill=${highest.fill_ratio}, signal=${signalAboveBaseline.toFixed(4)}, ${signalRatio.toFixed(1)}x above 2nd)`);
  } else if (signalAboveBaseline >= 0.05 && secondSignal >= 0.05 && signalRatio < 1.2) {
    // Two candidates with very similar signal above baseline — real overvote
    const markedOnes = sorted.filter(c => (c.fill_ratio - baseline) >= 0.04);
    for (const c of markedOnes) {
      const match = candidateResults.find(r => r.candidate_id === c.candidate_id);
      match.is_marked = true;
    }
    flagReason = 'overvote';
    console.log(`[OMR] Decision: OVERVOTE — ${markedOnes.map(c => c.name).join(', ')} all above baseline by 0.04+`);
  } else {
    // Some signal but not conclusive
    flagReason = 'uncertain';
    confidence = signalAboveBaseline;
    const winner = candidateResults.find(c => c.candidate_id === highest.candidate_id);
    winner.is_uncertain = true;
    console.log(`[OMR] Decision: UNCERTAIN — highest ${highest.name}@${highest.fill_ratio}, signal=${signalAboveBaseline.toFixed(4)}, ratio=${signalRatio.toFixed(2)}`);
  }

  return {
    serial_number: serialNumber,
    rotation_applied: rotation,
    candidates: candidateResults,
    detected_vote: detectedVote,
    confidence,
    flag_reason: flagReason,
  };
}

module.exports = { findQRInImage, processScannedBallot, rotateToUpright, analyzeOvalFill };
