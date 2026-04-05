#!/usr/bin/env node
/**
 * BallotTrack Station Agent — Interactive Setup
 * Run: node setup.js
 * Creates config.json with your settings.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('');
  console.log('='.repeat(50));
  console.log('  BallotTrack Station Agent Setup');
  console.log('='.repeat(50));
  console.log('');

  const serverUrl = await ask('Server URL (e.g. http://192.168.1.100:3000): ');
  if (!serverUrl.trim()) { console.log('Server URL is required.'); process.exit(1); }

  const stationId = await ask('Station ID (e.g. station-1): ');
  if (!stationId.trim()) { console.log('Station ID is required.'); process.exit(1); }

  const defaultFolder = process.platform === 'win32'
    ? 'C:\\ScanSnap\\Output'
    : path.join(require('os').homedir(), 'ScanSnap', 'Output');

  const watchFolder = (await ask(`Watch folder [${defaultFolder}]: `)).trim() || defaultFolder;

  const retryAttempts = parseInt((await ask('Retry attempts [5]: ')).trim()) || 5;

  const config = {
    serverUrl: serverUrl.trim().replace(/\/+$/, ''),
    stationId: stationId.trim(),
    watchFolder,
    retryAttempts,
  };

  const configPath = path.join(__dirname, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Create the watch folder if it doesn't exist
  if (!fs.existsSync(watchFolder)) {
    fs.mkdirSync(watchFolder, { recursive: true });
    console.log(`\nCreated watch folder: ${watchFolder}`);
  }

  console.log('');
  console.log('Config saved to config.json:');
  console.log(JSON.stringify(config, null, 2));
  console.log('');
  console.log('Next steps:');
  console.log('  1. Configure your ScanSnap to save images to:', watchFolder);
  console.log('  2. Run: node station-agent.js');
  console.log(`  3. Open in browser: ${config.serverUrl}/station-setup`);
  console.log('');

  // Test connection
  const testConn = (await ask('Test server connection now? [Y/n]: ')).trim().toLowerCase();
  if (testConn !== 'n') {
    try {
      const http = config.serverUrl.startsWith('https') ? require('https') : require('http');
      const url = new URL(`${config.serverUrl}/api/health`);
      await new Promise((resolve, reject) => {
        http.get(url, (res) => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.status === 'ok') {
                console.log('\x1b[32mConnection successful!\x1b[0m');
              } else {
                console.log('\x1b[33mServer responded but status is:', json.status, '\x1b[0m');
              }
            } catch { console.log('\x1b[31mUnexpected response from server\x1b[0m'); }
            resolve();
          });
        }).on('error', (err) => {
          console.log(`\x1b[31mCannot reach server: ${err.message}\x1b[0m`);
          resolve();
        });
      });
    } catch (err) {
      console.log(`\x1b[31mConnection test failed: ${err.message}\x1b[0m`);
    }
  }

  rl.close();
}

main();
