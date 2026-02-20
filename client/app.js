/**
 * Local Media Browser - Frontend Application
 */

class MediaBrowser {
  constructor() {
    this.rootDir = null;
    this.currentPath = '';
    this.files = [];
    this.viewMode = 'grid';
    this.sortBy = 'name';
    this.searchQuery = '';
    this.folderHistory = [];
    this.hlsInstances = new Map();
    this.isDarkMode = this.loadDarkMode();
    this.pdfDoc = null;
    this.pdfCurrentPage = 1;
    this.pdfTotalPages = 1;
    this.isToolboxOpen = false;
    this.isNotesOpen = false;
    this.isBlurred = false;
    this.pinnedFolders = this.loadPinnedFolders();
    this.settings = this.loadSettings();

    this.initializeUI();
    this.setupEventListeners();
    this.checkRootDirectory();
    this.applyDarkMode();
    this.loadNotesFromStorage();
    this.renderPinnedFolders();
    this.applySettings();
  }

  // ============ Initialization ============

  initializeUI() {
    this.elements = {
      // Buttons
      setRootBtn: document.getElementById('setRootBtn'),
      browseFolderBtn: document.getElementById('browseFolderBtn'),
      sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
      sidebar: document.querySelector('.sidebar'),
      darkModeBtn: document.getElementById('darkModeBtn'),
      gridViewBtn: document.getElementById('gridViewBtn'),
      listViewBtn: document.getElementById('listViewBtn'),
      closePlayerBtn: document.getElementById('closePlayerBtn'),
      closeImageBtn: document.getElementById('closeImageBtn'),
      closeTextBtn: document.getElementById('closeTextBtn'),
      confirmRootBtn: document.getElementById('confirmRootBtn'),
      cancelRootBtn: document.getElementById('cancelRootBtn'),
      downloadTextBtn: document.getElementById('downloadTextBtn'),

      // PDF Modal
      pdfModal: document.getElementById('pdfModal'),
      pdfFileName: document.getElementById('pdfFileName'),
      pdfContainer: document.getElementById('pdfContainer'),
      pdfPageInfo: document.getElementById('pdfPageInfo'),
      pdfPrevBtn: document.getElementById('pdfPrevBtn'),
      pdfNextBtn: document.getElementById('pdfNextBtn'),
      closePdfBtn: document.getElementById('closePdfBtn'),
      pdfPageControls: document.getElementById('pdfPageControls'),

      // Inputs
      searchInput: document.getElementById('searchInput'),
      sortBy: document.getElementById('sortBy'),
      folderPath: document.getElementById('folderPath'),

      // Containers
      fileContainer: document.getElementById('fileContainer'),
      folderTree: document.getElementById('folderTree'),
      breadcrumb: document.getElementById('breadcrumb'),
      mediaPlayer: document.getElementById('mediaPlayer'),
      videoPlayer: document.getElementById('videoPlayer'),
      audioPlayer: document.getElementById('audioPlayer'),
      playerTitle: document.getElementById('playerTitle'),

      // Modals
      folderModal: document.getElementById('folderModal'),
      imageModal: document.getElementById('imageModal'),
      textModal: document.getElementById('textModal'),
      csvModal: document.getElementById('csvModal'),
      urlInputModal: document.getElementById('urlInputModal'),
      urlViewerModal: document.getElementById('urlViewerModal'),
      urlInput: document.getElementById('urlInput'),
      urlViewerFrame: document.getElementById('urlViewerFrame'),
      urlViewerAddress: document.getElementById('urlViewerAddress'),

      // States
      emptyState: document.getElementById('emptyState'),
      loadingState: document.getElementById('loadingState'),

      // Info
      rootInfo: document.getElementById('rootInfo'),
      rootPath: document.getElementById('rootPath'),

      // Toolbox
      toolboxBtn: document.getElementById('toolboxBtn'),
      toolboxMenu: document.getElementById('toolboxMenu'),
      toolboxNotesBtn: document.getElementById('toolboxNotesBtn'),
      toolboxBlurBtn: document.getElementById('toolboxBlurBtn'),
      toolboxContainerBtn: document.getElementById('toolboxContainerBtn'),
      notesPanel: document.getElementById('notesPanel'),
      notesTextarea: document.getElementById('notesTextarea'),
      closeNotesBtn: document.getElementById('closeNotesBtn'),
      clearNotesBtn: document.getElementById('clearNotesBtn'),

      // Shortcut modal
      shortcutModal: document.getElementById('shortcutModal'),

      // Settings panel
      settingsPanel: document.getElementById('settingsPanel'),
      settingThumbnails: document.getElementById('settingThumbnails'),
      settingFontSize: document.getElementById('settingFontSize'),
      fontSizeValue: document.getElementById('fontSizeValue'),

      // Global search
      globalSearchBtn: document.getElementById('globalSearchBtn'),
      globalSearchPanel: document.getElementById('globalSearchPanel'),
      globalSearchInput: document.getElementById('globalSearchInput'),
      globalSearchResults: document.getElementById('globalSearchResults'),
      globalSearchStatus: document.getElementById('globalSearchStatus')
    };
  }

