# 🎬 Local Media Browser

A fully functional local web-based file explorer and media player. Browse your local files, preview videos, audio, images, and text files—all without uploading data anywhere.

## ✨ Features

- ✅ **Local File Browser** - Browse directories on your PC
- ✅ **Video Playback** - Support for .ts, .mp4, .mkv, .webm, .mov, .avi, .m3u8
- ✅ **Audio Player** - Play .mp3, .wav, .aac, .flac, .ogg, .m4a
- ✅ **Image Preview** - View .jpg, .png, .webp, .gif, .bmp, .svg
- ✅ **Text Viewer** - Display .txt, .js, .json, .html, .css, and more
- ✅ **HTTP Range Requests** - Stream large files without loading fully into memory
- ✅ **Grid/List View** - Toggle between different viewing modes
- ✅ **Search & Filter** - Find files instantly as you type
- ✅ **Sort Options** - Sort by name, size, or date modified
- ✅ **Dark Mode** - Easy on the eyes
- ✅ **Breadcrumb Navigation** - Easy navigation through folders
- ✅ **Keyboard Shortcuts** - Increase productivity
- ✅ **Fully Local** - No internet required after startup
- ✅ **Security** - Path traversal protection, input sanitization

## 🛠️ Installation

### Prerequisites

- **Node.js** (v14 or later)
- **npm** (comes with Node.js)

### Setup

1. **Clone/Download** the project:
   ```bash
   cd "d:\programming exercise\HTML\self host"
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

   This installs:
   - `express` - Web framework
   - `cors` - Cross-origin requests
   - `mime-types` - MIME type detection

## 🚀 Running the Application

1. **Start the server**:
   ```bash
   npm start
   ```

   Or:
   ```bash
   node server/server.js
   ```

2. **Open in browser**:
   ```
   http://localhost:3000
   ```

3. **Select a folder** to start browsing:
   - Click the "📁 Select Folder" button
   - Enter a folder path (e.g., `D:\Videos`, `/home/user/Music`)
   - Click "✓ Open"

## 📖 Usage Guide

### Browsing Files

- **Navigate folders** - Click on any folder to open it
- **Go back** - Use the ← arrow button or press `Backspace`
- **Use breadcrumbs** - Click any part of the path to jump to that folder
- **Search** - Type in the search box to filter files (`Ctrl+K` for quick focus)

### Playing Media

- **Videos** - Double-click to play in the media player
  - Supports .ts files with HLS.js
  - Use standard HTML5 controls (play, pause, seek, volume)
  - Space bar to play/pause
  - Arrow keys to seek (when focused)

- **Audio** - Double-click to play audio files
  - Supports .mp3, .wav, .aac, .flac, .ogg, .m4a
  - Standard HTML5 audio controls

- **Images** - Double-click to view in full-screen preview
  - Supports .jpg, .png, .webp, .gif, .bmp, .svg
  - Click outside or press `Esc` to close

### Viewing Files

- **Text Files** - Double-click to view content
  - Supports .txt, .js, .json, .html, .css, .md, .py, .java, .cpp, etc.
  - Download option available in the modal
  - Max 1MB per file (for performance)

- **Other Files** - Double-click to download
  - File will be saved to your Downloads folder

### Customization

- **View Mode** - Toggle between grid (⊞) and list (≡) views
- **Sort** - Choose to sort by Name, Size, or Date Modified
- **Dark Mode** - Click the moon icon (🌙) in the header
- **Settings preserved** - View mode and dark mode are saved in localStorage

## 🎮 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` or `Cmd+K` | Focus search box |
| `Backspace` | Go back to parent folder |
| `Esc` | Close modals/player |
| `Space` | Play/pause video (when player is focused) |

## 🏗️ Project Structure

```
local-media-browser/
├── server/
│   ├── server.js              # Main Express server
│   ├── fileController.js      # File operations logic
│   └── utils.js               # Path sanitization & helpers
├── client/
│   ├── index.html             # Frontend HTML
│   ├── app.js                 # Frontend JavaScript (550+ lines)
│   └── styles.css             # Complete styling
├── package.json               # Dependencies
├── instructions.md            # Original requirements
└── README.md                  # This file
```

## 🔒 Security Features

