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
      rotation_applied: 0,
      candidates: [],
      detected_vote: null,
      confidence: 0,
      flag_reason: 'qr_not_found',
    };
  }

  // QR encodes only the serial number as a plain string
  const serialNumber = typeof qrResult.qrData === 'string' ? qrResult.qrData : null;

  // 2. Find BOTH QR codes in the image for two-point affine alignment
  // Strategy: scan each quadrant of the image independently for QR codes.
  // The ballot has QRs in opposite corners (TL and BR).
  const imgMeta = await sharp(imageBuffer).metadata();
  const allQRs = [];

  // Scan each quadrant for QR codes
  const halfW = Math.floor(imgMeta.width / 2);
  const halfH = Math.floor(imgMeta.height / 2);
  const quadrants = [
    { name: 'TL', left: 0, top: 0, width: halfW, height: halfH },
    { name: 'TR', left: halfW, top: 0, width: imgMeta.width - halfW, height: halfH },
    { name: 'BL', left: 0, top: halfH, width: halfW, height: imgMeta.height - halfH },
    { name: 'BR', left: halfW, top: halfH, width: imgMeta.width - halfW, height: imgMeta.height - halfH },
  ];

  for (const q of quadrants) {
    try {
      const cropBuf = await sharp(imageBuffer)
        .extract({ left: q.left, top: q.top, width: q.width, height: q.height })
        .toBuffer();
      const qrRes = await findQRInImage(cropBuf);
      if (qrRes && qrRes.qrData) {
        const s = qrRes.scale || 1;
        // Map QR center back to full image coordinates
        const cx = (qrRes.location.topLeftCorner.x + qrRes.location.topRightCorner.x) / 2 / s + q.left;
        const cy = (qrRes.location.topLeftCorner.y + qrRes.location.bottomLeftCorner.y) / 2 / s + q.top;
        // Avoid duplicate (same QR found in overlapping regions)
        const isDup = allQRs.some(existing => Math.abs(existing.cx - cx) < 100 && Math.abs(existing.cy - cy) < 100);
        if (!isDup) {
          allQRs.push({ cx, cy, quadrant: q.name, data: qrRes.qrData, location: qrRes.location, scale: s, qLeft: q.left, qTop: q.top });
          console.log(`[OMR] QR found in ${q.name} quadrant: "${qrRes.qrData}" at (${Math.round(cx)},${Math.round(cy)})`);
        }
      }
    } catch (err) {
      // Quadrant scan failed — skip
    }
  }

  // Also check the full image (first QR already found)
  const qr1Scale = qrResult.scale || 1;
  const qr1Cx = (qrResult.location.topLeftCorner.x + qrResult.location.topRightCorner.x) / 2 / qr1Scale;
  const qr1Cy = (qrResult.location.topLeftCorner.y + qrResult.location.bottomLeftCorner.y) / 2 / qr1Scale;
  const isDupFull = allQRs.some(existing => Math.abs(existing.cx - qr1Cx) < 100 && Math.abs(existing.cy - qr1Cy) < 100);
  if (!isDupFull) {
    allQRs.push({ cx: qr1Cx, cy: qr1Cy, quadrant: 'full', data: qrResult.qrData, location: qrResult.location, scale: qr1Scale, qLeft: 0, qTop: 0 });
  }

  console.log(`[OMR] Total QR codes found: ${allQRs.length}`);

  // 3. Identify which QR is top-left and which is bottom-right
  // The bottom-right QR is the one closer to the bottom-right corner of the image
  let brQR, tlQR;
  if (allQRs.length >= 2) {
    // The one with larger (cx + cy) is closer to bottom-right
    const sorted = [...allQRs].sort((a, b) => (b.cx + b.cy) - (a.cx + a.cy));
    brQR = sorted[0]; // bottom-right (larger cx+cy)
    tlQR = sorted[1]; // top-left (smaller cx+cy)
    console.log(`[OMR] BR QR at (${Math.round(brQR.cx)},${Math.round(brQR.cy)}), TL QR at (${Math.round(tlQR.cx)},${Math.round(tlQR.cy)})`);
  } else {
    brQR = allQRs[0];
    tlQR = null;
  }

  // 4. Compute affine transform from spec coordinates to image coordinates
  // Using two anchor points: TL QR center and BR QR center
  // spec positions → image positions
  const specBR = ballotSpec.qr_code;
  const specTL = ballotSpec.qr_code_top_left;

  let mapSpecToImage;
  let finalBuffer = imageBuffer; // no rotation needed with affine
  let wasMirrored = false;
  const rotation = 0;

  if (tlQR && specTL && specBR) {
    // Two-point affine: we have both QR codes
    // Spec anchor points (center of each QR bounding box)
    const specBRcx = specBR.x + specBR.width / 2;
    const specBRcy = specBR.y + specBR.height / 2;
    const specTLcx = specTL.x + specTL.width / 2;
    const specTLcy = specTL.y + specTL.height / 2;

    // Image anchor points (center of each detected QR)
    const imgBRcx = brQR.cx;
    const imgBRcy = brQR.cy;
    const imgTLcx = tlQR.cx;
    const imgTLcy = tlQR.cy;

    // Compute scale and rotation from the two anchor pairs
    const specDx = specBRcx - specTLcx;
    const specDy = specBRcy - specTLcy;
    const imgDx = imgBRcx - imgTLcx;
    const imgDy = imgBRcy - imgTLcy;

    const specDist = Math.sqrt(specDx * specDx + specDy * specDy);
    const imgDist = Math.sqrt(imgDx * imgDx + imgDy * imgDy);
    const scale = imgDist / specDist;

    const specAngle = Math.atan2(specDy, specDx);
    const imgAngle = Math.atan2(imgDy, imgDx);
    const angleDiff = imgAngle - specAngle;

    console.log(`[OMR] Affine: scale=${scale.toFixed(4)}, rotation=${(angleDiff * 180 / Math.PI).toFixed(2)}°, specDist=${Math.round(specDist)}, imgDist=${Math.round(imgDist)}`);

    // Affine mapping function: spec point → image point
    mapSpecToImage = (sx, sy) => {
      // Translate to TL origin, rotate+scale, translate to image TL
      const dx = sx - specTLcx;
      const dy = sy - specTLcy;
      const cos = Math.cos(angleDiff);
      const sin = Math.sin(angleDiff);
      const ix = imgTLcx + scale * (dx * cos - dy * sin);
      const iy = imgTLcy + scale * (dx * sin + dy * cos);
      return { x: ix, y: iy };
    };
  } else {
    // Single QR fallback — use the old expansion-based anchor method
    console.log(`[OMR] Single QR mode — using expansion-based anchor`);
    const s = brQR.scale || 1;
    const tl = brQR.location.topLeftCorner;
    const tr = brQR.location.topRightCorner;
    const bl = brQR.location.bottomLeftCorner;

    const f2fX = Math.abs(tr.x - tl.x) / s;
    const f2fY = Math.abs(bl.y - tl.y) / s;
    const expansion = 1.44;
    const mX = (f2fX * expansion - f2fX) / 2;
    const mY = (f2fY * expansion - f2fY) / 2;
    const anchorX = (tl.x / s) - mX;
    const anchorY = (tl.y / s) - mY;

    const specQRWidth = specBR.width;
    const detectedQRWidth = f2fX * expansion;
    const scale = detectedQRWidth / specQRWidth;

    console.log(`[OMR] Single anchor at (${Math.round(anchorX)},${Math.round(anchorY)}), scale=${scale.toFixed(3)}`);

    mapSpecToImage = (sx, sy) => {
      return {
        x: anchorX + (sx - specBR.x) * scale,
        y: anchorY + (sy - specBR.y) * scale,
      };
    };
  }

  // 5. Map oval positions using the affine transform and analyze fills
  const uprightMeta = imgMeta; // no rotation applied — affine handles everything
  const candidateResults = [];
  for (const candidate of ballotSpec.candidates) {
    // Map the oval center from spec coordinates to image coordinates
    const ovalSpecCx = candidate.oval.x + candidate.oval.width / 2;
    const ovalSpecCy = candidate.oval.y + candidate.oval.height / 2;
    const mapped = mapSpecToImage(ovalSpecCx, ovalSpecCy);

    // Scale the oval dimensions
    const specDiag = specBR && specTL ? Math.sqrt(
      Math.pow(specBR.x + specBR.width/2 - specTL.x - specTL.width/2, 2) +
      Math.pow(specBR.y + specBR.height/2 - specTL.y - specTL.height/2, 2)
    ) : 1;
    const imgDiag = tlQR && brQR ? Math.sqrt(
      Math.pow(brQR.cx - tlQR.cx, 2) + Math.pow(brQR.cy - tlQR.cy, 2)
    ) : 1;
    const ovalScale = (tlQR && specTL) ? (imgDiag / specDiag) : ((brQR.scale || 1) > 0 ? 1 : 1);

    // For single-QR mode, use the scale from the mapping function
    const ovalFullW = candidate.oval.width * (tlQR ? ovalScale : ((mapSpecToImage(1, 0).x - mapSpecToImage(0, 0).x)));
    const ovalFullH = candidate.oval.height * (tlQR ? ovalScale : ((mapSpecToImage(0, 1).y - mapSpecToImage(0, 0).y)));

    // Shrink to inner 55% width, 60% height
    const shrinkW = 0.55;
    const shrinkH = 0.60;
    const ovalW = Math.abs(ovalFullW) * shrinkW;
    const ovalH = Math.abs(ovalFullH) * shrinkH;

    // Shift crop 15% left to avoid candidate name text
    const shiftLeft = Math.abs(ovalFullW) * 0.15;
    const cropX = mapped.x - shiftLeft - ovalW / 2;
    const cropY = mapped.y - ovalH / 2;

    console.log(`[OMR] Oval "${candidate.name}": spec=(${ovalSpecCx},${ovalSpecCy}) -> img=(${Math.round(mapped.x)},${Math.round(mapped.y)}), crop=pos(${Math.round(cropX)},${Math.round(cropY)}) size=${Math.round(ovalW)}x${Math.round(ovalH)}`);

    const fillRatio = await analyzeOvalFill(imageBuffer, cropX, cropY, ovalW, ovalH, imgMeta.width, imgMeta.height);

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
    mirrored: wasMirrored,
    candidates: candidateResults,
    detected_vote: detectedVote,
    confidence,
    flag_reason: flagReason,
  };
}

module.exports = { findQRInImage, processScannedBallot, rotateToUpright, analyzeOvalFill };
