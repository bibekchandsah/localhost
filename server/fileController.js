const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const {
  sanitizePath,
  pathExists,
  getRelativePath,
  formatFileSize,
  getFileExtension,
  isVideoFile,
  isAudioFile,
  isImageFile,
  isTextFile,
  isPdfFile
} = require('./utils');

class FileController {
  constructor() {
    this.rootDir = null;
  }

  /**
   * Set the root directory for browsing
   * @param {string} dirPath - Directory path
   * @returns {Object} {success: boolean, message: string}
   */
  setRootDirectory(dirPath) {
    try {
      const normalizedPath = path.normalize(dirPath);
      
      if (!fs.existsSync(normalizedPath)) {
        return {
          success: false,
          message: 'Directory does not exist'
        };
      }

      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          message: 'Path is not a directory'
        };
      }

      this.rootDir = normalizedPath;
      return {
        success: true,
        message: 'Root directory set successfully',
        rootDir: this.rootDir
      };
    } catch (err) {
      return {
        success: false,
        message: err.message
      };
    }
  }

  /**
   * Get current root directory
   */
  getRootDirectory() {
    return this.rootDir;
  }

  /**
   * List files in a directory
   * @param {string} userPath - Relative path from root
   * @returns {Object} {success: boolean, files: Array, currentPath: string, error?: string}
   */
  listFiles(userPath = '') {
    try {
      if (!this.rootDir) {
        return {
          success: false,
          error: 'Root directory not set'
        };
      }

      // Sanitize the path
      const sanitized = sanitizePath(this.rootDir, userPath);
      if (!sanitized.valid) {
        return {
          success: false,
          error: sanitized.error
        };
      }

      const targetPath = sanitized.resolvedPath;

      // Check if path exists
      if (!pathExists(targetPath)) {
        return {
          success: false,
          error: 'Path does not exist'
        };
      }

      // Check if it's a directory
      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          error: 'Path is not a directory'
        };
      }

      // Read directory contents
      const entries = fs.readdirSync(targetPath, { withFileTypes: true });
      const files = [];

      for (const entry of entries) {
        try {
          const fullPath = path.join(targetPath, entry.name);
          const entryStats = fs.statSync(fullPath);

          const fileObj = {
            name: entry.name,
            type: entry.isDirectory() ? 'folder' : 'file',
            size: entryStats.size,
            modified: entryStats.mtime.getTime()
          };

          if (entry.isFile()) {
            const ext = getFileExtension(entry.name);
            fileObj.ext = ext;
            let mimeType = mime.lookup(entry.name) || 'application/octet-stream';
            // Force correct MIME type for .ts files
            if (ext.toLowerCase() === 'ts') {
              mimeType = 'video/mp2t';
            }
            fileObj.mime = mimeType;

            // Add file category
            if (isVideoFile(ext)) {
              fileObj.category = 'video';
            } else if (isAudioFile(ext)) {
              fileObj.category = 'audio';
            } else if (isImageFile(ext)) {
              fileObj.category = 'image';
            } else if (isPdfFile(ext)) {
              fileObj.category = 'pdf';
            } else if (isTextFile(ext)) {
              fileObj.category = 'text';
            } else {
              fileObj.category = 'other';
            }
          }

          files.push(fileObj);
        } catch (err) {
          // Skip files that can't be accessed
          console.error(`Error reading file ${entry.name}:`, err.message);
        }
      }

      // Sort: folders first, then by name
      files.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      const relPath = getRelativePath(this.rootDir, targetPath);

      return {
        success: true,
        files: files,
        currentPath: relPath === '.' ? '' : relPath
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Stream a file with support for HTTP Range requests
   * @param {string} userPath - Relative path from root
   * @param {number} start - Start byte (for range requests)
   * @param {number} end - End byte (for range requests)
   * @returns {Object} {success: boolean, stream?: Stream, mime?: string, size?: number, ...}
   */
  streamFile(userPath, start = null, end = null) {
    try {
      if (!this.rootDir) {
        return {
          success: false,
          error: 'Root directory not set'
        };
      }

      // Sanitize the path
      const sanitized = sanitizePath(this.rootDir, userPath);
      if (!sanitized.valid) {
        return {
          success: false,
          error: sanitized.error
        };
      }

      const filePath = sanitized.resolvedPath;

      // Check if file exists
      if (!pathExists(filePath)) {
        return {
          success: false,
          error: 'File not found'
        };
      }

      // Check if it's a file
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: 'Path is not a file'
        };
      }

      const fileSize = stats.size;
      let mimeType = mime.lookup(filePath) || 'application/octet-stream';
      
      // Force correct MIME type for .ts files
      const ext = getFileExtension(path.basename(filePath)).toLowerCase();
      if (ext === 'ts') {
        mimeType = 'video/mp2t';
      }

      // Handle range request
      let rangeStart = 0;
      let rangeEnd = fileSize - 1;

      if (start !== null && end !== null) {
        rangeStart = Math.max(0, parseInt(start));
        rangeEnd = Math.min(fileSize - 1, parseInt(end));
      } else if (start !== null) {
        rangeStart = Math.max(0, parseInt(start));
      } else if (end !== null) {
        rangeEnd = Math.min(fileSize - 1, parseInt(end));
      }

      // Validate range
      if (rangeStart > rangeEnd || rangeStart >= fileSize) {
        return {
          success: false,
          error: 'Invalid range'
        };
      }

      const stream = fs.createReadStream(filePath, {
        start: rangeStart,
        end: rangeEnd
      });

      return {
        success: true,
        stream: stream,
        mime: mimeType,
        size: fileSize,
        rangeStart: rangeStart,
        rangeEnd: rangeEnd,
        contentLength: rangeEnd - rangeStart + 1,
        isRange: start !== null || end !== null
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Get file stats
   * @param {string} userPath - Relative path from root
   * @returns {Object} File information
   */
  getFileStats(userPath) {
    try {
      if (!this.rootDir) {
        return {
          success: false,
          error: 'Root directory not set'
        };
      }

      const sanitized = sanitizePath(this.rootDir, userPath);
      if (!sanitized.valid) {
        return {
          success: false,
          error: sanitized.error
        };
      }

      const filePath = sanitized.resolvedPath;

      if (!pathExists(filePath)) {
        return {
          success: false,
          error: 'File not found'
        };
      }

      const stats = fs.statSync(filePath);
      const ext = getFileExtension(path.basename(filePath));

      return {
        success: true,
        name: path.basename(filePath),
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size),
        created: stats.birthtime.getTime(),
        modified: stats.mtime.getTime(),
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        mime: mime.lookup(filePath) || 'application/octet-stream',
        ext: ext
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Read text file content
   * @param {string} userPath - Relative path from root
   * @param {number} maxSize - Maximum size to read in bytes
   * @returns {Object} File content
   */
  readTextFile(userPath, maxSize = 1048576) { // 1MB default
    try {
      if (!this.rootDir) {
        return {
          success: false,
          error: 'Root directory not set'
        };
      }

      const sanitized = sanitizePath(this.rootDir, userPath);
      if (!sanitized.valid) {
        return {
          success: false,
          error: sanitized.error
        };
      }

      const filePath = sanitized.resolvedPath;

      if (!pathExists(filePath)) {
        return {
          success: false,
          error: 'File not found'
        };
      }

      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: 'Path is not a file'
        };
      }

      if (stats.size > maxSize) {
        return {
          success: false,
          error: `File too large. Maximum size: ${formatFileSize(maxSize)}`
        };
      }

      const content = fs.readFileSync(filePath, 'utf8');

      return {
        success: true,
        content: content,
        size: stats.size
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }
  /**
   * Recursively search for files matching a query across all subfolders.
   * @param {string} query - Search term
   * @param {number} maxResults - Maximum results to return
   */
  searchFiles(query, maxResults = 200) {
    if (!this.rootDir) return { success: false, error: 'Root directory not set' };
    if (!query || !query.trim()) return { success: false, error: 'Query required' };

    const lowerQuery = query.trim().toLowerCase();
    const results = [];

    const walk = (dir, relBase) => {
      if (results.length >= maxResults) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const fullPath = path.join(dir, entry.name);
        const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(fullPath, relPath);
        } else if (entry.isFile() && entry.name.toLowerCase().includes(lowerQuery)) {
          try {
            const stats = fs.statSync(fullPath);
            const ext = getFileExtension(entry.name);
            let category = 'other';
            if (isVideoFile(ext)) category = 'video';
            else if (isAudioFile(ext)) category = 'audio';
            else if (isImageFile(ext)) category = 'image';
            else if (isPdfFile(ext)) category = 'pdf';
            else if (isTextFile(ext)) category = 'text';
            results.push({
              name: entry.name,
              relPath,
              folderPath: relBase || '',
              type: 'file',
              ext,
              category,
              size: stats.size,
              modified: stats.mtime.getTime()
            });
          } catch { /* skip */ }
        }
      }
    };

    walk(this.rootDir, '');
    return { success: true, results, truncated: results.length >= maxResults };
  }

  /**
   * Get the absolute filesystem path for a user-provided relative path.
   * Used for server-side operations like thumbnail generation.
   */
  getAbsolutePath(userPath) {
    if (!this.rootDir) return null;
    const sanitized = sanitizePath(this.rootDir, userPath);
    if (!sanitized.valid) return null;
    return sanitized.resolvedPath;
  }
}

// Export as singleton
module.exports = new FileController();