- **Path Traversal Prevention** - Cannot access files outside root directory
- **Input Sanitization** - All user input is validated and normalized
- **Error Handling** - Graceful error messages without exposing system info
- **No Data Upload** - Everything runs locally on your machine
- **CORS Enabled** - Only local requests accepted

## 📊 File Type Support

### Video Files
- `.ts` (MPEG-TS video)
- `.mp4` (MPEG-4 video)
- `.mkv` (Matroska)
- `.webm` (WebM)
- `.mov` (QuickTime)
- `.avi` (Audio Video Interleave)
- `.m3u8` (HLS playlist)

### Audio Files
- `.mp3` (MPEG Audio)
- `.wav` (WAV Audio)
- `.aac` (Advanced Audio Coding)
- `.flac` (FLAC Audio)
- `.ogg` (Ogg Vorbis)
- `.m4a` (MPEG-4 Audio)

### Image Files
- `.jpg` / `.jpeg` (JPEG)
- `.png` (PNG)
- `.webp` (WebP)
- `.gif` (GIF)
- `.bmp` (Bitmap)
- `.svg` (SVG)

### Text/Code Files
- `.txt` (Plain text)
- `.js` (JavaScript)
- `.json` (JSON)
- `.html` (HTML)
- `.css` (CSS)
- `.md` (Markdown)
- `.py` (Python)
- `.java` (Java)
- `.cpp` / `.c` (C/C++)
- `.xml` (XML)
- `.yaml` / `.yml` (YAML)
- `.csv` (CSV)

## 🎯 Performance Optimizations

1. **HTTP Range Requests** - Stream large files efficiently
2. **Lazy Loading** - Files are only read when accessed
3. **Memory Efficient** - No preloading of entire directories
4. **Optimized Rendering** - Virtual scrolling for large file lists
5. **Caching** - Browser and server caching strategies

## 🧪 Testing

### Test with:
- ✓ 1GB+ video files
- ✓ Nested folders (10+ levels)
- ✓ Filenames with special characters
- ✓ 1000+ files in one directory
- ✓ Seeking in large video files
- ✓ Rapid navigation changes

## 🐛 Troubleshooting

### "Cannot find module" error
```bash
npm install
```

### Port 3000 already in use
```bash
# Use a different port
PORT=3001 npm start
# Then open http://localhost:3001
```

### Videos won't play
- Check if the browser supports the video codec
- Try a different browser (Chrome, Firefox, Edge)
- Ensure the file path is correct

### Files not showing
- Make sure the folder path exists
- Check that you have read permissions
- Try a known folder like your Documents or Videos

### Dark mode not saving
- Check if localStorage is enabled in browser
- Try clearing browser cache and refreshing

## 📋 API Endpoints

All endpoints are fully implemented in `server/server.js`:

### File Operations
- `POST /api/set-root` - Set root directory
- `GET /api/root` - Get current root directory
- `GET /api/files?path=...` - List files in directory
- `GET /api/file-stats?path=...` - Get file information
- `GET /api/read-text?path=...` - Read text file content

### Media Streaming
- `GET /api/stream?path=...` - Stream file with range support
- `GET /api/download?path=...` - Download file

### Health Check
- `GET /api/health` - Server health check

## 🔧 Development

### To extend the player:

1. **Add new file type** in `server/utils.js`:
   ```javascript
   function isNewFileType(ext) {
     return ['ext1', 'ext2'].includes(ext.toLowerCase());
   }
   ```

2. **Handle in frontend** `app.js`:
   ```javascript
   else if (file.category === 'newtype') {
     this.handleNewType(file);
   }
   ```

### To modify the UI:

- Edit `client/styles.css` for styling
- Modify `client/index.html` for layout
- Update `client/app.js` for functionality

## 📝 License

Open source. Feel free to modify and distribute.

## 💡 Tips & Tricks

1. **Keyboard Navigation** - Use arrow keys in the file list to select
2. **Fullscreen Video** - Double-click the video player for fullscreen
3. **Remember Settings** - Your view mode and theme preference are saved
4. **Large Folders** - Use search to quickly find files in folders with 1000+ items
5. **HLS Streaming** - Supports adaptive bitrate streaming with HLS.js

## 🚀 Future Enhancements

- Video thumbnail preview
- Playlist support
- Playback speed control
- Subtitle support
- File compression support
- Recent files tracking
- Favorites system

---

**Built with ❤️ using Node.js, Express, and Vanilla JavaScript**
