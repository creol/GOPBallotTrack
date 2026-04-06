# Scanning Station Setup Guide

This guide walks through setting up a laptop as a ballot scanning station for BallotTrack.

## Prerequisites

- A Windows laptop connected to the BallotTrack WiFi network
- A Fujitsu ScanSnap iX1600 or iX1300 scanner (USB connected)
- The BallotTrack server must already be running

---

## Step 1: Install the BallotTrack Station Agent

1. Open a web browser on the station laptop
2. Go to `http://<server-ip>:3000/station-setup`
   - Replace `<server-ip>` with the IP address of the server laptop (ask your admin)
3. Enter a **Station ID** (e.g. `station-1`, `station-2`) — each station needs a unique name
4. Click **Download Station Installer**
5. Open your **Downloads** folder
6. Double-click **BallotTrack-Station-Setup.bat**
7. Click **Yes** when Windows asks for permission
8. Wait for the installer to finish — it will:
   - Test the connection to the server
   - Download and install the station agent to `C:\BallotTrack-Agent`
   - Create the scanner watch folder at `C:\ScanSnap\Output`
   - Place a **BallotTrack Station** shortcut on the desktop
   - Start the agent automatically

> **Note:** No other software (like Node.js) needs to be installed manually — the installer bundles everything.

---

## Step 2: Install the ScanSnap Software

1. Download the ScanSnap Home software from: **https://scansnap.com/d/**
2. Run the installer with all default settings
3. Connect the ScanSnap scanner via USB
4. Open **ScanSnap Home** — it should detect the scanner automatically

---

## Step 3: Create the BallotTrack Scan Profile

1. In ScanSnap Home, click **Add Profile** (or the **+** button)
2. Select the **Scan to Folder** template
3. Name the profile: **BallotTrack**
4. Change the following settings:
   - **Color mode:** Gray
   - **Image format:** JPEG
   - **Save to:** `C:\ScanSnap\Output`
5. Click **Save Profile**

> **Tip:** Make sure the BallotTrack profile is the active/selected profile on the scanner before scanning ballots. You can set it as the default or select it from the scanner's touchscreen.

---

## Daily Operation

Each day before scanning begins:

1. Turn on the ScanSnap scanner and connect it via USB
2. Double-click the **BallotTrack Station** shortcut on the desktop
3. Verify the agent window shows it is connected to the server
4. Select the **BallotTrack** profile on the scanner
5. Feed ballots into the scanner — scanned images are automatically uploaded to the server

---

## Troubleshooting

**Installer says "Cannot reach the BallotTrack server"**
- Make sure the station laptop is connected to the correct WiFi network
- Make sure the server laptop is running and Docker is started

**Scanner not detected in ScanSnap Home**
- Check the USB cable connection
- Try a different USB port
- Restart ScanSnap Home

**Scanned images not uploading**
- Check that the agent window is open and shows "connected"
- Verify the ScanSnap profile saves to `C:\ScanSnap\Output`
- Check that files are appearing in `C:\ScanSnap\Output` after scanning

**Agent window closed accidentally**
- Double-click the **BallotTrack Station** shortcut on the desktop to restart it
