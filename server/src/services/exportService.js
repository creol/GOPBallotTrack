const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { generateResultsPdf } = require('../pdf/resultsPdf');

const UPLOADS_BASE = path.join(__dirname, '..', '..', '..', 'uploads');

// Track in-progress exports
const exportJobs = {};

/**
 * Export all ballot images for an election as a ZIP.
 */
async function exportImages(electionId) {
  const jobKey = `images-${electionId}`;
  exportJobs[jobKey] = { status: 'processing', started: Date.now() };

  try {
    const outDir = path.join(UPLOADS_BASE, 'elections', String(electionId), 'exports');
    fs.mkdirSync(outDir, { recursive: true });
    const zipPath = path.join(outDir, 'ballot-images.zip');

    const { rows: races } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order',
      [electionId]
    );

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      (async () => {
        for (const race of races) {
          const raceDirName = `race-${race.name.toLowerCase().replace(/\s+/g, '-')}`;

          const { rows: rounds } = await db.query(
            'SELECT * FROM rounds WHERE race_id = $1 ORDER BY round_number',
            [race.id]
          );

          for (const round of rounds) {
            const roundDirName = `round-${round.round_number}`;

            const { rows: scans } = await db.query(
              `SELECT s.front_image_path, s.back_image_path, bs.serial_number
               FROM scans s
               JOIN ballot_serials bs ON bs.id = s.ballot_serial_id
               JOIN passes p ON p.id = s.pass_id
               WHERE p.round_id = $1
               ORDER BY bs.serial_number`,
              [round.id]
            );

            for (const scan of scans) {
              const prefix = `ballot-images/${raceDirName}/${roundDirName}`;
              if (scan.front_image_path && fs.existsSync(scan.front_image_path)) {
                const ext = path.extname(scan.front_image_path) || '.jpg';
                archive.file(scan.front_image_path, { name: `${prefix}/${scan.serial_number}-front${ext}` });
              }
              if (scan.back_image_path && fs.existsSync(scan.back_image_path)) {
                const ext = path.extname(scan.back_image_path) || '.jpg';
                archive.file(scan.back_image_path, { name: `${prefix}/${scan.serial_number}-back${ext}` });
              }
            }
          }
        }

        archive.finalize();
      })();
    });

    exportJobs[jobKey] = { status: 'ready', path: zipPath, completed: Date.now() };
    return zipPath;
  } catch (err) {
    exportJobs[jobKey] = { status: 'error', error: err.message };
    throw err;
  }
}

/**
 * Full election export — images, results PDFs, ballot PDFs, JSON dump.
 */
async function exportFull(electionId) {
  const jobKey = `full-${electionId}`;
  exportJobs[jobKey] = { status: 'processing', started: Date.now() };

  try {
    const outDir = path.join(UPLOADS_BASE, 'elections', String(electionId), 'exports');
    fs.mkdirSync(outDir, { recursive: true });
    const zipPath = path.join(outDir, 'full-export.zip');

    const { rows: [election] } = await db.query('SELECT * FROM elections WHERE id = $1', [electionId]);
    const { rows: races } = await db.query('SELECT * FROM races WHERE election_id = $1 ORDER BY display_order', [electionId]);

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      (async () => {
        // JSON dump of all election data
        const dump = { election, races: [] };

        for (const race of races) {
          const { rows: candidates } = await db.query(
            'SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order', [race.id]
          );
          const { rows: rounds } = await db.query(
            'SELECT * FROM rounds WHERE race_id = $1 ORDER BY round_number', [race.id]
          );

          const roundsData = [];
          for (const round of rounds) {
            const { rows: passes } = await db.query(
              'SELECT * FROM passes WHERE round_id = $1 ORDER BY pass_number', [round.id]
            );
            const { rows: results } = await db.query(
              `SELECT rr.*, c.name as candidate_name FROM round_results rr
               JOIN candidates c ON c.id = rr.candidate_id WHERE rr.round_id = $1`, [round.id]
            );
            const { rows: serials } = await db.query(
              'SELECT * FROM ballot_serials WHERE round_id = $1 ORDER BY serial_number', [round.id]
            );
            const { rows: spoiled } = await db.query(
              'SELECT * FROM spoiled_ballots WHERE round_id = $1', [round.id]
            );
            const { rows: confirmations } = await db.query(
              'SELECT * FROM round_confirmations WHERE round_id = $1', [round.id]
            );

            roundsData.push({ ...round, passes, results, serials, spoiled, confirmations });

            // Add ballot PDF if exists
            const raceDirName = `race-${race.name.toLowerCase().replace(/\s+/g, '-')}`;
            const ballotPdf = path.join(UPLOADS_BASE, 'elections', String(electionId), 'rounds', String(round.id), 'ballots.pdf');
            if (fs.existsSync(ballotPdf)) {
              archive.file(ballotPdf, { name: `ballot-pdfs/${raceDirName}/round-${round.round_number}-ballots.pdf` });
            }

            // Generate and add results PDF if round is confirmed
            if (['confirmed', 'pending_release', 'released'].includes(round.status)) {
              try {
                const resultsPdfPath = await generateResultsPdf(round.id);
                archive.file(resultsPdfPath, { name: `results-pdfs/${raceDirName}/round-${round.round_number}-results.pdf` });
              } catch {}
            }

            // Add scan images
            const { rows: scans } = await db.query(
              `SELECT s.front_image_path, s.back_image_path, bs.serial_number
               FROM scans s JOIN ballot_serials bs ON bs.id = s.ballot_serial_id
               JOIN passes p ON p.id = s.pass_id WHERE p.round_id = $1`, [round.id]
            );
            for (const scan of scans) {
              const prefix = `ballot-images/${raceDirName}/round-${round.round_number}`;
              if (scan.front_image_path && fs.existsSync(scan.front_image_path)) {
                archive.file(scan.front_image_path, { name: `${prefix}/${scan.serial_number}-front${path.extname(scan.front_image_path) || '.jpg'}` });
              }
              if (scan.back_image_path && fs.existsSync(scan.back_image_path)) {
                archive.file(scan.back_image_path, { name: `${prefix}/${scan.serial_number}-back${path.extname(scan.back_image_path) || '.jpg'}` });
              }
            }
          }

          dump.races.push({ ...race, candidates, rounds: roundsData });
        }

        archive.append(JSON.stringify(dump, null, 2), { name: 'election-data.json' });
        archive.finalize();
      })();
    });

    exportJobs[jobKey] = { status: 'ready', path: zipPath, completed: Date.now() };
    return zipPath;
  } catch (err) {
    exportJobs[jobKey] = { status: 'error', error: err.message };
    throw err;
  }
}

function getExportStatus(jobKey) {
  return exportJobs[jobKey] || { status: 'not_started' };
}

module.exports = { exportImages, exportFull, getExportStatus };
