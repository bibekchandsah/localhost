const express = require('express');
const cors = require('cors');
const path = require('path');
const fileController = require('./fileController');

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