  setupEventListeners() {
    // Buttons
    this.elements.setRootBtn.addEventListener('click', () => this.openFolderSelector());
    this.elements.browseFolderBtn.addEventListener('click', () => this.browseFolderNative());
    this.elements.sidebarToggleBtn.addEventListener('click', () => this.toggleSidebar());
    this.elements.darkModeBtn.addEventListener('click', () => this.toggleDarkMode());
    document.getElementById('openUrlBtn').addEventListener('click', () => this.openUrlDialog());
    document.getElementById('confirmUrlBtn').addEventListener('click', () => this.loadUrl());
    document.getElementById('cancelUrlBtn').addEventListener('click', () => this.closeUrlDialog());
    document.getElementById('closeUrlInputBtn').addEventListener('click', () => this.closeUrlDialog());
    document.getElementById('closeUrlViewerBtn').addEventListener('click', () => this.closeUrlViewer());
    document.getElementById('urlViewerNewTab').addEventListener('click', () => {
      window.open(this.elements.urlViewerAddress.value, '_blank', 'noopener');
    });
    this.elements.urlInputModal.addEventListener('click', (e) => {
      if (e.target === this.elements.urlInputModal) this.closeUrlDialog();
    });
    this.elements.urlViewerModal.addEventListener('click', (e) => {
      if (e.target === this.elements.urlViewerModal) this.closeUrlViewer();
    });
    // Address bar: Enter key or 2s debounce reloads the iframe
    this._urlDebounce = null;
    this.elements.urlViewerAddress.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(this._urlDebounce);
        this.navigateViewer(this.elements.urlViewerAddress.value.trim());
      }
    });
    this.elements.urlViewerAddress.addEventListener('input', () => {
      clearTimeout(this._urlDebounce);
      this._urlDebounce = setTimeout(() => {
        const val = this.elements.urlViewerAddress.value.trim();
        if (val) this.navigateViewer(val);
      }, 2000);
    });
    this.elements.urlViewerAddress.addEventListener('click', () => {
      if (this.elements.urlViewerAddress.value) this.elements.urlViewerAddress.select();
    });
    // Root path inline editing
    this.elements.rootPath.addEventListener('click', () => {
      if (this.elements.rootPath.hasAttribute('readonly')) {
        this.elements.rootPath.removeAttribute('readonly');
        this.elements.rootPath.select();
      }
    });
    this.elements.rootPath.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.elements.rootPath.blur();
      } else if (e.key === 'Escape') {
        this.elements.rootPath.value = this.rootDir || '';
        this.elements.rootPath.setAttribute('readonly', '');
        this.elements.rootPath.blur();
      }
    });
    this.elements.rootPath.addEventListener('blur', () => {
      const newPath = this.elements.rootPath.value.trim();
      this.elements.rootPath.setAttribute('readonly', '');
      if (newPath && newPath !== this.rootDir) {
        this.setRootDirectory(newPath);
      } else {
        this.elements.rootPath.value = this.rootDir || '';
      }
    });
    this.elements.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.loadUrl();
      if (e.key === 'Escape') this.closeUrlDialog();
    });
    this.elements.gridViewBtn.addEventListener('click', () => this.setViewMode('grid'));
    this.elements.listViewBtn.addEventListener('click', () => this.setViewMode('list'));

    // Toolbox FAB
    this.elements.toolboxBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleToolboxMenu(); });
    this.elements.toolboxNotesBtn.addEventListener('click', () => { this.toggleNotes(); this.closeToolboxMenu(); });
    this.elements.toolboxBlurBtn.addEventListener('click', () => { this.toggleBlur(); this.closeToolboxMenu(); });
    this.elements.toolboxContainerBtn.addEventListener('click', () => { this.createContainer(); this.closeToolboxMenu(); });
    this.elements.closeNotesBtn.addEventListener('click', () => this.closeNotes());
    this.elements.clearNotesBtn.addEventListener('click', () => this.clearNotes());
    this.elements.notesTextarea.addEventListener('input', () => this.saveNotes());
    document.addEventListener('click', (e) => {
      if (this.isToolboxOpen && !document.getElementById('toolboxFab').contains(e.target)) {
        this.closeToolboxMenu();
      }
    });
    document.getElementById('closeShortcutBtn').addEventListener('click', () => this.closeShortcutModal());
    this.elements.shortcutModal.addEventListener('click', (e) => {
      if (e.target === this.elements.shortcutModal) this.closeShortcutModal();
    });

    // Settings panel
    document.getElementById('toolboxSettingsBtn').addEventListener('click', () => { this.openSettings(); this.closeToolboxMenu(); });
    document.getElementById('closeSettingsBtn').addEventListener('click', () => this.closeSettings());
    this.elements.settingThumbnails.addEventListener('change', () => {
      this.settings.thumbnails = this.elements.settingThumbnails.checked;
      this.saveSettings();
      this.refreshFileList();
    });
    this.elements.settingFontSize.addEventListener('input', () => {
      this.settings.fontSize = parseInt(this.elements.settingFontSize.value);
      this.elements.fontSizeValue.textContent = this.settings.fontSize + 'px';
      this.applySettings();
      this.saveSettings();
    });

    // Global search
    this.elements.globalSearchBtn.addEventListener('click', () => this.openGlobalSearch());
    document.getElementById('closeGlobalSearchBtn').addEventListener('click', () => this.closeGlobalSearch());
    this._globalSearchDebounce = null;
    this.elements.globalSearchInput.addEventListener('input', () => {
      clearTimeout(this._globalSearchDebounce);
      const q = this.elements.globalSearchInput.value.trim();
      if (!q) { this.elements.globalSearchResults.innerHTML = ''; this.elements.globalSearchStatus.textContent = ''; return; }
      this.elements.globalSearchStatus.textContent = 'Searching…';
      this._globalSearchDebounce = setTimeout(() => this.runGlobalSearch(q), 400);
    });
    this.elements.globalSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeGlobalSearch();
    });

    // Player
    this.elements.closePlayerBtn.addEventListener('click', () => this.closePlayer());
    this.elements.closeImageBtn.addEventListener('click', () => this.closeImageModal());
    this.elements.closeTextBtn.addEventListener('click', () => this.closeTextModal());
    document.getElementById('closeCsvBtn').addEventListener('click', () => this.closeCsvModal());
    this.elements.closePdfBtn.addEventListener('click', () => this.closePDFModal());
    this.elements.pdfPrevBtn.addEventListener('click', () => this.changePDFPage(-1));
    this.elements.pdfNextBtn.addEventListener('click', () => this.changePDFPage(1));
    this.elements.pdfModal.addEventListener('click', (e) => {
      if (e.target === this.elements.pdfModal) this.closePDFModal();
    });

    // Modal
    this.elements.confirmRootBtn.addEventListener('click', () => this.setRootDirectory());
    this.elements.cancelRootBtn.addEventListener('click', () => this.closeFolderSelector());
    this.elements.downloadTextBtn.addEventListener('click', () => this.downloadCurrentText());

    // Search and filter
    this.elements.searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.refreshFileList();
    });

    this.elements.sortBy.addEventListener('change', (e) => {
      this.sortBy = e.target.value;
      this.refreshFileList();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

    // Modal close on background click
    this.elements.folderModal.addEventListener('click', (e) => {
      if (e.target === this.elements.folderModal) this.closeFolderSelector();
    });

    this.elements.imageModal.addEventListener('click', (e) => {
      if (e.target === this.elements.imageModal) this.closeImageModal();
    });

    this.elements.textModal.addEventListener('click', (e) => {
      if (e.target === this.elements.textModal) this.closeTextModal();
    });
    this.elements.csvModal.addEventListener('click', (e) => {
      if (e.target === this.elements.csvModal) this.closeCsvModal();
    });

    // Close media player when clicking backdrop
    this.elements.mediaPlayer.addEventListener('click', (e) => {
      if (e.target === this.elements.mediaPlayer) this.closePlayer();
    });

    // Video player keyboard shortcuts
    this.elements.videoPlayer.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.elements.videoPlayer.paused) {
          this.elements.videoPlayer.play();
        } else {
          this.elements.videoPlayer.pause();
        }
      }
    });
  }

  // ============ API Communication ============

  async checkRootDirectory() {
    try {
      const response = await fetch('/api/root');
      if (response.ok) {
        const data = await response.json();
        this.rootDir = data.rootDir;
        this.showRootInfo();
        this.loadFiles();
      }
    } catch (error) {
      console.log('No root directory set');
    }
  }

  async setRootDirectory(pathParam) {
    const path = (pathParam !== undefined ? pathParam : this.elements.folderPath.value).trim();
    if (!path) {
      this.showNotification('Please enter a folder path', 'error');
      return;
    }

    try {
      const response = await fetch('/api/set-root', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path })
      });

      const data = await response.json();

      if (response.ok) {
        this.rootDir = data.rootDir;
        this.currentPath = '';
        this.folderHistory = [];
        if (pathParam === undefined) this.closeFolderSelector();
        this.showRootInfo();
        this.loadFiles();
        this.saveRecentFolder(data.rootDir);
        this.showNotification('Folder opened successfully', 'success');
      } else {
        this.showNotification(data.message || 'Invalid folder path', 'error');
      }
    } catch (error) {
      this.showNotification('Error: ' + error.message, 'error');
    }
  }

  async loadFiles(path = '') {
    if (!this.rootDir) {
      this.showEmptyState();
      return;
    }

    this.showLoadingState();

    try {
      const query = new URLSearchParams();
      if (path) {
        query.append('path', path);
      }

      const response = await fetch(`/api/files?${query}`);
      const data = await response.json();

      if (response.ok) {
        this.files = data.files;
        this.currentPath = data.currentPath;
        this.refreshFileList();
        this.updateBreadcrumb();
        this.updateFolderTree();
      } else {
        this.showNotification(data.error || 'Error loading files', 'error');
        this.showEmptyState();
      }
    } catch (error) {
      this.showNotification('Error: ' + error.message, 'error');
      this.showEmptyState();
    }
  }

  // ============ File Display & Rendering ============

  refreshFileList() {
    let filtered = this.files;

    // Filter by search query
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(file =>
        file.name.toLowerCase().includes(query)
      );
    }

    // Sort
    filtered = this.sortFiles(filtered);

    // Render
    this.renderFiles(filtered);

    // Show empty state if no files
    if (filtered.length === 0 && this.files.length === 0) {
      this.showEmptyState();
    } else if (filtered.length === 0) {
      this.elements.fileContainer.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-secondary);">No files match your search</p>';
      this.elements.emptyState.classList.add('hidden');
      this.elements.loadingState.classList.add('hidden');
    } else {
      this.elements.emptyState.classList.add('hidden');
      this.elements.loadingState.classList.add('hidden');
    }
  }

  sortFiles(files) {
    const sorted = [...files];

    // Separate folders and files
    const folders = sorted.filter(f => f.type === 'folder');
    const filesOnly = sorted.filter(f => f.type === 'file');

    // Sort each group
    const sortFn = (a, b) => {
      switch (this.sortBy) {
        case 'size':
          return b.size - a.size;
        case 'date':
          return b.modified - a.modified;
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    };

    folders.sort(sortFn);
    filesOnly.sort(sortFn);

    return [...folders, ...filesOnly];
  }

  renderFiles(files) {
    if (this._thumbObserver) { this._thumbObserver.disconnect(); this._thumbObserver = null; }
    this.elements.fileContainer.innerHTML = '';

    files.forEach(file => {
      const item = this.createFileItem(file);
      this.elements.fileContainer.appendChild(item);
    });
  }

  createFileItem(file) {
    const item = document.createElement('div');
    item.className = `file-item ${file.type === 'folder' ? 'folder' : 'file'}`;

    const filePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
    const sizeText = file.type === 'file' ? this.formatFileSize(file.size) : '';
    const dateText = file.modified ? this.formatModifiedDate(file.modified) : '';

    // Build icon or thumbnail section
    let iconSection;
    if (this.settings.thumbnails && this.viewMode === 'grid' && file.category === 'image') {
      iconSection = `<div class="file-icon file-thumb"><img class="thumb-img" data-src="/api/stream?path=${encodeURIComponent(filePath)}" alt=""></div>`;
    } else if (this.settings.thumbnails && this.viewMode === 'grid' && file.category === 'video') {
      iconSection = `<div class="file-icon file-thumb video-thumb-wrap"><img class="thumb-img" data-src="/api/thumbnail?path=${encodeURIComponent(filePath)}" alt=""><span class="video-play-badge"><i class="fa-solid fa-play"></i></span></div>`;
    } else {
      iconSection = `<div class="file-icon">${this.getFileIcon(file)}</div>`;
    }

    item.innerHTML = `
      ${iconSection}
      <div class="file-info">
        <div class="file-name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(this.truncateFileName(file.name))}</div>
        ${sizeText ? `<div class="file-size">${sizeText}</div>` : ''}
        ${dateText ? `<div class="file-date">${dateText}</div>` : ''}
      </div>
    `;

    // Lazy-load thumbnails with fallback to icon
    if (file.category === 'image' || file.category === 'video') {
      const img = item.querySelector('.thumb-img');
      if (img) {
        const fallback = this.getFileIcon(file);
        img.addEventListener('error', () => {
          const wrap = img.closest('.file-thumb');
          if (wrap) { wrap.className = 'file-icon'; wrap.innerHTML = fallback; }
        });
        this._initThumbObserver();
        this._thumbObserver.observe(img);
      }
    }

    // Pin button for folders
    if (file.type === 'folder') {
      const pinned = this.isPinned(file);
      const pinBtn = document.createElement('button');
      pinBtn.className = 'pin-btn' + (pinned ? ' pinned' : '');
      pinBtn.title = pinned ? 'Unpin folder' : 'Pin folder';
      pinBtn.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
      pinBtn.addEventListener('click', (e) => { e.stopPropagation(); this.togglePinFolder(file, pinBtn); });
      item.appendChild(pinBtn);
      item.addEventListener('click', () => this.navigateToFolder(file.name));
    } else {
      item.addEventListener('click', () => this.openFile(file));
    }

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(file, e.clientX, e.clientY);
    });

    return item;
  }

  getFileIcon(file) {
    if (file.type === 'folder') {
      return '<i class="fa-solid fa-folder icon-folder"></i>';
    }

    const ext = (file.ext || '').toLowerCase();

    if (['mp4','mkv','webm','mov','avi','ts','m3u8','wmv','flv','vob','mpg','mpeg'].includes(ext))
      return '<i class="fa-solid fa-file-video icon-video"></i>';
    if (['mp3','wav','aac','flac','ogg','wma','m4a'].includes(ext))
      return '<i class="fa-solid fa-file-audio icon-audio"></i>';
    if (['jpg','jpeg','png','gif','webp','bmp','svg','ico','tiff'].includes(ext))
      return '<i class="fa-solid fa-file-image icon-image"></i>';
    if (ext === 'pdf')
      return '<i class="fa-solid fa-file-pdf icon-pdf"></i>';
    if (['doc','docx'].includes(ext))
      return '<i class="fa-solid fa-file-word icon-word"></i>';
    if (['xls','xlsx','csv'].includes(ext))
      return '<i class="fa-solid fa-file-excel icon-excel"></i>';
    if (['ppt','pptx'].includes(ext))
      return '<i class="fa-solid fa-file-powerpoint icon-ppt"></i>';
    if (['js','jsx','ts','tsx','py','java','c','cpp','cs','go','rb','php','swift','kt','rs',
         'html','css','scss','sass','json','xml','yaml','yml','sh','bat','ps1','vue','svelte'].includes(ext))
      return '<i class="fa-solid fa-file-code icon-code"></i>';
    if (['txt','md','log','ini','cfg','conf','rtf'].includes(ext))
      return '<i class="fa-solid fa-file-lines icon-text"></i>';
    if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext))
      return '<i class="fa-solid fa-file-zipper icon-archive"></i>';
    if (['exe','msi','dmg','apk','deb','rpm'].includes(ext))
      return '<i class="fa-solid fa-file-shield icon-exe"></i>';

    return '<i class="fa-solid fa-file icon-default"></i>';
  }

  // ============ File Actions ============

  handleFileClick(file) {
    // Just select/highlight
    console.log('Selected:', file.name);
  }

  openFile(file) {
    const ext = (file.ext || '').toLowerCase();

    if (file.category === 'video') {
      this.playVideo(file);
    } else if (file.category === 'audio') {
      this.playAudio(file);
    } else if (file.category === 'image') {
      this.viewImage(file);
    } else if (file.category === 'pdf' || ext === 'pdf') {
      this.viewPDF(file);
    } else if (ext === 'csv') {
      this.viewCsvFile(file);
    } else if (file.category === 'text') {
      this.viewTextFile(file);
    } else {
      this.downloadFile(file);
    }
  }

  navigateToFolder(folderName) {
    const newPath = this.currentPath ? `${this.currentPath}/${folderName}` : folderName;
    this.folderHistory.push(this.currentPath);
    this.loadFiles(newPath);
  }

  goBack() {
    if (this.folderHistory.length > 0) {
      const previousPath = this.folderHistory.pop();
      this.loadFiles(previousPath);
    }
  }

  // ============ Media Playback ============

  playVideo(file) {
    const filePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
    const videoUrl = `/api/stream?path=${encodeURIComponent(filePath)}`;

    this.elements.playerTitle.textContent = file.name;
    this.elements.mediaPlayer.classList.remove('hidden');

    // Hide audio player
    this.elements.audioPlayer.style.display = '';
    this.elements.videoPlayer.style.display = 'block';
    this.elements.playerTitle.closest('.player-modal-content').classList.remove('audio-mode');

    const video = this.elements.videoPlayer;
    const ext = file.ext.toLowerCase();

    // Clear any existing source
    video.src = '';
    
    // Remove previous error listeners
    video.onerror = null;
    
    // Add error handler with helpful messages
    video.onerror = (e) => {
      console.error('Video error:', e);
      let message = 'Unable to play video: ';
      
      switch(video.error?.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          message += 'Playback was aborted';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          message += 'Network error occurred';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          message += 'Video format not supported by your browser';
          if (ext === 'ts') {
            message += '. Try converting to MP4 or install FFmpeg on the server.';
          }
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          message += 'Format not supported';
          if (ext === 'ts') {
            message += '. MPEG-TS requires FFmpeg or HLS.js support.';
          }
          break;
        default:
          message += 'Unknown error (code: ' + video.error?.code + ')';
      }
      
      this.showNotification(message, 'error');
    };

    // Check if it's an HLS file
    if (ext === 'm3u8') {
      this.playHLS(videoUrl);
    } else if (ext === 'ts') {
      // For .ts files, use native playback with proper MIME type
      this.playRawTsFile(videoUrl);
    } else {
      // Regular video files
      video.crossOrigin = 'anonymous';
      video.src = videoUrl;
      video.load();
    }

    // Store current video info
    this.currentVideoPath = filePath;
  }

  async playRawTsFile(videoUrl) {
    const video = this.elements.videoPlayer;
    console.log('Playing raw MPEG-TS via MSE + mux.js transmuxing');

    // Clean up any previous MediaSource
    if (this.mediaSource) {
      try {
        if (this.mediaSource.readyState === 'open') this.mediaSource.endOfStream();
      } catch (e) {}
      this.mediaSource = null;
    }

    if (!window.MediaSource) {
      this.showNotification('MediaSource Extensions not supported by your browser', 'error');
      return;
    }
    if (typeof muxjs === 'undefined') {
      this.showNotification('mux.js failed to load — cannot play .ts files', 'error');
      return;
    }

    const mediaSource = new MediaSource();
    this.mediaSource = mediaSource;
    video.src = URL.createObjectURL(mediaSource);
    video.load();

    mediaSource.addEventListener('sourceopen', async () => {
      const mimeCodec = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
      let sourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
      } catch (e) {
        this.showNotification('Codec not supported by your browser: ' + e.message, 'error');
        return;
      }

      const segmentQueue = [];
      let updating = false;
      let transmuxDone = false;

      const appendNext = () => {
        if (updating || segmentQueue.length === 0 || mediaSource.readyState !== 'open') return;
        updating = true;
        try {
          sourceBuffer.appendBuffer(segmentQueue.shift());
        } catch (e) {
          console.error('appendBuffer error:', e);
          updating = false;
        }
      };

      sourceBuffer.addEventListener('updateend', () => {
        updating = false;
        if (segmentQueue.length > 0) {
          appendNext();
        } else if (transmuxDone) {
          try {
            if (mediaSource.readyState === 'open') mediaSource.endOfStream();
          } catch (e) {}
        }
      });

      const transmuxer = new muxjs.mp4.Transmuxer();

      transmuxer.on('data', (segment) => {
        // Combine initSegment + data (initSegment is empty after first segment)
        const combined = new Uint8Array(segment.initSegment.byteLength + segment.data.byteLength);
        combined.set(segment.initSegment, 0);
        combined.set(segment.data, segment.initSegment.byteLength);
        segmentQueue.push(combined);
        appendNext();
      });

      transmuxer.on('done', () => {
        transmuxDone = true;
        if (segmentQueue.length === 0 && !updating) {
          try {
            if (mediaSource.readyState === 'open') mediaSource.endOfStream();
          } catch (e) {}
        }
      });

      // Start playback once enough data is buffered
      video.addEventListener('canplay', () => {
        video.play().catch(() => {});
      }, { once: true });

      try {
        const response = await fetch(videoUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const reader = response.body.getReader();
        const TS_PACKET_SIZE = 188;
        let leftover = new Uint8Array(0);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Merge leftover unaligned bytes with new chunk
          const chunk = new Uint8Array(leftover.length + value.length);
          chunk.set(leftover, 0);
          chunk.set(value, leftover.length);

          // Push only TS-packet-aligned bytes to the transmuxer
          const alignedLen = Math.floor(chunk.length / TS_PACKET_SIZE) * TS_PACKET_SIZE;
          if (alignedLen > 0) {
            transmuxer.push(chunk.slice(0, alignedLen));
          }
          leftover = chunk.slice(alignedLen);
        }

        // Flush any remaining data
        if (leftover.length > 0) transmuxer.push(leftover);
        transmuxer.flush();

      } catch (err) {
        console.error('Error streaming .ts file:', err);
        this.showNotification('Error loading .ts file: ' + err.message, 'error');
      }
    });
  }

  playHLS(url) {
    const video = this.elements.videoPlayer;

    // Clean up old HLS instance if exists
    if (this.hlsInstances.has(url)) {
      const oldHls = this.hlsInstances.get(url);
      oldHls.destroy();
      this.hlsInstances.delete(url);
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: true
      });

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest loaded, starting playback');
        video.play().catch(err => {
          console.error('HLS play error:', err);
          this.showNotification('Unable to play video: ' + err.message, 'error');
        });
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS Error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('Fatal network error');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('Fatal media error');
              hls.recoverMediaError();
              break;
            default:
              console.error('Unrecoverable HLS error:', data);
              this.showNotification('Error loading video stream', 'error');
              break;
          }
        }
      });

      this.hlsInstances.set(url, hls);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS support
      video.src = url;
      video.play().catch(err => {
        console.error('Native HLS play error:', err);
        this.showNotification('Unable to play video: ' + err.message, 'error');
      });
    } else {
      this.showNotification('HLS playback not supported in your browser', 'error');
    }
  }

  playAudio(file) {
    const filePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
    const audioUrl = `/api/stream?path=${encodeURIComponent(filePath)}`;

    this.elements.playerTitle.textContent = file.name;
    this.elements.mediaPlayer.classList.remove('hidden');

    // Hide video, show audio UI
    this.elements.videoPlayer.style.display = 'none';
    this.elements.audioPlayer.style.display = '';
    this.elements.playerTitle.closest('.player-modal-content').classList.add('audio-mode');

    // Update album art filename
    const nameEl = document.getElementById('audioTrackName');
    if (nameEl) nameEl.textContent = file.name;
    const extEl = document.getElementById('audioTrackExt');
    if (extEl) extEl.textContent = (file.ext || '').toUpperCase();

    this.elements.audioPlayer.src = audioUrl;
    this.elements.audioPlayer.play().catch(() => {});
  }

  closePlayer() {
    this.elements.mediaPlayer.classList.add('hidden');
    this.elements.videoPlayer.pause();
    this.elements.audioPlayer.pause();
    this.elements.playerTitle.closest('.player-modal-content').classList.remove('audio-mode');
  }

  // ============ Preview Functions ============

  viewImage(file) {
    const filePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
    const imageUrl = `/api/stream?path=${encodeURIComponent(filePath)}`;

    document.getElementById('imagePreview').src = imageUrl;
    document.getElementById('imageName').textContent = file.name;
    this.elements.imageModal.classList.remove('hidden');
  }

  closeImageModal() {
    this.elements.imageModal.classList.add('hidden');
  }

  async viewTextFile(file) {
    const filePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;

    try {
      const response = await fetch(`/api/read-text?path=${encodeURIComponent(filePath)}`);

      if (response.ok) {
        const data = await response.json();
        document.getElementById('textFileName').textContent = file.name;
        document.getElementById('textContent').textContent = data.content;
        this.currentTextFile = filePath;
        this.elements.textModal.classList.remove('hidden');
      } else {
        this.showNotification('Could not read file', 'error');
      }
    } catch (error) {
      this.showNotification('Error: ' + error.message, 'error');
    }
  }

  closeTextModal() {
    this.elements.textModal.classList.add('hidden');
  }

  async viewCsvFile(file) {
    const filePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
    try {
      const response = await fetch(`/api/read-text?path=${encodeURIComponent(filePath)}`);
      if (!response.ok) { this.showNotification('Could not read CSV file', 'error'); return; }
      const data = await response.json();
      document.getElementById('csvFileName').textContent = file.name;
      document.getElementById('csvTableContainer').innerHTML = this.buildCsvTable(data.content);
      this.elements.csvModal.classList.remove('hidden');
    } catch (err) {
      this.showNotification('Error reading CSV: ' + err.message, 'error');
    }
  }

  buildCsvTable(csvText) {
    // Parse CSV respecting quoted fields
    const parseRow = (line) => {
      const cells = [];
      let cur = '', inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
          else inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
          cells.push(cur); cur = '';
        } else { cur += ch; }
      }
      cells.push(cur);
      return cells;
    };

    const lines = csvText.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l => l.trim());
    if (!lines.length) return '<p class="csv-empty">Empty file</p>';

    const headers = parseRow(lines[0]);
    const totalRows = lines.length - 1;

    let html = `<div class="csv-meta">${headers.length} columns &bull; ${totalRows} row${totalRows !== 1 ? 's' : ''}</div>`;
    html += '<div class="csv-table-wrap"><table class="csv-table"><thead><tr>';
    headers.forEach(h => { html += `<th>${this.escapeHtml(h.trim())}</th>`; });
    html += '</tr></thead><tbody>';

    const MAX_ROWS = 2000;
    const renderCount = Math.min(totalRows, MAX_ROWS);
    for (let i = 1; i <= renderCount; i++) {
      const cells = parseRow(lines[i]);
      html += '<tr>';
      headers.forEach((_, ci) => {
        const val = cells[ci] !== undefined ? cells[ci].trim() : '';
        const num = val !== '' && !isNaN(Number(val));
        html += `<td class="${num ? 'csv-num' : ''}">${this.escapeHtml(val)}</td>`;
      });
      html += '</tr>';
    }

    if (totalRows > MAX_ROWS) {
      html += `<tr><td colspan="${headers.length}" class="csv-truncated">Showing first ${MAX_ROWS} of ${totalRows} rows</td></tr>`;
    }

    html += '</tbody></table></div>';
    return html;
  }

  closeCsvModal() {
    this.elements.csvModal.classList.add('hidden');
    document.getElementById('csvTableContainer').innerHTML = '';
  }

  downloadCurrentText() {
    if (this.currentTextFile) {
      this.downloadFile({ name: this.currentTextFile.split('/').pop() });
    }
  }

  downloadFile(file) {
    const filePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
    const downloadUrl = `/api/download?path=${encodeURIComponent(filePath)}`;

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ============ Navigation ============

  updateBreadcrumb() {
    const breadcrumb = this.elements.breadcrumb;
    breadcrumb.innerHTML = '';

    // Home
    const home = document.createElement('span');
    home.className = 'breadcrumb-item';
    home.textContent = '🏠 Root';
    home.addEventListener('click', () => {
      this.folderHistory = [];
      this.loadFiles('');
    });
    breadcrumb.appendChild(home);

    if (!this.currentPath) return;

    const parts = this.currentPath.split('/');
    let path = '';

    parts.forEach(part => {
      path += (path ? '/' : '') + part;

      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.textContent = '/';
      breadcrumb.appendChild(separator);

      const item = document.createElement('span');
      item.className = 'breadcrumb-item';
      item.textContent = part;
      const currentPath = path;
      item.addEventListener('click', () => {
        this.folderHistory = [];
        this.loadFiles(currentPath);
      });
      breadcrumb.appendChild(item);
    });
  }

  updateFolderTree() {
    this.renderPinnedFolders();
    // Simple implementation - show current folder structure
    this.elements.folderTree.innerHTML = '';

    const folders = this.files.filter(f => f.type === 'folder');

    if (folders.length === 0) {
      this.elements.folderTree.innerHTML = '<p style="padding: 1rem; color: var(--text-secondary); font-size: 0.9rem;">No folders</p>';
      return;
    }

    folders.forEach(folder => {
      const item = document.createElement('div');
      item.className = 'folder-item';
      item.innerHTML = `<div class="folder-item-indent"><span class="folder-toggle">📁</span><span class="folder-item-name">${this.escapeHtml(folder.name)}</span></div>`;
      item.addEventListener('click', () => this.navigateToFolder(folder.name));
      this.elements.folderTree.appendChild(item);
    });
  }

  // ============ UI State Management ============

  openFolderSelector() {
    this.elements.folderPath.value = this.rootDir || '';
    this.elements.folderModal.classList.remove('hidden');
    this.elements.folderPath.focus();
    this.renderRecentFolders();
  }

  closeFolderSelector() {
    this.elements.folderModal.classList.add('hidden');
  }

  async browseFolderNative() {
    const btn = this.elements.browseFolderBtn;
    btn.disabled = true;
    btn.textContent = '⏳ Opening picker...';

    try {
      const response = await fetch('/api/browse-folder');
      const data = await response.json();
      if (data.path) {
        this.elements.folderPath.value = data.path;
        // Auto-confirm if we got a valid path
        await this.setRootDirectory();
      }
    } catch (err) {
      this.showNotification('Could not open folder picker: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📂 Browse for Folder';
    }
  }

  showRootInfo() {
    if (this.rootDir) {
      this.elements.rootInfo.classList.remove('hidden');
      this.elements.rootPath.value = this.rootDir;
    } else {
      this.elements.rootInfo.classList.add('hidden');
    }
  }

  showEmptyState() {
    this.elements.emptyState.classList.remove('hidden');
    this.elements.loadingState.classList.add('hidden');
    this.elements.fileContainer.innerHTML = '';
  }

  showLoadingState() {
    this.elements.loadingState.classList.remove('hidden');
    this.elements.emptyState.classList.add('hidden');
    this.elements.fileContainer.innerHTML = '';
  }

  setViewMode(mode) {
    this.viewMode = mode;

    if (mode === 'grid') {
      this.elements.fileContainer.classList.remove('list-view');
      this.elements.fileContainer.classList.add('grid-view');
      this.elements.gridViewBtn.classList.add('active');
      this.elements.listViewBtn.classList.remove('active');
    } else {
      this.elements.fileContainer.classList.remove('grid-view');
      this.elements.fileContainer.classList.add('list-view');
      this.elements.gridViewBtn.classList.remove('active');
      this.elements.listViewBtn.classList.add('active');
    }

    this.refreshFileList();
    localStorage.setItem('viewMode', mode);
  }

  openUrlDialog() {
    this.elements.urlInput.value = '';
    this.elements.urlInputModal.classList.remove('hidden');
    setTimeout(() => this.elements.urlInput.focus(), 50);
  }

  closeUrlDialog() {
    this.elements.urlInputModal.classList.add('hidden');
  }

  extractYouTubeId(input) {
    const patterns = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/
    ];
    for (const re of patterns) {
      const m = input.match(re);
      if (m) return m[1];
    }
    return null;
  }

  resolveUrl(input) {
    if (new RegExp('^https?://', 'i').test(input)) {
      const ytId = this.extractYouTubeId(input);
      if (ytId) return { url: `https://www.youtube.com/embed/${ytId}?autoplay=1`, isYoutube: true };
      return { url: input, isYoutube: false };
    }
    if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/|$)/.test(input)) {
      const full = 'https://' + input;
      const ytId = this.extractYouTubeId(full);
      if (ytId) return { url: `https://www.youtube.com/embed/${ytId}?autoplay=1`, isYoutube: true };
      return { url: full, isYoutube: false };
    }
    return { url: 'https://www.bing.com/search?q=' + encodeURIComponent(input), isYoutube: false };
  }

  loadUrl() {
    const input = this.elements.urlInput.value.trim();
    if (!input) return;
    const { url, isYoutube } = this.resolveUrl(input);
    this.closeUrlDialog();
    this.elements.urlViewerAddress.value = url;
    this.elements.urlViewerFrame.src = url;
    this._setViewerIcon(isYoutube);
    this.elements.urlViewerModal.classList.remove('hidden');
  }

  navigateViewer(input) {
    const { url, isYoutube } = this.resolveUrl(input);
    this.elements.urlViewerAddress.value = url;
    this.elements.urlViewerFrame.src = url;
    this._setViewerIcon(isYoutube);
  }

  _setViewerIcon(isYoutube) {
    const icon = document.getElementById('urlViewerIcon');
    if (!icon) return;
    if (isYoutube) {
      icon.className = 'fa-brands fa-youtube';
      icon.style.color = '#ff0000';
    } else {
      icon.className = 'fa-solid fa-globe';
      icon.style.color = 'var(--accent)';
    }
  }

  closeUrlViewer() {
    clearTimeout(this._urlDebounce);
    this.elements.urlViewerModal.classList.add('hidden');
    this.elements.urlViewerFrame.src = 'about:blank';
    this.elements.urlViewerAddress.value = '';
  }

  toggleSidebar() {    const sidebar = this.elements.sidebar;
    const icon = this.elements.sidebarToggleBtn.querySelector('i');
    const isCollapsed = sidebar.classList.toggle('collapsed');
    if (isCollapsed) {
      icon.classList.replace('fa-bars', 'fa-bars-staggered');
      this.elements.sidebarToggleBtn.title = 'Show sidebar';
    } else {
      icon.classList.replace('fa-bars-staggered', 'fa-bars');
      this.elements.sidebarToggleBtn.title = 'Hide sidebar';
    }
  }

  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    this.applyDarkMode();
    localStorage.setItem('darkMode', this.isDarkMode);
  }

  applyDarkMode() {
    const body = document.body;
    const icon = this.elements.darkModeBtn.querySelector('i');
    if (this.isDarkMode) {
      body.classList.add('dark-mode');
      if (icon) { icon.classList.remove('fa-moon'); icon.classList.add('fa-sun'); }
    } else {
      body.classList.remove('dark-mode');
      if (icon) { icon.classList.remove('fa-sun'); icon.classList.add('fa-moon'); }
    }
  }

  loadDarkMode() {
    const saved = localStorage.getItem('darkMode');
    if (saved) {
      return saved === 'true';
    }
    // Check system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // ============ Utilities ============

  showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  handleKeyboardShortcuts(e) {
    if (e.altKey) {
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        this.toggleBlur();
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        this.createContainer();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        this.toggleNotes();
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.toggleSidebar();
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        this.toggleDarkMode();
        return;
      }
      if (e.key === '?' || e.key === '/') {
        e.preventDefault();
        this.openShortcutModal();
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        this.openGlobalSearch();
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        this.elements.searchInput.focus();
      }
    }

    if (e.key === 'Escape') {
      this.closePlayer();
      this.closeImageModal();
      this.closeTextModal();
      this.closeFolderSelector();
      this.closePDFModal();
      this.closeToolboxMenu();
      this.closeNotes();
      this.closeShortcutModal();
      this.closeGlobalSearch();
    }

    if (e.key === 'Backspace' && !this.isInputFocused()) {
      this.goBack();
    }
  }

  isInputFocused() {
    const activeElement = document.activeElement;
    return activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA';
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  formatModifiedDate(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return d.toLocaleDateString([], { weekday: 'short' }) + ' ' +
             d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } else {
      return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    }
  }

  escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  showContextMenu(file, x, y) {
    // Simple context menu could be added here
    // For now, just alert the action
    console.log('Right-clicked:', file.name);
  }

  // ============ Toolbox ============

  toggleToolboxMenu() {
    this.isToolboxOpen = !this.isToolboxOpen;
    this.elements.toolboxMenu.classList.toggle('hidden', !this.isToolboxOpen);
    this.elements.toolboxBtn.classList.toggle('active', this.isToolboxOpen);
    if (this.isToolboxOpen) {
      // Sync active states
      this.elements.toolboxNotesBtn.classList.toggle('active', this.isNotesOpen);
      this.elements.toolboxBlurBtn.classList.toggle('active', this.isBlurred);
      this.elements.toolboxBlurBtn.innerHTML = this.isBlurred
        ? '<i class="fa-solid fa-eye"></i> Unblur Screen'
        : '<i class="fa-solid fa-eye-slash"></i> Blur Screen';
    }
  }

  closeToolboxMenu() {
    this.isToolboxOpen = false;
    this.elements.toolboxMenu.classList.add('hidden');
    this.elements.toolboxBtn.classList.remove('active');
  }

  toggleNotes() {
    this.isNotesOpen = !this.isNotesOpen;
    this.elements.notesPanel.classList.toggle('hidden', !this.isNotesOpen);
    if (this.isNotesOpen) setTimeout(() => this.elements.notesTextarea.focus(), 40);
  }

  closeNotes() {
    this.isNotesOpen = false;
    this.elements.notesPanel.classList.add('hidden');
  }

  clearNotes() {
    if (!this.elements.notesTextarea.value.trim()) return;
    if (!confirm('Delete all notes? This cannot be undone.')) return;
    this.elements.notesTextarea.value = '';
    localStorage.removeItem('mediaBrowserNotes');
    this.showNotification('Notes cleared', 'info');
  }

  saveNotes() {
    localStorage.setItem('mediaBrowserNotes', this.elements.notesTextarea.value);
  }

  loadNotesFromStorage() {
    const saved = localStorage.getItem('mediaBrowserNotes');
    if (saved !== null) this.elements.notesTextarea.value = saved;
  }

  toggleBlur() {
    this.isBlurred = !this.isBlurred;
    document.body.classList.toggle('blur-mode', this.isBlurred);
  }

  createContainer() {
    if (!this._containerZBase) this._containerZBase = 2100;
    const z = ++this._containerZBase;

    // Stagger position so multiple containers don't stack exactly
    const offset = ((z - 2101) % 10) * 28;
    const startX = Math.min(80 + offset, window.innerWidth - 340);
    const startY = Math.min(80 + offset, window.innerHeight - 280);

    const box = document.createElement('div');
    box.className = 'drag-container';
    box.style.cssText = `left:${startX}px;top:${startY}px;z-index:${z}`;

    box.innerHTML = `
      <div class="drag-container-header">
        <i class="fa-solid fa-grip-vertical drag-handle-icon"></i>
        <span class="drag-container-title">Container</span>
        <button class="btn-close drag-container-close" title="Close">&#x2715;</button>
      </div>
      <textarea class="drag-container-textarea" placeholder="Type here\u2026"></textarea>
    `;

    // Bring to front on click
    box.addEventListener('mousedown', () => {
      box.style.zIndex = ++this._containerZBase;
    }, true);

    // Close button
    box.querySelector('.drag-container-close').addEventListener('click', () => box.remove());

    // Drag logic
    const header = box.querySelector('.drag-container-header');
    let dragging = false, ox = 0, oy = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.drag-container-close')) return;
      dragging = true;
      ox = e.clientX - box.offsetLeft;
      oy = e.clientY - box.offsetTop;
      box.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      let nx = e.clientX - ox;
      let ny = e.clientY - oy;
      // Keep within viewport
      nx = Math.max(0, Math.min(nx, window.innerWidth - box.offsetWidth));
      ny = Math.max(0, Math.min(ny, window.innerHeight - box.offsetHeight));
      box.style.left = nx + 'px';
      box.style.top  = ny + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (dragging) { dragging = false; box.style.userSelect = ''; }
    });

    document.body.appendChild(box);
    setTimeout(() => box.querySelector('.drag-container-textarea').focus(), 40);
  }

  // ============ Shortcuts ============

  openShortcutModal() {
    this.elements.shortcutModal.classList.remove('hidden');
  }

  closeShortcutModal() {
    this.elements.shortcutModal.classList.add('hidden');
  }

  // ============ Settings ============

  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('mediaBrowserSettings') || '{}');
      return {
        thumbnails: saved.thumbnails !== undefined ? saved.thumbnails : true,
        fontSize: saved.fontSize || 13
      };
    } catch { return { thumbnails: true, fontSize: 13 }; }
  }

  saveSettings() {
    localStorage.setItem('mediaBrowserSettings', JSON.stringify(this.settings));
  }

  applySettings() {
    document.documentElement.style.zoom = this.settings.fontSize / 13;
    if (this.elements.settingThumbnails) this.elements.settingThumbnails.checked = this.settings.thumbnails;
    if (this.elements.settingFontSize) {
      this.elements.settingFontSize.value = this.settings.fontSize;
      this.elements.fontSizeValue.textContent = this.settings.fontSize + 'px';
    }
  }

  openSettings() {
    this.elements.settingsPanel.classList.remove('hidden');
    this.applySettings();
  }

  closeSettings() {
    this.elements.settingsPanel.classList.add('hidden');
  }

  // ============ Global Search ============

  openGlobalSearch() {
    if (!this.rootDir) { this.showNotification('Select a folder first', 'warning'); return; }
    this.elements.globalSearchPanel.classList.remove('hidden');
    setTimeout(() => this.elements.globalSearchInput.focus(), 40);
  }

  closeGlobalSearch() {
    this.elements.globalSearchPanel.classList.add('hidden');
    this.elements.globalSearchInput.value = '';
    this.elements.globalSearchResults.innerHTML = '';
    this.elements.globalSearchStatus.textContent = '';
    clearTimeout(this._globalSearchDebounce);
  }

  async runGlobalSearch(q) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) { this.elements.globalSearchStatus.textContent = 'Error: ' + (data.error || '?'); return; }
      const count = data.results.length;
      this.elements.globalSearchStatus.textContent = count === 0 ? 'No results' : `${count}${data.truncated ? '+' : ''} result${count !== 1 ? 's' : ''}`;
      this.renderGlobalSearchResults(data.results);
    } catch (err) {
      this.elements.globalSearchStatus.textContent = 'Error';
    }
  }

  renderGlobalSearchResults(results) {
    const container = this.elements.globalSearchResults;
    container.innerHTML = '';
    if (!results.length) {
      container.innerHTML = '<div class="global-search-empty">No files found</div>';
      return;
    }
    results.forEach(file => {
      const row = document.createElement('div');
      row.className = 'global-search-row';
      const icon = this.getFileIcon(file);
      row.innerHTML = `
        <div class="gs-icon">${icon}</div>
        <div class="gs-info">
          <div class="gs-name" title="${this.escapeHtml(file.relPath)}">${this.escapeHtml(file.name)}</div>
          <div class="gs-path">${this.escapeHtml(file.folderPath || '/')}</div>
        </div>
        <div class="gs-size">${this.formatFileSize(file.size)}</div>
      `;
      row.addEventListener('click', () => {
        // Navigate to the folder containing this file, then open it
        this.closeGlobalSearch();
        const openFile = () => {
          const match = this.files.find(f => f.name === file.name);
          if (match) this.openFile(match);
        };
        if (file.folderPath && file.folderPath !== this.currentPath) {
          this.loadFiles(file.folderPath).then(() => { setTimeout(openFile, 150); });
        } else {
          openFile();
        }
      });
      container.appendChild(row);
    });
  }

  // ============ Recent Folders ============

  loadRecentFolders() {
    try { return JSON.parse(localStorage.getItem('mediaBrowserRecents') || '[]'); } catch { return []; }
  }

  saveRecentFolder(path) {
    let recents = this.loadRecentFolders();
    recents = [path, ...recents.filter(p => p !== path)].slice(0, 10);
    localStorage.setItem('mediaBrowserRecents', JSON.stringify(recents));
  }

  renderRecentFolders() {
    const section = document.getElementById('recentFoldersSection');
    const list = document.getElementById('recentFoldersList');
    if (!section || !list) return;
    const recents = this.loadRecentFolders();
    if (!recents.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    list.innerHTML = '';
    recents.forEach(p => {
      const el = document.createElement('div');
      el.className = 'recent-folder-item';
      el.textContent = p;
      el.title = p;
      el.addEventListener('click', () => this.setRootDirectory(p));
      list.appendChild(el);
    });
  }

  // ============ Pinned Folders ============

  loadPinnedFolders() {
    try { return JSON.parse(localStorage.getItem('mediaBrowserPins') || '[]'); } catch { return []; }
  }

  savePinnedFolders() {
    localStorage.setItem('mediaBrowserPins', JSON.stringify(this.pinnedFolders));
  }

  _folderFullPath(name) {
    if (!this.rootDir) return name;
    const sep = this.rootDir.includes('\\') ? '\\' : '/';
    const sub = this.currentPath ? this.currentPath.split('/') : [];
    return [this.rootDir, ...sub, name].join(sep);
  }

  isPinned(folder) {
    const fp = this._folderFullPath(folder.name);
    return this.pinnedFolders.some(p => p.fullPath === fp);
  }

  togglePinFolder(folder, btn) {
    const fp = this._folderFullPath(folder.name);
    const idx = this.pinnedFolders.findIndex(p => p.fullPath === fp);
    if (idx >= 0) {
      this.pinnedFolders.splice(idx, 1);
      if (btn) { btn.classList.remove('pinned'); btn.title = 'Pin folder'; }
      this.showNotification(`"${folder.name}" unpinned`, 'info');
    } else {
      this.pinnedFolders.push({ name: folder.name, fullPath: fp });
      if (btn) { btn.classList.add('pinned'); btn.title = 'Unpin folder'; }
      this.showNotification(`"${folder.name}" pinned`, 'success');
    }
    this.savePinnedFolders();
    this.renderPinnedFolders();
  }

  renderPinnedFolders() {
    const section = document.getElementById('pinnedSection');
    const list = document.getElementById('pinnedList');
    if (!section || !list) return;
    if (!this.pinnedFolders.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    list.innerHTML = '';
    this.pinnedFolders.forEach(pin => {
      const item = document.createElement('div');
      item.className = 'folder-item pinned-item';
      item.innerHTML = `
        <div class="folder-item-indent">
          <span class="folder-toggle"><i class="fa-solid fa-thumbtack" style="font-size:9px;color:var(--accent)"></i></span>
          <span class="folder-item-name" title="${this.escapeHtml(pin.fullPath)}">${this.escapeHtml(pin.name)}</span>
          <button class="pin-remove-btn" title="Unpin"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `;
      item.querySelector('.folder-item-name').addEventListener('click', () => this.setRootDirectory(pin.fullPath));
      item.querySelector('.pin-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.pinnedFolders = this.pinnedFolders.filter(p => p.fullPath !== pin.fullPath);
        this.savePinnedFolders();
        this.renderPinnedFolders();
        document.querySelectorAll('.file-item.folder .pin-btn').forEach(pb => {
          const nameEl = pb.closest('.file-item')?.querySelector('.file-name');
          if (nameEl && nameEl.getAttribute('title') === pin.name) {
            pb.classList.remove('pinned'); pb.title = 'Pin folder';
          }
        });
      });
      list.appendChild(item);
    });
  }

  // ============ Thumbnails ============

  _initThumbObserver() {
    if (this._thumbObserver) return;
    this._thumbObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
          this._thumbObserver.unobserve(img);
        }
      });
    }, { rootMargin: '120px' });
  }

  // ============ Utilities ============

  truncateFileName(name) {
    const lastDot = name.lastIndexOf('.');
    const ext = lastDot > 0 ? name.slice(lastDot) : '';
    const baseName = lastDot > 0 ? name.slice(0, lastDot) : name;
    const words = baseName.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 3) {
      return words.slice(0, 3).join(' ') + '...' + ext;
    }
    return name;
  }

  isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || window.innerWidth <= 768;
  }

  // ============ PDF Viewer ============

  viewPDF(file) {
    const filePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
    const pdfUrl = `/api/stream?path=${encodeURIComponent(filePath)}`;

    if (!this.isMobile()) {
      // Desktop: show in modal using browser's native PDF renderer via iframe
      this.elements.pdfModal.classList.remove('hidden');
      this.elements.pdfFileName.textContent = file.name;
      this.elements.pdfPageControls.style.display = 'none';
      this.elements.pdfContainer.innerHTML =
        `<iframe src="${pdfUrl}" title="${this.escapeHtml(file.name)}"></iframe>`;
    } else {
      // Mobile: render page-by-page with PDF.js
      this.openPDFWithPDFJs(pdfUrl, file.name);
    }
  }

  async openPDFWithPDFJs(pdfUrl, fileName) {
    const pdfjs = window.pdfjsLib || window.PDFJS;
    if (!pdfjs) {
      // PDF.js not available, fallback to new tab
      window.open(pdfUrl, '_blank');
      return;
    }

    this.elements.pdfModal.classList.remove('hidden');
    this.elements.pdfFileName.textContent = fileName;
    this.elements.pdfPageControls.style.display = 'none';
    this.elements.pdfContainer.innerHTML =
      '<div class="loading-state" style="min-height:200px"><div class="spinner"></div><p>Loading PDF...</p></div>';

    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    try {
      this.pdfDoc = await pdfjs.getDocument(pdfUrl).promise;
      this.pdfTotalPages = this.pdfDoc.numPages;
      this.pdfCurrentPage = 1;

      this.elements.pdfPageControls.style.display = 'flex';
      await this.renderPDFPage(1);
    } catch (err) {
      this.elements.pdfContainer.innerHTML = `
        <div style="padding:2rem;text-align:center;">
          <p style="color:var(--danger-color)">Error loading PDF: ${this.escapeHtml(err.message)}</p>
          <a href="${pdfUrl}" target="_blank" style="display:inline-block;margin-top:1rem;" class="btn btn-primary">Open in Browser</a>
        </div>`;
    }
  }

  async renderPDFPage(pageNum) {
    if (!this.pdfDoc) return;

    this.elements.pdfPageInfo.textContent = `Page ${pageNum} of ${this.pdfTotalPages}`;
    this.elements.pdfContainer.innerHTML =
      '<div class="loading-state" style="min-height:200px"><div class="spinner"></div></div>';

    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const containerWidth = this.elements.pdfContainer.clientWidth - 32;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(containerWidth / baseViewport.width, 2);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      this.elements.pdfContainer.innerHTML = '';
      this.elements.pdfContainer.appendChild(canvas);

      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

      this.pdfCurrentPage = pageNum;
      this.elements.pdfPrevBtn.disabled = pageNum <= 1;
      this.elements.pdfNextBtn.disabled = pageNum >= this.pdfTotalPages;
    } catch (err) {
      this.elements.pdfContainer.innerHTML =
        `<p style="color:var(--danger-color);padding:1rem;">Error rendering page: ${this.escapeHtml(err.message)}</p>`;
    }
  }

  changePDFPage(delta) {
    const newPage = this.pdfCurrentPage + delta;
    if (newPage >= 1 && newPage <= this.pdfTotalPages) {
      this.renderPDFPage(newPage);
    }
  }

  closePDFModal() {
    this.elements.pdfModal.classList.add('hidden');
    this.pdfDoc = null;
    this.elements.pdfContainer.innerHTML = '';
    this.elements.pdfPageControls.style.display = 'none';
  }
}

// ============ Initialize App ============

let mediaBrowser;

document.addEventListener('DOMContentLoaded', () => {
  mediaBrowser = new MediaBrowser();
});

// Auto-load view mode from localStorage
window.addEventListener('load', () => {
  const savedViewMode = localStorage.getItem('viewMode');
  if (savedViewMode && mediaBrowser) {
    mediaBrowser.setViewMode(savedViewMode);
  }
});
