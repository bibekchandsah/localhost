const path = require('path');
const fs = require('fs');

/**
 * Sanitize and validate file path to prevent directory traversal
 * @param {string} rootDir - The root directory users can browse
 * @param {string} userPath - User-provided relative path
 * @returns {Object} {valid: boolean, resolvedPath: string, error: string}
 */
function sanitizePath(rootDir, userPath = '') {
  try {
    // Normalize the root directory
    const normalizedRoot = path.normalize(rootDir);
    
    // If no user path, return root
    if (!userPath || userPath === '' || userPath === '/') {
      return {
        valid: true,
        resolvedPath: normalizedRoot,
        error: null
      };
    }

    // Normalize the user path
    let normalizedUser = path.normalize(userPath);
    
    // Remove leading slashes
    normalizedUser = normalizedUser.replace(/^[\/\\]+/, '');

    // Resolve the full path
    const fullPath = path.resolve(normalizedRoot, normalizedUser);

    // Check if resolved path is still within root directory
    if (!fullPath.startsWith(normalizedRoot)) {
      return {
        valid: false,
        resolvedPath: null,
        error: 'Path traversal attempt detected'
      };
    }

    return {
      valid: true,
      resolvedPath: fullPath,
      error: null
    };
  } catch (err) {
    return {
      valid: false,
      resolvedPath: null,
      error: err.message
    };
  }
}

/**
 * Check if a path exists and is accessible
 * @param {string} filePath - Path to check
 * @returns {boolean}
 */
function pathExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Get relative path from root
 * @param {string} rootDir - Root directory
 * @param {string} fullPath - Full file path
 * @returns {string} Relative path
 */
function getRelativePath(rootDir, fullPath) {
  const normalizedRoot = path.normalize(rootDir);
  const normalizedPath = path.normalize(fullPath);
  let relative = path.relative(normalizedRoot, normalizedPath);
  
  // Convert Windows backslashes to forward slashes for consistency
  return relative.replace(/\\/g, '/');
}

/**
 * Format bytes to human-readable size
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted size string
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get file extension
 * @param {string} filename - File name
 * @returns {string} Extension without dot
 */
function getFileExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ext ? ext.substring(1) : '';
}

/**
 * Check if file is a video
 * @param {string} ext - File extension
 * @returns {boolean}
 */
function isVideoFile(ext) {
  const videoExts = ['ts', 'mp4', 'mkv', 'webm', 'mov', 'avi', 'm3u8'];
  return videoExts.includes(ext.toLowerCase());
}

/**
 * Check if file is audio
 * @param {string} ext - File extension
 * @returns {boolean}
 */
function isAudioFile(ext) {
  const audioExts = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'];
  return audioExts.includes(ext.toLowerCase());
}

/**
 * Check if file is image
 * @param {string} ext - File extension
 * @returns {boolean}
 */
function isImageFile(ext) {
  const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'];
  return imageExts.includes(ext.toLowerCase());
}

/**
 * Check if file is text/code
 * @param {string} ext - File extension
 * @returns {boolean}
 */
function isTextFile(ext) {
  const textExts = ['txt', 'js', 'json', 'html', 'css', 'md', 'py', 'java', 'cpp', 'c', 'xml', 'yaml', 'yml', 'csv'];
  return textExts.includes(ext.toLowerCase());
}

/**
 * Check if file is a PDF
 * @param {string} ext - File extension
 * @returns {boolean}
 */
function isPdfFile(ext) {
  return ext.toLowerCase() === 'pdf';
}

module.exports = {
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
};
