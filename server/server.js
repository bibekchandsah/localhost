const express = require('express');
const cors = require('cors');
const path = require('path');
const fileController = require('./fileController');

// Tunnel authentication state (moved to top for middleware access)
let tunnelPassword = 'mylocalhost'; // Default password for tunnel access
let authenticatedSessions = new Set(); // Store authenticated session IDs

// Keep the console window open when running as a packaged .exe so the user
// can read any error message before the window closes.
function pauseAndExit(code = 1) {
  process.stdout.write('\nPress ENTER to close this window...');
  process.stdin.resume();
  try { process.stdin.setRawMode(true); } catch (_) {}
  process.stdin.once('data', () => process.exit(code));
}

process.on('uncaughtException', (err) => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  pauseAndExit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('\n❌ Unhandled rejection:', reason);
  pauseAndExit(1);
});

const app = express();

// Try to load FFmpeg for video conversion
let ffmpeg = null;
try {
  ffmpeg = require('fluent-ffmpeg');
  console.log('✓ FFmpeg support enabled (for TS file conversion)');
} catch (err) {
  console.log('⚠ FFmpeg not available - TS files will be streamed as-is');
}

// Middleware
app.use(cors());
app.use(express.json());

// Tunnel authentication middleware - checks password for Cloudflare tunnel requests
app.use((req, res, next) => {
  // Check if request is coming through Cloudflare tunnel
  const isTunnelRequest = req.headers['cf-connecting-ip'] || 
                          req.headers['cf-ray'] || 
                          req.headers['cf-visitor'];
  
  // Skip auth for local requests
  if (!isTunnelRequest) {
    return next();
  }
  
  // Allow tunnel auth endpoints without password
  if (req.path === '/tunnel-login' || req.path === '/api/tunnel/verify-password') {
    return next();
  }
  
  // Check for session cookie
  const cookies = req.headers.cookie || '';
  const sessionMatch = cookies.match(/tunnel_session=([^;]+)/);
  const sessionId = sessionMatch ? sessionMatch[1] : null;
  
  if (sessionId && authenticatedSessions.has(sessionId)) {
    return next();
  }
  
  // Redirect to login page for HTML requests, return 401 for API
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  
  // Serve login page
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LocalHost - Authentication Required</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }
    .login-container {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    .login-icon { font-size: 48px; color: #4ade80; margin-bottom: 20px; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #888; margin-bottom: 30px; }
    .input-group { position: relative; margin-bottom: 20px; }
    input {
      width: 100%;
      padding: 14px 16px 14px 45px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 16px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #4ade80; }
    input::placeholder { color: #666; }
    .input-icon {
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: #666;
    }
    button {
      width: 100%;
      padding: 14px;
      background: #4ade80;
      color: #000;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #22c55e; }
    button:disabled { background: #666; cursor: not-allowed; }
    .error { color: #f87171; margin-top: 16px; display: none; }
    .error.show { display: block; }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-icon"><i class="fa-solid fa-lock"></i></div>
    <h1>LocalHost Media Browser</h1>
    <p class="subtitle">Enter password to access</p>
    <form id="loginForm">
      <div class="input-group">
        <i class="fa-solid fa-key input-icon"></i>
        <input type="password" id="password" placeholder="Enter password" autocomplete="off" autofocus>
      </div>
      <button type="submit" id="submitBtn">
        <i class="fa-solid fa-right-to-bracket"></i> Access
      </button>
    </form>
    <p class="error" id="errorMsg">Incorrect password</p>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const errorMsg = document.getElementById('errorMsg');
      const submitBtn = document.getElementById('submitBtn');
      
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';
      errorMsg.classList.remove('show');
      
      try {
        const res = await fetch('/api/tunnel/verify-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        
        if (data.success) {
          window.location.reload();
        } else {
          errorMsg.textContent = data.error || 'Incorrect password';
          errorMsg.classList.add('show');
        }
      } catch (err) {
        errorMsg.textContent = 'Connection error';
        errorMsg.classList.add('show');
      }
      
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Access';
    });
  </script>
</body>
</html>`);
});

// When running as a pkg .exe, __dirname is inside the snapshot virtual filesystem.
// express.static works with pkg's patched fs, so the path is correct either way.
const clientDir = path.join(__dirname, '..', 'client');
app.use(express.static(clientDir));

// API Routes

/**
 * Set root directory
 * POST /api/set-root
 * Body: { path: string }
 */
app.post('/api/set-root', (req, res) => {
  const { path: dirPath } = req.body;

  if (!dirPath || typeof dirPath !== 'string') {
    return res.status(400).json({
      error: 'Invalid path provided'
    });
  }

  const result = fileController.setRootDirectory(dirPath);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * Get current root directory
 * GET /api/root
 */
app.get('/api/root', (req, res) => {
  const rootDir = fileController.getRootDirectory();

  if (!rootDir) {
    return res.status(400).json({
      error: 'No root directory set'
    });
  }

  res.json({
    rootDir: rootDir
  });
});

/**
 * List files in directory
 * GET /api/files?path=subfolder/path
 */
app.get('/api/files', (req, res) => {
  const { path: userPath = '' } = req.query;

  const result = fileController.listFiles(userPath);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * Stream file with range request support
 * GET /api/stream?path=file/path
 * Supports HTTP Range header: Range: bytes=0-1023
 */
app.get('/api/stream', (req, res) => {
  const { path: userPath } = req.query;

  if (!userPath) {
    return res.status(400).json({
      error: 'File path required'
    });
  }

  // Parse range header if present
  const range = req.headers.range;
  let start = null;
  let end = null;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    start = parts[0] ? parseInt(parts[0]) : null;
    end = parts[1] ? parseInt(parts[1]) : null;
  }

  const result = fileController.streamFile(userPath, start, end);

  if (!result.success) {
    return res.status(400).json(result);
  }

  // Set response headers
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', result.mime);
  
  // Add crossOrigin headers for media files
  if (result.mime.startsWith('video/') || result.mime.startsWith('audio/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // For video files, add additional headers
    res.setHeader('Content-Security-Policy', "default-src 'self'");
  }

  if (result.isRange) {
    res.setHeader('Content-Range', `bytes ${result.rangeStart}-${result.rangeEnd}/${result.size}`);
    res.setHeader('Content-Length', result.contentLength);
    res.status(206); // Partial Content
  } else {
    res.setHeader('Content-Length', result.size);
    res.status(200);
  }

  // Disable caching for streams
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  result.stream.pipe(res);

  result.stream.on('error', (err) => {
    console.error('Stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream error' });
    }
  });
});

/**
 * Download file
 * GET /api/download?path=file/path
 */
app.get('/api/download', (req, res) => {
  const { path: userPath } = req.query;

  if (!userPath) {
    return res.status(400).json({
      error: 'File path required'
    });
  }

  const result = fileController.streamFile(userPath);

  if (!result.success) {
    return res.status(400).json(result);
  }

  // Get filename
  const filename = path.basename(userPath);

  // Set download headers
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', result.mime);
  res.setHeader('Content-Length', result.size);

  result.stream.pipe(res);

  result.stream.on('error', (err) => {
    console.error('Download error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download error' });
    }
  });
});

/**
 * Get file stats
 * GET /api/file-stats?path=file/path
 */
app.get('/api/file-stats', (req, res) => {
  const { path: userPath } = req.query;

  if (!userPath) {
    return res.status(400).json({
      error: 'File path required'
    });
  }

  const result = fileController.getFileStats(userPath);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * Get text file content
 * GET /api/read-text?path=file/path
 */
app.get('/api/read-text', (req, res) => {
  const { path: userPath } = req.query;

  if (!userPath) {
    return res.status(400).json({
      error: 'File path required'
    });
  }

  const result = fileController.readTextFile(userPath);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * Health check
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============ Auto-Update API ============
const GITHUB_REPO = 'bibekchandsah/localhost';
const CURRENT_VERSION = require('../package.json').version;

/**
 * Check for updates from GitHub releases
 * GET /api/update/check
 */
app.get('/api/update/check', async (req, res) => {
  try {
    const https = require('https');
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      headers: { 'User-Agent': 'LocalHost-Media-Browser' }
    };

    const request = https.get(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestVersion = release.tag_name ? release.tag_name.replace(/^v/, '') : null;
          
          if (!latestVersion) {
            return res.json({ hasUpdate: false, currentVersion: CURRENT_VERSION, error: 'Could not parse version' });
          }

          // Compare versions (simple string compare works for semantic versions)
          const hasUpdate = latestVersion !== CURRENT_VERSION && latestVersion > CURRENT_VERSION;
          
          res.json({
            hasUpdate,
            currentVersion: CURRENT_VERSION,
            latestVersion,
            releaseUrl: release.html_url,
            releaseName: release.name,
            releaseNotes: release.body,
            publishedAt: release.published_at,
            downloadUrl: release.assets && release.assets.length > 0 
              ? release.assets.find(a => a.name.endsWith('.exe'))?.browser_download_url 
              : null
          });
        } catch (e) {
          res.json({ hasUpdate: false, currentVersion: CURRENT_VERSION, error: e.message });
        }
      });
    });

    request.on('error', (e) => {
      res.json({ hasUpdate: false, currentVersion: CURRENT_VERSION, error: e.message });
    });
  } catch (err) {
    res.json({ hasUpdate: false, currentVersion: CURRENT_VERSION, error: err.message });
  }
});

/**
 * Download update to user's Downloads folder with progress
 * GET /api/update/download-stream?url=...
 * Uses Server-Sent Events for progress updates
 */
app.get('/api/update/download-stream', (req, res) => {
  const downloadUrl = req.query.url;
  
  if (!downloadUrl) {
    return res.status(400).json({ success: false, error: 'No download URL provided' });
  }

  const https = require('https');
  const http = require('http');
  const fsSync = require('fs');
  
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Download to the same directory as the running executable
  const exePath = process.execPath;
  const exeDir = path.dirname(exePath);
  const exeName = path.basename(exePath, '.exe');
  const newFileName = `${exeName}-update.exe`;
  const filePath = path.join(exeDir, newFileName);
  
  console.log('Downloading update to:', filePath);
  console.log('Current executable:', exePath);
  sendEvent('start', { filePath, fileName: newFileName, exePath, exeDir });

  const downloadWithProgress = (url) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const request = protocol.get(url, { headers: { 'User-Agent': 'LocalHost-Media-Browser' } }, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        return downloadWithProgress(response.headers.location);
      }
      
      if (response.statusCode !== 200) {
        sendEvent('error', { error: `Failed to download: ${response.statusCode}` });
        res.end();
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10) || 0;
      let downloadedSize = 0;
      let startTime = Date.now();
      let lastUpdate = startTime;
      
      const file = fsSync.createWriteStream(filePath);
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const now = Date.now();
        
        // Send progress update every 100ms to avoid flooding
        if (now - lastUpdate > 100) {
          const elapsed = (now - startTime) / 1000;
          const speed = downloadedSize / elapsed; // bytes per second
          const percent = totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0;
          const remaining = totalSize > 0 && speed > 0 ? (totalSize - downloadedSize) / speed : 0;
          
          sendEvent('progress', {
            downloadedSize,
            totalSize,
            percent: percent.toFixed(1),
            speed,
            speedText: formatBytes(speed) + '/s',
            remaining,
            remainingText: formatTime(remaining),
            downloadedText: formatBytes(downloadedSize),
            totalText: formatBytes(totalSize)
          });
          
          lastUpdate = now;
        }
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        
        // Create a restart batch script
        const batchContent = `@echo off
timeout /t 2 /nobreak >nul
del "${exePath}"
rename "${filePath}" "${path.basename(exePath)}"
start "" "${exePath}"
del "%~f0"
`;
        const batchPath = path.join(exeDir, 'update-restart.bat');
        try {
          fsSync.writeFileSync(batchPath, batchContent);
          console.log('Created restart script:', batchPath);
        } catch (err) {
          console.error('Failed to create restart script:', err);
        }
        
        sendEvent('complete', { 
          success: true, 
          filePath,
          fileName: newFileName,
          exePath,
          batchPath,
          size: downloadedSize,
          sizeText: formatBytes(downloadedSize)
        });
        res.end();
      });

      file.on('error', (err) => {
        fsSync.unlink(filePath, () => {});
        sendEvent('error', { error: err.message });
        res.end();
      });
    });
    
    request.on('error', (err) => {
      fsSync.unlink(filePath, () => {});
      sendEvent('error', { error: err.message });
      res.end();
    });
  };

  downloadWithProgress(downloadUrl);

  // Handle client disconnect
  req.on('close', () => {
    console.log('Download stream closed by client');
  });
});

/**
 * POST /api/update/restart
 * Triggers the restart script to apply the update
 */
app.post('/api/update/restart', (req, res) => {
  const { spawn } = require('child_process');
  const fsSync = require('fs');
  
  const exePath = process.execPath;
  const exeDir = path.dirname(exePath);
  const batchPath = path.join(exeDir, 'update-restart.bat');
  
  if (!fsSync.existsSync(batchPath)) {
    return res.status(400).json({ success: false, error: 'Restart script not found. Please download the update first.' });
  }
  
  console.log('Executing restart script:', batchPath);
  
  // Spawn the batch script detached so it continues after we exit
  const child = spawn('cmd.exe', ['/c', batchPath], {
    detached: true,
    stdio: 'ignore',
    cwd: exeDir
  });
  child.unref();
  
  res.json({ success: true, message: 'Restarting application...' });
  
  // Exit the current process after a short delay
  setTimeout(() => {
    process.exit(0);
  }, 500);
});

// Helper functions for formatting
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (!seconds || seconds === Infinity || isNaN(seconds)) return '--';
  
  if (seconds < 60) {
    return `${Math.floor(seconds)} sec`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins} min ${secs} sec`;
  } else {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs} hr ${mins} min`;
  }
}

/**
 * Download update to user's Downloads folder (legacy, non-streaming)
 * POST /api/update/download
 * Body: { downloadUrl: string }
 */
app.post('/api/update/download', async (req, res) => {
  const { downloadUrl } = req.body;
  
  if (!downloadUrl) {
    return res.status(400).json({ success: false, error: 'No download URL provided' });
  }

  try {
    const https = require('https');
    const http = require('http');
    const os = require('os');
    const fsSync = require('fs');
    
    // Get Downloads folder path
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const fileName = `LocalHost-${Date.now()}.exe`;
    const filePath = path.join(downloadsPath, fileName);
    
    console.log('Downloading update to:', filePath);
    
    const downloadFile = (url, dest) => {
      return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        
        const request = protocol.get(url, (response) => {
          // Handle redirects
          if (response.statusCode === 302 || response.statusCode === 301) {
            return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
          }
          
          if (response.statusCode !== 200) {
            return reject(new Error(`Failed to download: ${response.statusCode}`));
          }
          
          const file = fsSync.createWriteStream(dest);
          response.pipe(file);
          
          file.on('finish', () => {
            file.close();
            resolve(dest);
          });
        });
        
        request.on('error', (err) => {
          fsSync.unlink(dest, () => {});
          reject(err);
        });
      });
    };

    await downloadFile(downloadUrl, filePath);
    
    res.json({ 
      success: true, 
      filePath,
      message: `Update downloaded to ${filePath}` 
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get current app version
 * GET /api/version
 */
app.get('/api/version', (req, res) => {
  res.json({ version: CURRENT_VERSION });
});

/**
 * Open native OS folder picker dialog
 * GET /api/browse-folder
 */
app.get('/api/browse-folder', (req, res) => {
  const { exec } = require('child_process');
  const os = require('os');
  const fsNode = require('fs');

  if (os.platform() === 'win32') {
    // Write to a temp .ps1 file so there are no quote-escaping issues.
    // Use a TopMost helper Form so the dialog always appears in front of the browser.
    const tmpScript = path.join(os.tmpdir(), 'lmb_folder_picker.ps1');
    const psContent = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class Win32Helper {',
      '    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
      '    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
      '}',
      '"@',
      '$h = New-Object System.Windows.Forms.Form',
      '$h.TopMost = $true',
      '$h.ShowInTaskbar = $false',
      '$h.Opacity = 0',
      '$h.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
      '$h.Show()',
      '[Win32Helper]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)',
      '[void][Win32Helper]::SetForegroundWindow($h.Handle)',
      '[Win32Helper]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)',
      '$h.Activate()',
      '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$f.Description = "Select a folder to browse"',
      '$f.ShowNewFolderButton = $false',
      'if ($f.ShowDialog($h) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }',
      '$h.Dispose()',
    ].join('\r\n');

    try { fsNode.writeFileSync(tmpScript, psContent, 'utf8'); } catch (e) {}

    exec(
      `powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "${tmpScript}"`,
      { timeout: 60000 },
      (err, stdout) => {
        try { fsNode.unlinkSync(tmpScript); } catch (e) {}
        const selectedPath = stdout ? stdout.trim() : null;
        res.json({ path: selectedPath || null, cancelled: !selectedPath });
      }
    );
  } else if (os.platform() === 'darwin') {
    exec(`osascript -e 'POSIX path of (choose folder with prompt "Select Folder")'`, { timeout: 60000 }, (err, stdout) => {
      const selectedPath = stdout ? stdout.trim().replace(/\/$/, '') : null;
      res.json({ path: selectedPath || null, cancelled: !selectedPath });
    });
  } else {
    exec(`zenity --file-selection --directory --title="Select Folder" 2>/dev/null`, { timeout: 60000 }, (err, stdout) => {
      const selectedPath = stdout ? stdout.trim() : null;
      res.json({ path: selectedPath || null, cancelled: !selectedPath });
    });
  }
});

/**
 * Global recursive file search
 * GET /api/search?q=query
 */
app.get('/api/search', (req, res) => {
  const { q, max } = req.query;
  if (!q) return res.status(400).json({ error: 'q parameter required' });
  const result = fileController.searchFiles(q, max ? parseInt(max) : 200);
  if (result.success) res.json(result);
  else res.status(400).json(result);
});

/**
 * Generate video thumbnail via FFmpeg
 * GET /api/thumbnail?path=file/path
 */
app.get('/api/thumbnail', (req, res) => {
  const { path: userPath } = req.query;
  if (!userPath) return res.status(400).json({ error: 'path required' });
  if (!ffmpeg) return res.status(503).json({ error: 'FFmpeg not available' });

  const absPath = fileController.getAbsolutePath(userPath);
  if (!absPath) return res.status(400).json({ error: 'Invalid path' });

  const os = require('os');
  const crypto = require('crypto');
  const fsSync = require('fs');
  const hash = crypto.createHash('md5').update(absPath).digest('hex');
  const thumbFile = `lmb_thumb_${hash}.jpg`;
  const thumbPath = path.join(os.tmpdir(), thumbFile);

  const sendThumb = () => {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fsSync.createReadStream(thumbPath).pipe(res);
  };

  if (fsSync.existsSync(thumbPath)) return sendThumb();

  ffmpeg(absPath)
    .screenshots({ count: 1, timemarks: ['00:00:01'], filename: thumbFile, folder: os.tmpdir(), size: '320x?' })
    .on('end', () => fsSync.existsSync(thumbPath) ? sendThumb() : res.status(500).json({ error: 'Thumbnail not created' }))
    .on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
});

// ============ Cloudflare Tunnel API ============
let cloudflaredProcess = null;
let tunnelUrl = null;
let serverPort = null; // Will be set when server starts

/**
 * Verify tunnel password
 * POST /api/tunnel/verify-password
 */
app.post('/api/tunnel/verify-password', (req, res) => {
  const { password } = req.body;
  
  if (password === tunnelPassword) {
    // Generate a session ID
    const crypto = require('crypto');
    const sessionId = crypto.randomBytes(32).toString('hex');
    authenticatedSessions.add(sessionId);
    
    // Set cookie that expires in 24 hours
    res.setHeader('Set-Cookie', `tunnel_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'Incorrect password' });
  }
});

/**
 * Get current tunnel password
 * GET /api/tunnel/password
 */
app.get('/api/tunnel/password', (req, res) => {
  res.json({ success: true, password: tunnelPassword });
});

/**
 * Set tunnel password
 * POST /api/tunnel/password
 */
app.post('/api/tunnel/password', (req, res) => {
  const { password } = req.body;
  
  if (!password || password.length < 1) {
    return res.status(400).json({ success: false, error: 'Password cannot be empty' });
  }
  
  tunnelPassword = password;
  // Clear existing sessions when password changes
  authenticatedSessions.clear();
  res.json({ success: true, message: 'Password updated' });
});

/**
 * Start cloudflared tunnel
 * POST /api/tunnel/start
 */
app.post('/api/tunnel/start', (req, res) => {
  const { password } = req.body;
  
  // Update password if provided
  if (password && password.length > 0) {
    tunnelPassword = password;
    authenticatedSessions.clear();
  }
  
  if (cloudflaredProcess) {
    return res.json({ success: true, url: tunnelUrl, password: tunnelPassword, message: 'Tunnel already running' });
  }

  if (!serverPort) {
    return res.status(500).json({ success: false, error: 'Server port not determined yet' });
  }

  const { spawn } = require('child_process');
  const fsSync = require('fs');
  const os = require('os');
  
  // Determine cloudflared path - extract from bundled exe if running as packaged
  let cloudflaredPath = 'cloudflared';
  
  if (process.pkg) {
    // When running as pkg exe, cloudflared.exe is bundled in the snapshot
    // Extract it to temp directory on first use
    const tempDir = path.join(os.tmpdir(), 'localhost-media-browser');
    const extractedPath = path.join(tempDir, 'cloudflared.exe');
    const snapshotPath = path.join(__dirname, '..', 'cloudflared.exe');
    
    try {
      // Create temp directory if needed
      if (!fsSync.existsSync(tempDir)) {
        fsSync.mkdirSync(tempDir, { recursive: true });
      }
      
      // Extract cloudflared.exe from snapshot if not already extracted or outdated
      if (!fsSync.existsSync(extractedPath)) {
        console.log('Extracting bundled cloudflared.exe...');
        const data = fsSync.readFileSync(snapshotPath);
        fsSync.writeFileSync(extractedPath, data);
        console.log('Extracted to:', extractedPath);
      }
      
      cloudflaredPath = extractedPath;
    } catch (e) {
      console.log('Could not extract bundled cloudflared:', e.message);
      console.log('Falling back to system PATH');
    }
  } else {
    // Development mode - check project root
    const devPath = path.join(__dirname, '..', 'cloudflared.exe');
    if (fsSync.existsSync(devPath)) {
      cloudflaredPath = devPath;
    }
  }

  try {
    // Start cloudflared with quick-tunnel (no account needed)
    cloudflaredProcess = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${serverPort}`, '--protocol', 'http2'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let urlFound = false;
    const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

    const handleOutput = (data) => {
      const output = data.toString();
      console.log('[cloudflared]', output);
      
      if (!urlFound) {
        const match = output.match(urlRegex);
        if (match) {
          urlFound = true;
          tunnelUrl = match[0];
          console.log(`✓ Cloudflare Tunnel ready: ${tunnelUrl}`);
        }
      }
    };

    cloudflaredProcess.stdout.on('data', handleOutput);
    cloudflaredProcess.stderr.on('data', handleOutput);

    cloudflaredProcess.on('error', (err) => {
      console.error('cloudflared error:', err.message);
      cloudflaredProcess = null;
      tunnelUrl = null;
    });

    cloudflaredProcess.on('close', (code) => {
      console.log(`cloudflared exited with code ${code}`);
      cloudflaredProcess = null;
      tunnelUrl = null;
    });

    // Wait for tunnel URL to be available (poll for up to 30 seconds)
    let attempts = 0;
    const maxAttempts = 60;
    const checkUrl = () => {
      attempts++;
      if (tunnelUrl) {
        res.json({ success: true, url: tunnelUrl, password: tunnelPassword });
      } else if (attempts >= maxAttempts) {
        // Timeout - check if process is still running
        if (cloudflaredProcess) {
          res.status(500).json({ 
            success: false, 
            error: 'Timeout waiting for tunnel URL. Make sure cloudflared is installed.' 
          });
        } else {
          res.status(500).json({ 
            success: false, 
            error: 'cloudflared process failed to start. Make sure it is installed and in PATH.' 
          });
        }
      } else {
        setTimeout(checkUrl, 500);
      }
    };
    checkUrl();

  } catch (err) {
    cloudflaredProcess = null;
    res.status(500).json({ 
      success: false, 
      error: 'Failed to start cloudflared: ' + err.message 
    });
  }
});

/**
 * Stop cloudflared tunnel
 * POST /api/tunnel/stop
 */
app.post('/api/tunnel/stop', (req, res) => {
  if (cloudflaredProcess) {
    try {
      // On Windows, we need to kill the process tree
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        exec(`taskkill /pid ${cloudflaredProcess.pid} /T /F`, (err) => {
          cloudflaredProcess = null;
          tunnelUrl = null;
          res.json({ success: true, message: 'Tunnel stopped' });
        });
      } else {
        cloudflaredProcess.kill('SIGTERM');
        cloudflaredProcess = null;
        tunnelUrl = null;
        res.json({ success: true, message: 'Tunnel stopped' });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  } else {
    res.json({ success: true, message: 'No tunnel running' });
  }
});

/**
 * Get tunnel status
 * GET /api/tunnel/status
 */
app.get('/api/tunnel/status', (req, res) => {
  res.json({
    running: !!cloudflaredProcess,
    url: tunnelUrl,
    password: tunnelPassword
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error'
  });
});

// Start server — try 3000, then 8876, then let the OS pick a free port (0)
function startServer(portsToTry) {
  const port = portsToTry[0];
  const rest  = portsToTry.slice(1);

  const server = app.listen(port, () => {
    const actualPort = server.address().port;
    serverPort = actualPort; // Store for cloudflared tunnel
    console.log(`\n🚀 Local Media Browser Server`);
    console.log(`📍 Running on http://localhost:${actualPort}`);
    console.log(`\n📝 Navigate to http://localhost:${actualPort} in your browser`);
    console.log(`\n⚠️  No root directory set. Use the UI to select a folder.`);
    console.log('(Close this window to stop the server.)\n');

// Automatically open the default browser to the app URL on startup.
    const { exec } = require('child_process');
    const url = `http://localhost:${actualPort}`;
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (rest.length > 0) {
        console.log(`⚠ Port ${port} in use, trying ${rest[0] || 'random'}...`);
        startServer(rest);
      } else {
        console.error(`\n❌ Could not find a free port.`);
        pauseAndExit(1);
      }
    } else {
      console.error('\n❌ Server error:', err.message);
      pauseAndExit(1);
    }
  });
}

const PORTS = process.env.PORT
  ? [parseInt(process.env.PORT)]
  : [3000, 8876, 0]; // 0 = OS assigns a random free port

startServer(PORTS);
