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
 * Try to decode QR from an image at a specific max dimension.
 */
async function tryDecodeAtSize(imageBuffer, metadata, maxDim) {
  let processImg = sharp(imageBuffer);
  let scale = 1;

  if (maxDim && (metadata.width > maxDim || metadata.height > maxDim)) {
    scale = maxDim / Math.max(metadata.width, metadata.height);
    processImg = processImg.resize(Math.round(metadata.width * scale), Math.round(metadata.height * scale));
  }

  // Sharpen to help QR detection on scanned images
  processImg = processImg.sharpen();

  const { data: rgbaBuffer, info } = await processImg
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const qrResult = decodeQR(rgbaBuffer, info.width, info.height);
  return qrResult ? { ...qrResult, scale } : null;
}

/**
 * Try to find a QR code in an image buffer.
 * Tries multiple scales to handle different scan resolutions.
 * Returns { qrData, rotation, sharpInstance } or null.
 */
async function findQRInImage(imageBuffer) {
  const metadata = await sharp(imageBuffer).metadata();
  console.log(`[OMR] Image dimensions: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

  // Try multiple scales — high-DPI scans may need different sizes for jsQR
  const sizes = [null, 3000, 2000, 1500, 1000];
  for (const maxDim of sizes) {
    const label = maxDim ? `${maxDim}px` : 'full';
    try {
      const result = await tryDecodeAtSize(imageBuffer, metadata, maxDim);
      if (result) {
        console.log(`[OMR] QR found at scale ${label}: ${JSON.stringify(result.data)}`);
        return {
          qrData: result.data,
          location: result.location,
          rotation: calculateRotation(result.location),
          width: metadata.width,
          height: metadata.height,
          scale: result.scale,
        };
      }
      console.log(`[OMR] QR not found at scale ${label}`);
    } catch (err) {
      console.log(`[OMR] QR decode error at scale ${label}: ${err.message}`);
    }
  }

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
 * The oval is defined by center + radii in 300 DPI pixel coordinates.
 * Returns a fill ratio 0.0-1.0 (ratio of dark pixels in the zone).
 */
async function analyzeOvalFill(imageBuffer, ovalSpec, imageDpi) {
  // Convert oval spec (300 DPI) to actual image pixel coords
  const dpiScale = imageDpi / 300;
  const cx = Math.round(ovalSpec.x * dpiScale + ovalSpec.width * dpiScale / 2);
  const cy = Math.round(ovalSpec.y * dpiScale + ovalSpec.height * dpiScale / 2);
  const rx = Math.round(ovalSpec.width * dpiScale / 2);
  const ry = Math.round(ovalSpec.height * dpiScale / 2);

  // Crop the bounding box of the oval
  const cropX = Math.max(0, cx - rx);
  const cropY = Math.max(0, cy - ry);
  const cropW = rx * 2;
  const cropH = ry * 2;

  if (cropW <= 0 || cropH <= 0) return 0;

  try {
    const { data: pixels, info } = await sharp(imageBuffer)
      .greyscale()
      .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Count dark pixels (threshold: < 128 on 0-255 scale)
    let darkCount = 0;
    let totalInOval = 0;

    for (let py = 0; py < info.height; py++) {
      for (let px = 0; px < info.width; px++) {
        // Check if pixel is inside the oval
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
  } catch {
    return 0;
  }
}

/**
 * Estimate the DPI of a scanned image based on its pixel dimensions
 * and the known ballot size in inches.
 */
function estimateDpi(imageWidth, imageHeight, ballotWidthPts, ballotHeightPts) {
  const ballotWidthInches = ballotWidthPts / 72;
  const ballotHeightInches = ballotHeightPts / 72;
  const dpiW = imageWidth / ballotWidthInches;
  const dpiH = imageHeight / ballotHeightInches;
  return Math.round((dpiW + dpiH) / 2);
}

/**
 * Full OMR pipeline: QR detection, rotation, oval analysis.
 *
 * @param {Buffer} imageBuffer - The scanned ballot image
 * @param {Object} ballotSpec - The ballot-spec.json contents
 * @param {Object} sizes - The SIZES map from ballotGenerator
 * @returns {Object} OMR result
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

  // 3. Get image dimensions after rotation
  const uprightMeta = await sharp(uprightBuffer).metadata();

  // 4. Estimate DPI from image size vs ballot spec
  // Use letter size as the page size (ballots are printed on letter)
  const LETTER_W_PTS = 8.5 * 72;
  const LETTER_H_PTS = 11 * 72;
  const imageDpi = estimateDpi(uprightMeta.width, uprightMeta.height, LETTER_W_PTS, LETTER_H_PTS);

  // 5. Analyze each candidate oval
  const candidateResults = [];
  for (const candidate of ballotSpec.candidates) {
    const fillRatio = await analyzeOvalFill(uprightBuffer, candidate.oval, imageDpi);

    const isMarked = fillRatio > ballotSpec.omr_thresholds.marked;
    const isUnmarked = fillRatio < ballotSpec.omr_thresholds.unmarked;

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
