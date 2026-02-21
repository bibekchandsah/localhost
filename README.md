# 🖥️ Local Media Browser + Canvas

A fully local web app combining a **file explorer / media player** and a **full-featured canvas drawing tool** — no internet required after startup, nothing uploaded anywhere.

---

## ✨ Features

### 📁 File Browser
- **Directory browsing** — navigate any folder on your PC
- **Breadcrumb navigation** — click any segment to jump up the tree
- **Search & filter** — instant filtering as you type (`Ctrl+K` to focus)
- **Sort options** — by name, size, or date modified
- **Grid / List view** — toggle between compact grid and detailed list
- **Dark mode** — theme preference saved in localStorage

### 🎬 Media Player
- **Video** — `.ts`, `.mp4`, `.mkv`, `.webm`, `.mov`, `.avi`, `.m3u8`
  - HTTP range requests — stream large files without full load
  - HLS adaptive streaming via HLS.js
- **Audio** — `.mp3`, `.wav`, `.aac`, `.flac`, `.ogg`, `.m4a`
- **Image preview** — `.jpg`, `.png`, `.webp`, `.gif`, `.bmp`, `.svg`
- **Text / code viewer** — `.txt`, `.js`, `.json`, `.html`, `.css`, `.md`, `.py`, `.java`, `.cpp`, `.xml`, `.yaml`, `.csv`
- **Download** — any file type can be downloaded directly

### 🎨 Canvas Drawing Tool (`/canvas.html`)

#### Drawing Tools
| Tool | Shortcut | Description |
|------|----------|-------------|
| Select / Move | `V` | Click to select, drag to move |
| Pencil | `P` | Freehand thin line |
| Brush | `B` | Soft freehand stroke with glow |
| Marker | `M` | Semi-transparent freehand stroke |
| Eraser | `E` | Erase freehand strokes |
| Text | `T` | Click anywhere to place editable text |

#### Shape Tools (24 shapes in flyout grid)
**Basic:** Line `L`, Rectangle `R`, Ellipse `C`, Polygon `G`, Arrow `A`, Pill, Diamond, Parallelogram

**Quads:** Trapezoid, Inverted Trapezoid, Cross, Pincushion Frame

**Organic:** Heart, Cloud, Speech Bubble, Oval Speech Bubble, Bookmark, Ribbon

**Structural:** Arch (door), D-shape (stadium)

**Stars:** Star *(N-pointed via Sides slider)*, Starburst / Seal *(N-pointed via Sides slider)*

**Polygons:** Triangle, Hexagon

#### Selection & Transform
- **Click** to select a single object
- **Marquee / rubber-band** — drag blank canvas to select multiple objects
- **Drag** selected objects to move
- **8 resize handles** — drag corner/edge handles to resize; hold `Shift` to lock aspect ratio
- **Rotation handle** — drag the circular handle above selection to rotate freely
- **Multi-select resize & rotate** — resize/rotate a whole group of objects together
- **Group** (`Ctrl+G`) — combine selected objects into a single group
- **Ungroup** (`Ctrl+Shift+G`) — break a group apart

#### Property Controls
- **Size** slider (1–80) — stroke / outline thickness; mouse-wheel supported
- **Opacity** slider (10–100 %) — object transparency; mouse-wheel supported
- **Rounding** slider (0–100) — corner radius for rect, polygon, triangle, hexagon, star, starburst; mouse-wheel supported
- **Sides** slider (3–20) — vertex count for polygon, triangle, hexagon, star, starburst; mouse-wheel supported
- All four sliders also respond to **mouse-wheel** scroll (hold `Shift` for 5× speed)
- **Fill toggle** — filled vs. outline-only shapes
- **Live update** — moving a slider immediately re-renders the selected object(s)

#### Colour & Background
- **Colour swatch** — click to open colour picker (supports hex + 12 preset swatches)
- **Palette** — 12-colour quick-pick strip; hover for expanded palette
- **Background colour** — pick any colour for the canvas background
- **Background eye toggle** — hide background for a transparent canvas; PNG export respects transparency
- **Shift-constrain drawing** — hold `Shift` while drawing to force perfect square / circle

#### History & Export
- **Undo** `Ctrl+Z` (50 levels)
- **Redo** `Ctrl+Y`
- **Clear canvas** — with confirmation
- **Save PNG** `Ctrl+S` — exports to a timestamped PNG; uses background colour or transparent if background hidden

#### Keyboard Shortcuts (Canvas)
| Shortcut | Action |
|----------|--------|
| `V` | Select tool |
| `P` | Pencil |
| `B` | Brush |
| `M` | Marker |
| `E` | Eraser |
| `T` | Text |
| `R` | Rectangle |
| `C` | Ellipse |
| `L` | Line |
| `A` | Arrow |
| `G` | Polygon |
| `Ctrl+G` | Group selection |
| `Ctrl+Shift+G` | Ungroup |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+S` | Save PNG |
| `Delete` / `Backspace` | Delete selected objects |
| `Shift` (hold while drawing) | Constrain to square / circle |
| `Shift` (hold while resizing) | Lock aspect ratio |

---

## 🛠️ Installation

### Prerequisites
- **Node.js** v14 or later
- **npm** (bundled with Node.js)

### Setup
```bash
cd "d:\programming exercise\HTML\self host"
npm install
```

Dependencies installed: `express`, `cors`, `mime-types`

---

## 🚀 Running

```bash
npm start
# or
node server/server.js
```

Open **http://localhost:3000** in your browser.

To use a different port:
```bash
PORT=3001 node server/server.js
```

---

## 📖 Usage

### File Browser
1. Click **📁 Select Folder** and enter a local path (e.g. `D:\Videos`)
2. Click **✓ Open**
3. Navigate folders, search, sort, and preview media

### Canvas
1. Open **http://localhost:3000/canvas.html**
2. Pick a draw/shape tool from the toolbar flyouts
3. Draw on the canvas; use the property sliders to adjust thickness, opacity, rounding, and sides
4. Select objects with `V` to move, resize, or rotate them
5. Export with `Ctrl+S`

---

## 🏗️ Project Structure

```
├── server/
│   ├── server.js          # Express server + API routes
│   ├── fileController.js  # File system operations
│   └── utils.js           # Path sanitization & helpers
├── client/
│   ├── index.html         # File browser UI
│   ├── app.js             # File browser logic (~2000 lines)
│   ├── styles.css         # File browser styles
│   ├── canvas.html        # Canvas drawing app
│   ├── canvas.js          # Canvas engine (~2600 lines)
│   ├── canvas.css         # Canvas styles
│   └── favicon/           # Icons & manifest
├── package.json
└── README.md
```

---

## 📋 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/set-root` | Set root directory |
| `GET` | `/api/root` | Get current root (returns `null` if unset) |
| `GET` | `/api/files?path=` | List directory contents |
| `GET` | `/api/file-stats?path=` | Get file metadata |
| `GET` | `/api/read-text?path=` | Read text file content |
| `GET` | `/api/stream?path=` | Stream file (range requests supported) |
| `GET` | `/api/download?path=` | Download file |
| `GET` | `/api/health` | Server health check |

---

## 🔒 Security

- Path traversal prevention — cannot access files outside root directory
- All user input validated and normalised
- Errors returned without exposing system information
- No data is uploaded or sent anywhere

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot find module` | Run `npm install` |
| Port 3000 in use | `PORT=3001 npm start` → open `http://localhost:3001` |
| Video won't play | Try Chrome/Firefox; check codec support |
| Files not showing | Check folder path exists and you have read permission |
| Canvas blank on load | Hard-refresh (`Ctrl+Shift+R`) to clear cached JS |

---

**Built with Node.js, Express, and Vanilla JavaScript**


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
