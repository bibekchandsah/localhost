/**
 * Canvas drawing app — canvas.js
 * Tools: pencil, brush, marker, eraser, line, rect, circle, polygon, arrow, text
 * Features: select/move, resize handles, rotation handle, marquee selection
 */
class CanvasApp {
  constructor() {
    this.tool     = 'pencil';
    this.color    = '#e74c3c';
    this.size     = 5;
    this.opacity  = 1.0;
    this.fillShapes    = false;
    this.cornerRadius = 0;
    this.sides        = 3;
    this.bgColor      = '#252525';
    this.bgVisible    = true;

    // History
    this.history     = [];
    this.historyPtr  = -1;
    this.MAX_HISTORY = 50;

    // Object model
    this.objects = [];
    this._nextId = 1;

    // Drawing state
    this.isDrawing = false;
    this.lastX = 0; this.lastY = 0;
    this.startX = 0; this.startY = 0;
    this.textPending = null;
    this.cursorPos  = null; // tracks mouse position for brush-size cursor

    // Current in-progress strokes/shapes
    this.currentStroke = null;
    this.currentShape  = null;

    // Selection state — Set of selected object IDs
    this.selectedIds = new Set();

    // Drag-move state
    this.isDragging  = false;
    this.dragStart   = null;
    this.dragBases   = null; // Map<id, clonedObj>

    // Resize handle state
    // handleIndex: 0=TL 1=TC 2=TR 3=ML 4=MR 5=BL 6=BC 7=BR
    this.isResizing      = false;
    this.resizeHandleIdx = -1;
    this.resizeObjId     = -1;
    this.resizeBase      = null;

    // Shift-constrain drawing / resize
    this.shiftDown = false;

    // Rotation handle state
    this.isRotating   = false;
    this.rotateObjId  = -1;
    this.rotateBase   = null;
    this.rotateCenter = null; // {x,y} center of object during rotate

    // Group (multi-select) resize / rotate state
    this.isGroupResizing   = false;
    this.groupResizeHIdx   = -1;
    this.groupResizeGb     = null;  // {x,y,w,h} raw bounding box at drag start
    this.groupResizeBases  = null;  // Map<id, clonedObj>
    this.isGroupRotating   = false;
    this.groupRotateBases  = null;  // Map<id, {obj, cx, cy}>
    this.groupRotateCenter = null;  // {x,y}
    this.groupRotateBase0  = 0;     // start angle

    // Marquee (rubber-band) selection state
    this.isMarquee    = false;
    this.marqueeStart = null; // {x,y}
    this.marqueeEnd   = null; // {x,y}

    // Canvas elements
    this.main    = document.getElementById('mainCanvas');
    this.ctx     = this.main.getContext('2d');
    this.preview = document.getElementById('previewCanvas');
    this.pctx    = this.preview.getContext('2d');
    this.wrap    = document.getElementById('cvArea');

    // Pages
    this.pages          = null; // initialized in init() after saveSnap()
    this.currentPageIdx = 0;

    // Clipboard (internal copy/paste of objects)
    this._clipboard = [];
    this._canvasClipboardOwned = false; // true after Ctrl+C on canvas objects
    // Image element cache: objId → HTMLImageElement
    this._imgCache = new Map();

    this.PALETTE = [
      '#000000','#ffffff','#e74c3c','#e67e22',
      '#f1c40f','#2ecc71','#1abc9c','#3498db',
      '#9b59b6','#e91e63','#795548','#607d8b'
    ];

    // Handle geometry constants
    this.HANDLE_R     = 5;  // radius of resize handle squares
    this.ROT_HANDLE_R = 5;  // radius of rotation handle circle
    this.ROT_OFFSET   = 22; // px above top-center of bounds

    this.init();
  }

  /* ── Init ──────────────────────────────────────────────── */

  init() {
    this.resize();
    this.buildPalette();
    this.bindUI();
    this.bindCanvas();
    this.saveSnap();               // snapshot of blank canvas
    this._initPages();             // set up page strip after first snap
    document.addEventListener('paste', e => this._handleExternalPaste(e));
    window.addEventListener('resize', () => this.resize());
    // When the window regains focus the user may have copied something in another app,
    // so release ownership of the canvas clipboard so the next Ctrl+V checks the OS clipboard.
    window.addEventListener('focus', () => { this._canvasClipboardOwned = false; });
    // Allow parent page to trigger a resize after making overlay visible
    window.addEventListener('message', e => {
      if (e.data === 'canvas-resize') this.resize();
    });
    // Warn before the tab is closed or refreshed if any page has content
    window.addEventListener('beforeunload', e => {
      // Save live state into current page slot so the check is accurate
      this._savePage(this.currentPageIdx);
      const hasContent = this.pages.some(p => p.objects.length > 0);
      if (hasContent) {
        e.preventDefault();
        e.returnValue = ''; // required for Chrome to show the dialog
      }
    });
  }

  resize() {
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    if (w === 0 || h === 0) return;
    if (w === this.main.width && h === this.main.height) return;

    this.main.width    = w; this.main.height    = h;
    this.preview.width = w; this.preview.height = h;
    this.renderAll();
  }

  /* ── Palette ───────────────────────────────────────────── */

  buildPalette() {
    const strip = document.getElementById('palette');
    const menu  = document.getElementById('paletteMenu');
    this.PALETTE.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'cv-swatch';
      btn.style.background = c;
      btn.title = c;
      btn.addEventListener('click', () => this.setColor(c));
      if (i < 4) strip.appendChild(btn);
      else       menu.appendChild(btn);
    });

    // Set initial preview color
    document.getElementById('colorPreview').style.background = this.color;
    document.getElementById('colorPicker').value = this.color;
  }

  setColor(c) {
    this.color = c;
    document.getElementById('colorPicker').value = c;
    document.getElementById('colorPreview').style.background = c;
    if (this.selectedIds.size > 0) {
      const allLocked = [...this.selectedIds].every(id => { const o = this._getObjectById(id); return o && o.locked; });
      if (allLocked) return;
      this._applyPropToSelected('color', c);
      this.saveSnap();
    }
  }

  /* ── UI bindings ───────────────────────────────────────── */

  bindUI() {
    // Utility: make a range input respond to mouse-wheel
    const addWheel = (el, step = 1) => {
      el.addEventListener('wheel', e => {
        e.preventDefault();
        const dir   = e.deltaY < 0 ? 1 : -1;
        const min   = parseFloat(el.min)  || 0;
        const max   = parseFloat(el.max)  || 100;
        const s     = step * (e.shiftKey ? 5 : 1);
        el.value    = Math.min(max, Math.max(min, parseFloat(el.value) + dir * s));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { passive: false });
    };

    // Tool buttons
    document.querySelectorAll('.cv-tool[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.commitText();
        this.selectTool(btn.dataset.tool);
      });
    });

    // Color picker
    const picker  = document.getElementById('colorPicker');
    const preview = document.getElementById('colorPreview');
    picker.addEventListener('input', () => {
      this.color = picker.value;
      preview.style.background = picker.value;
      this._applyPropToSelected('color', picker.value);
    });
    picker.addEventListener('change', () => {
      if (this.selectedIds.size > 0) this.saveSnap();
    });

    // Size
    const sizeR = document.getElementById('sizeRange');
    const sizeV = document.getElementById('sizeVal');
    addWheel(sizeR, 1);
    sizeR.addEventListener('input', () => {
      this.size = parseInt(sizeR.value);
      sizeV.textContent = this.size;
      this._applyPropToSelected('size', this.size);
      if (this.isFreehand() && this.cursorPos) {
        this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
        this._drawBrushCursor();
      }
    });
    sizeR.addEventListener('change', () => {
      if (this.selectedIds.size > 0) this.saveSnap();
    });

    // Opacity
    const opR = document.getElementById('opacityRange');
    const opV = document.getElementById('opacityVal');
    addWheel(opR, 1);
    opR.addEventListener('input', () => {
      this.opacity = parseInt(opR.value) / 100;
      opV.textContent = opR.value + '%';
      this._applyPropToSelected('opacity', this.opacity);
    });
    opR.addEventListener('change', () => {
      if (this.selectedIds.size > 0) this.saveSnap();
    });

    // Fill toggle
    document.getElementById('fillToggle').addEventListener('change', e => {
      this.fillShapes = e.target.checked;
    });

    // Background color + visibility
    const bgPicker  = document.getElementById('bgColorPicker');
    const bgPreview = document.getElementById('bgColorPreview');
    bgPreview.style.background = this.bgColor;
    bgPicker.value = this.bgColor;
    bgPicker.addEventListener('input', () => {
      this.bgColor = bgPicker.value;
      bgPreview.style.background = bgPicker.value;
      this.renderAll();
    });
    document.getElementById('bgToggle').addEventListener('click', () => {
      this.bgVisible = !this.bgVisible;
      const btn = document.getElementById('bgToggle');
      btn.querySelector('i').className = this.bgVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
      btn.classList.toggle('active', this.bgVisible);
      this.wrap.classList.toggle('bg-hidden', !this.bgVisible);
      this.renderAll();
    });

    // History
    document.getElementById('undoBtn').addEventListener('click', () => this.undo());
    document.getElementById('redoBtn').addEventListener('click', () => this.redo());

    // Clear
    document.getElementById('clearBtn').addEventListener('click', () => {
      if (confirm('Clear the entire canvas?')) this.clearCanvas();
    });

    // Download
    document.getElementById('downloadBtn').addEventListener('click', () => this.download());

    // Corner rounding
    const crR = document.getElementById('cornerRoundingRange');
    const crV = document.getElementById('cornerRoundingVal');
    addWheel(crR, 1);
    crR.addEventListener('input', () => {
      this.cornerRadius = parseInt(crR.value);
      crV.textContent = this.cornerRadius;
      this._applyPropToSelected('cornerRadius', this.cornerRadius);
    });
    crR.addEventListener('change', () => {
      if (this.selectedIds.size > 0) this.saveSnap();
    });

    // Sides (polygon)
    const sidesR = document.getElementById('sidesRange');
    const sidesV = document.getElementById('sidesVal');
    addWheel(sidesR, 1);
    sidesR.addEventListener('input', () => {
      this.sides = parseInt(sidesR.value);
      sidesV.textContent = this.sides;
      this._applyPropToSelected('sides', this.sides);
    });
    sidesR.addEventListener('change', () => {
      if (this.selectedIds.size > 0) this.saveSnap();
    });

    // Copy / Paste / Duplicate
    document.getElementById('copyBtn').addEventListener('click',      () => this._copySelected());
    document.getElementById('pasteBtn').addEventListener('click',     () => this._pasteClipboard());
    document.getElementById('duplicateBtn').addEventListener('click', () => this._duplicateSelected());

    // Lock / Unlock
    document.getElementById('lockBtn').addEventListener('click', () => this._toggleLock());

    // Layer order
    document.getElementById('bringFrontBtn').addEventListener('click',   () => this._bringToFront());
    document.getElementById('bringForwardBtn').addEventListener('click', () => this._bringForward());
    document.getElementById('sendBackwardBtn').addEventListener('click', () => this._sendBackward());
    document.getElementById('sendBackBtn').addEventListener('click',     () => this._sendToBack());

    // Layer flyout
    this._bindFlyout('layerFlyout');

    // Group / Ungroup
    document.getElementById('groupBtn').addEventListener('click',   () => this._groupSelected());
    document.getElementById('ungroupBtn').addEventListener('click', () => this._ungroupSelected());

    // Close
    document.getElementById('closeBtn').addEventListener('click', () => this.close());

    // Brush flyout
    this._bindFlyout('brushFlyout');

    // Shape flyout
    this._bindFlyout('shapeFlyout');

    // Palette flyout
    (() => {
      const wrap = document.getElementById('paletteFlyout');
      const popMenu = document.getElementById('paletteMenu');
      if (!wrap || !popMenu) return;
      let t = null;
      const show = () => {
        clearTimeout(t);
        const r = wrap.getBoundingClientRect();
        popMenu.style.top  = (r.bottom + 4) + 'px';
        popMenu.style.left = r.left + 'px';
        popMenu.classList.add('open');
      };
      const hide = () => { t = setTimeout(() => popMenu.classList.remove('open'), 120); };
      wrap.addEventListener('mouseenter', show);
      wrap.addEventListener('mouseleave', hide);
      popMenu.addEventListener('mouseenter', () => clearTimeout(t));
      popMenu.addEventListener('mouseleave', hide);
    })();

    // Props flyout (Size/Opacity/Fill hover → Rounding/Sides)
    (() => {
      const wrap = document.getElementById('propsFlyout');
      const menu = document.getElementById('propsMenu');
      if (!wrap || !menu) return;
      let t = null;
      const show = () => {
        clearTimeout(t);
        const r = wrap.getBoundingClientRect();
        menu.style.top  = (r.bottom + 4) + 'px';
        menu.style.left = r.left + 'px';
        menu.classList.add('open');
      };
      const hide = () => { t = setTimeout(() => menu.classList.remove('open'), 120); };
      wrap.addEventListener('mouseenter', show);
      wrap.addEventListener('mouseleave', hide);
      menu.addEventListener('mouseenter', () => clearTimeout(t));
      menu.addEventListener('mouseleave', hide);
    })();

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Shift') {
        this.shiftDown = true;
        // Live-refresh shape preview when Shift pressed mid-draw
        if (this.isDrawing && this.currentShape) this._updateShapePreview(this.lastX, this.lastY);
      }
      this.onKey(e);
    });
    document.addEventListener('keyup', e => {
      if (e.key === 'Shift') {
        this.shiftDown = false;
        if (this.isDrawing && this.currentShape) this._updateShapePreview(this.lastX, this.lastY);
      }
    });
  }

  updateCursor() {
    if (this.tool === 'select') { this.preview.style.cursor = 'default'; return; }
    const map = { text: 'text' };
    // Hide native cursor for freehand tools — we draw our own brush-size circle
    this.preview.style.cursor = this.isFreehand() ? 'none' : (map[this.tool] || 'crosshair');
  }

  /* ── Canvas event bindings ─────────────────────────────── */

  bindCanvas() {
    const p = this.preview;
    p.addEventListener('mousedown',  e => this.onDown(e));
    p.addEventListener('mousemove',  e => this.onMove(e));
    p.addEventListener('mouseup',    e => this.onUp(e));
    p.addEventListener('mouseleave', e => {
      if (this.isFreehand()) {
        this.cursorPos = null;
        this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
      }
      if (this.isDrawing || this.isMarquee) this.onUp(e);
    });

    // Touch support
    p.addEventListener('touchstart',  e => { e.preventDefault(); this.onDown(this.t2m(e)); }, { passive: false });
    p.addEventListener('touchmove',   e => { e.preventDefault(); this.onMove(this.t2m(e)); }, { passive: false });
    p.addEventListener('touchend',    e => { e.preventDefault(); this.onUp(this.t2m(e));   }, { passive: false });
  }

  t2m(e) {
    const t = e.touches[0] || e.changedTouches[0];
    return { clientX: t.clientX, clientY: t.clientY, shiftKey: false };
  }

  pos(e) {
    const r = this.preview.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /* ── Draw event handlers ───────────────────────────────── */

  onDown(e) {
    const { x, y } = this.pos(e);

    if (this.tool === 'select') { this._handleSelectDown(x, y, e.shiftKey || false); return; }
    if (this.tool === 'text') {
      this.commitText();
      this.placeText(x, y);
      return;
    }

    this.isDrawing = true;
    this.startX = x; this.startY = y;
    this.lastX  = x; this.lastY  = y;

    if (this.isFreehand()) {
      this.currentStroke = {
        tool: this.tool,
        points: [{ x, y }],
        color: this.color,
        size: this.size,
        opacity: this.opacity
      };
    } else {
      this.currentShape = {
        tool: this.tool,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        color: this.color,
        size: this.size,
        opacity: this.opacity,
        fill: this.fillShapes,
        cornerRadius: this.cornerRadius,
        sides: this.sides
      };
    }
  }

  onMove(e) {
    this.shiftDown = e.shiftKey;
    const { x, y } = this.pos(e);

    if (this.tool === 'select') {
      if (!this.isDrawing && !this.isMarquee) {
        this._updateSelectCursor(x, y);
        this._drawSelectionOverlay();
        return;
      }
      this._handleSelectMove(x, y);
      return;
    }

    if (this.isFreehand()) {
      this.cursorPos = { x, y };
      if (!this.isDrawing) {
        // Not drawing — just show the brush cursor on the preview canvas
        this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
        this._drawBrushCursor();
        return;
      }
      this._updateFreehandPreview(x, y);
      this._drawBrushCursor(); // overlay cursor on top of stroke preview
      this.lastX = x; this.lastY = y;
      return;
    }

    if (!this.isDrawing) return;
    this._updateShapePreview(x, y);
    this.lastX = x; this.lastY = y;
  }

  onUp(e) {
    this.shiftDown = e.shiftKey;
    const { x, y } = this.pos(e);

    if (this.tool === 'select') { this._handleSelectUp(x, y); return; }

    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.isFreehand()) {
      this._commitFreehandStroke(x, y);
    } else {
      this._commitShape(x, y);
    }
  }

  isFreehand() {
    return ['pencil', 'brush', 'marker', 'eraser'].includes(this.tool);
  }

  /* ── Select tool ───────────────────────────────────────── */

  _handleSelectDown(x, y, shiftKey) {
    // 0. Multi-selection group resize / rotate
    if (this.selectedIds.size > 1) {
      const gb = this._multiSelectHandleBounds();
      if (gb) {
        const rh = this._getRotationHandlePos(gb);
        if (Math.hypot(x - rh.x, y - rh.y) <= this.ROT_HANDLE_R + 4) {
          this.isGroupRotating   = true;
          this.isDrawing         = true;
          this.groupRotateCenter = { x: gb.cx, y: gb.cy };
          this.groupRotateBase0  = Math.atan2(y - gb.cy, x - gb.cx);
          this.groupRotateBases  = new Map();
          for (const id of this.selectedIds) {
            const obj = this._getObjectById(id);
            if (!obj) continue;
            const ab = this._getAxisAlignedBoundsFromObj(obj);
            const ocx = ab ? ab.x + ab.w / 2 : 0;
            const ocy = ab ? ab.y + ab.h / 2 : 0;
            this.groupRotateBases.set(id, { obj: this._cloneObject(obj), cx: ocx, cy: ocy });
          }
          return;
        }
        const handles = this._getHandlePositions(gb);
        const R = this.HANDLE_R + 3;
        for (let i = 0; i < handles.length; i++) {
          if (Math.hypot(x - handles[i].x, y - handles[i].y) <= R) {
            this.isGroupResizing  = true;
            this.isDrawing        = true;
            this.groupResizeHIdx  = i;
            this.dragStart        = { x, y };
            this.groupResizeGb    = { x: gb.cx - gb.w/2, y: gb.cy - gb.h/2, w: gb.w, h: gb.h };
            this.groupResizeBases = new Map();
            for (const id of this.selectedIds) {
              const obj = this._getObjectById(id);
              if (obj) this.groupResizeBases.set(id, this._cloneObject(obj));
            }
            return;
          }
        }
      }
    }

    // 1. Check rotation handle (only when single unlocked object selected)
    if (this.selectedIds.size === 1) {
      const [id] = this.selectedIds;
      const obj  = this._getObjectById(id);
      if (obj && !obj.locked) {
        if (this._hitRotationHandle(obj, x, y)) {
          this.isRotating   = true;
          this.isDrawing    = true;
          this.rotateObjId  = id;
          this.rotateBase   = this._cloneObject(obj);
          const b = this._getBoundsForOverlay(obj);
          this.rotateCenter = { x: b.cx, y: b.cy };
          return;
        }
        // 2. Check resize handles
        const hi = this._hitResizeHandle(obj, x, y);
        if (hi !== -1) {
          this.isResizing      = true;
          this.isDrawing       = true;
          this.resizeHandleIdx = hi;
          this.resizeObjId     = id;
          this.resizeBase      = this._cloneObject(obj);
          this.dragStart       = { x, y };
          return;
        }
      }
    }

    const hit = this._findObjectAt(x, y);

    if (shiftKey) {
      if (hit) {
        if (this.selectedIds.has(hit.id)) this.selectedIds.delete(hit.id);
        else this.selectedIds.add(hit.id);
      }
      this._drawSelectionOverlay();
    } else {
      if (hit) {
        if (!this.selectedIds.has(hit.id)) this.selectedIds = new Set([hit.id]);
        // Only begin drag if the object is not locked
        if (!hit.locked) {
          this.isDrawing  = true;
          this.isDragging = true;
          this.dragStart  = { x, y };
          this.dragBases  = new Map();
          for (const id of this.selectedIds) {
            const o = this._getObjectById(id);
            if (o && !o.locked) this.dragBases.set(id, this._cloneObject(o));
          }
        }
        this._drawSelectionOverlay();
      } else {
        // Empty space — start marquee
        this.selectedIds.clear();
        this.isMarquee    = true;
        this.marqueeStart = { x, y };
        this.marqueeEnd   = { x, y };
        this._drawSelectionOverlay();
      }
    }
  }

  _handleSelectMove(x, y) {
    if (this.isGroupRotating) {
      this._applyGroupRotate(x, y);
      this.renderAll(); this._drawSelectionOverlay();
      this._drawRotationAngleLabel();
      return;
    }
    if (this.isGroupResizing) {
      this._applyGroupResize(x, y);
      this.renderAll(); this._drawSelectionOverlay();
      this._drawAlignmentGuides();
      return;
    }
    if (this.isRotating) {
      const obj = this._getObjectById(this.rotateObjId);
      if (!obj) return;
      obj.rotation = Math.atan2(y - this.rotateCenter.y, x - this.rotateCenter.x) + Math.PI / 2;
      this.renderAll();
      this._drawSelectionOverlay();
      this._drawRotationAngleLabel();
      return;
    }

    if (this.isResizing) {
      this._applyResize(x, y);
      this.renderAll();
      this._drawSelectionOverlay();
      this._drawAlignmentGuides();
      return;
    }

    if (this.isMarquee) {
      this.marqueeEnd = { x, y };
      this._drawMarqueeOverlay();
      return;
    }

    if (!this.isDragging || this.selectedIds.size === 0) return;
    const dx = x - this.dragStart.x;
    const dy = y - this.dragStart.y;
    for (const id of this.selectedIds) {
      const obj  = this._getObjectById(id);
      const base = this.dragBases.get(id);
      if (obj && base) this._moveFromBase(obj, base, dx, dy);
    }
    this.renderAll();
    this._drawSelectionOverlay();
    this._drawAlignmentGuides();
  }

  _handleSelectUp(x, y) {
    if (this.isGroupRotating) {
      this.isGroupRotating = false; this.isDrawing = false;
      this.groupRotateBases = null; this._lastRotAngleDeg = null;
      this.saveSnap(); this._drawSelectionOverlay();
      return;
    }
    if (this.isGroupResizing) {
      this.isGroupResizing = false; this.isDrawing = false;
      this.groupResizeBases = null;
      this.saveSnap(); this._drawSelectionOverlay();
      return;
    }
    if (this.isRotating) {
      this.isRotating = false;
      this.isDrawing  = false;
      this._lastRotAngleDeg = null;
      this.saveSnap();
      this._drawSelectionOverlay();
      return;
    }

    if (this.isResizing) {
      this.isResizing = false;
      this.isDrawing  = false;
      this._alignGuides = null; // clear guides
      this.saveSnap();
      this._drawSelectionOverlay();
      return;
    }

    if (this.isMarquee) {
      this.isMarquee = false;
      this._finishMarquee();
      return;
    }

    if (this.isDragging) {
      this.isDragging = false;
      this.isDrawing  = false;
      this.dragStart  = null;
      this.dragBases  = null;
      this._alignGuides = null; // clear guides
      this.saveSnap();
      this._drawSelectionOverlay();
    }
  }

  // Pass null to clear all, or a single id to select only that id
  _setSelection(id) {
    this.selectedIds = id != null ? new Set([id]) : new Set();
    this._drawSelectionOverlay();
  }

  /* ── Marquee selection ─────────────────────────────────── */

  _finishMarquee() {
    if (!this.marqueeStart || !this.marqueeEnd) return;
    const mx1 = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
    const my1 = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
    const mx2 = Math.max(this.marqueeStart.x, this.marqueeEnd.x);
    const my2 = Math.max(this.marqueeStart.y, this.marqueeEnd.y);

    if (mx2 - mx1 > 4 || my2 - my1 > 4) {
      this.selectedIds.clear();
      for (const obj of this.objects) {
        const b = this._getAxisAlignedBounds(obj);
        if (!b) continue;
        if (b.x < mx2 && b.x + b.w > mx1 && b.y < my2 && b.y + b.h > my1) {
          this.selectedIds.add(obj.id);
        }
      }
    }
    this.marqueeStart = null;
    this.marqueeEnd   = null;
    this._drawSelectionOverlay();
  }

  _drawMarqueeOverlay() {
    this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
    if (this.selectedIds.size > 0) this._drawAllSelectionHandles();
    if (!this.marqueeStart || !this.marqueeEnd) return;
    const x = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
    const y = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
    const w = Math.abs(this.marqueeEnd.x - this.marqueeStart.x);
    const h = Math.abs(this.marqueeEnd.y - this.marqueeStart.y);
    this.pctx.save();
    this.pctx.fillStyle   = 'rgba(0,120,212,0.08)';
    this.pctx.strokeStyle = 'rgba(0,120,212,0.8)';
    this.pctx.lineWidth   = 1;
    this.pctx.setLineDash([4, 4]);
    this.pctx.fillRect(x, y, w, h);
    this.pctx.strokeRect(x + 0.5, y + 0.5, w, h);
    this.pctx.restore();
  }

  /* ── Selection overlay with handles ───────────────────── */

  _drawSelectionOverlay() {
    this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
    if (this._alignGuides && this._alignGuides.length) this._paintAlignmentGuides();
    if (this.selectedIds.size === 0) {
      this._updateGroupUI();
      this._drawBrushCursor();
      return;
    }
    this._drawAllSelectionHandles();
    this._updateGroupUI();
    this._syncControlsToSelection();
    this._drawBrushCursor();
  }

  _drawBrushCursor() {
    if (!this.isFreehand() || !this.cursorPos) return;
    const { x, y } = this.cursorPos;
    const isEraser = this.tool === 'eraser';
    // eraser uses size*2 line width, others use size — mirror _drawStroke logic
    const r = Math.max(1, isEraser ? this.size : this.size / 2);
    const ctx = this.pctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (isEraser) {
      ctx.strokeStyle = 'rgba(180,180,180,0.9)';
      ctx.setLineDash([4, 3]);
    } else {
      ctx.strokeStyle = this.rgba(this.color, Math.min(1, this.opacity + 0.3));
      ctx.setLineDash([]);
    }
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    // center dot
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = isEraser ? 'rgba(180,180,180,0.9)' : this.rgba(this.color, 1);
    ctx.fill();
    ctx.restore();
  }

  _drawAllSelectionHandles() {
    let gx1 = Infinity, gy1 = Infinity, gx2 = -Infinity, gy2 = -Infinity;

    for (const id of this.selectedIds) {
      const obj = this._getObjectById(id);
      if (!obj) continue;
      const b = this._getBoundsForOverlay(obj);
      if (!b) continue;

      this._drawDashedRectRotated(b, '#0078d4');

      if (this.selectedIds.size === 1 && !obj.locked) {
        this._drawResizeHandles(b);
        this._drawRotationHandle(b);
      }

      const ab = this._getAxisAlignedBounds(obj);
      if (!ab) continue;
      gx1 = Math.min(gx1, ab.x);        gy1 = Math.min(gy1, ab.y);
      gx2 = Math.max(gx2, ab.x + ab.w); gy2 = Math.max(gy2, ab.y + ab.h);
    }

    if (this.selectedIds.size > 1) {
      const pad = 6;
      this._drawDashedRect(gx1 - pad, gy1 - pad, gx2 - gx1 + pad * 2, gy2 - gy1 + pad * 2, '#e74c3c');
      const gb = { cx: (gx1+gx2)/2, cy: (gy1+gy2)/2, w: gx2-gx1+pad*2, h: gy2-gy1+pad*2, angle: 0 };
      const anyUnlocked = [...this.selectedIds].some(id => { const o = this._getObjectById(id); return o && !o.locked; });
      if (anyUnlocked) {
        this._drawResizeHandles(gb);
        this._drawRotationHandle(gb);
      }
    }
  }

  /**
   * Returns overlay info: cx, cy = center; w, h = dimensions; angle = rotation.
   */
  _getBoundsForOverlay(obj) {
    const ab = this._getAxisAlignedBoundsFromObj(obj);
    if (!ab) return null;
    const cx = ab.x + ab.w / 2;
    const cy = ab.y + ab.h / 2;
    const angle = obj.rotation || 0;
    return { cx, cy, w: ab.w, h: ab.h, angle };
  }

  _drawDashedRectRotated(b, color) {
    const { cx, cy, w, h, angle } = b;
    this.pctx.save();
    this.pctx.translate(cx, cy);
    this.pctx.rotate(angle);
    const x = -w / 2, y = -h / 2;
    this.pctx.lineWidth = 1;
    this.pctx.setLineDash([5, 5]);
    this.pctx.strokeStyle = 'rgba(255,255,255,0.7)';
    this.pctx.lineDashOffset = 0;
    this.pctx.strokeRect(x + 0.5, y + 0.5, w, h);
    this.pctx.strokeStyle = color;
    this.pctx.lineDashOffset = -5;
    this.pctx.strokeRect(x + 0.5, y + 0.5, w, h);
    this.pctx.restore();
  }

  _drawResizeHandles(b) {
    const handles = this._getHandlePositions(b);
    handles.forEach(h => {
      this.pctx.save();
      this.pctx.fillStyle   = '#ffffff';
      this.pctx.strokeStyle = '#0078d4';
      this.pctx.lineWidth   = 1.5;
      this.pctx.setLineDash([]);
      this.pctx.beginPath();
      this.pctx.rect(h.x - this.HANDLE_R, h.y - this.HANDLE_R, this.HANDLE_R * 2, this.HANDLE_R * 2);
      this.pctx.fill();
      this.pctx.stroke();
      this.pctx.restore();
    });
  }

  _drawRotationHandle(b) {
    const rh = this._getRotationHandlePos(b);
    // If actively rotating, draw the angle label next to the handle
    if ((this.isRotating || this.isGroupRotating) && (this._lastRotAngleDeg != null)) {
      this._drawRotAnglePill(rh.x, rh.y, this._lastRotAngleDeg);
    }
    const topCenter = this._rotatePoint(b.cx, b.cy, b.cx, b.cy - b.h / 2, b.angle);
    this.pctx.save();
    this.pctx.strokeStyle = '#0078d4';
    this.pctx.lineWidth   = 1.5;
    this.pctx.setLineDash([]);
    this.pctx.beginPath();
    this.pctx.moveTo(topCenter.x, topCenter.y);
    this.pctx.lineTo(rh.x, rh.y);
    this.pctx.stroke();
    this.pctx.fillStyle   = '#ffffff';
    this.pctx.strokeStyle = '#e67e22';
    this.pctx.beginPath();
    this.pctx.arc(rh.x, rh.y, this.ROT_HANDLE_R, 0, Math.PI * 2);
    this.pctx.fill();
    this.pctx.stroke();
    this.pctx.restore();
  }

  /** Returns 8 resize handle positions in screen space */
  _getHandlePositions(b) {
    const { cx, cy, w, h, angle } = b;
    const hw = w / 2, hh = h / 2;
    const local = [
      { x: -hw, y: -hh }, { x: 0, y: -hh }, { x: hw, y: -hh },
      { x: -hw, y: 0   },                    { x: hw, y: 0    },
      { x: -hw, y: hh  }, { x: 0, y: hh  }, { x: hw, y: hh   }
    ];
    return local.map(p => this._rotatePoint(cx, cy, cx + p.x, cy + p.y, angle));
  }

  /** Returns the rotation handle screen-space position */
  _getRotationHandlePos(b) {
    return this._rotatePoint(b.cx, b.cy, b.cx, b.cy - b.h / 2 - this.ROT_OFFSET, b.angle);
  }

  /** Draw a pill label showing the current rotation angle */
  _drawRotationAngleLabel() {
    // Determine angle from the relevant object/group
    let angleDeg = null;
    if (this.isRotating) {
      const obj = this._getObjectById(this.rotateObjId);
      if (obj) angleDeg = this._normalizeAngleDeg(obj.rotation || 0);
    } else if (this.isGroupRotating) {
      // Use the first selected object's rotation as representative
      const [firstId] = this.selectedIds;
      const obj = this._getObjectById(firstId);
      if (obj) angleDeg = this._normalizeAngleDeg(obj.rotation || 0);
    }
    if (angleDeg == null) return;
    this._lastRotAngleDeg = angleDeg;

    // Find the rotation handle position from the current overlay bounds
    let rh = null;
    if (this.isRotating) {
      const obj = this._getObjectById(this.rotateObjId);
      if (obj) {
        const b = this._getBoundsForOverlay(obj);
        if (b) rh = this._getRotationHandlePos(b);
      }
    } else if (this.isGroupRotating) {
      const ids = [...this.selectedIds];
      let gx1 = Infinity, gy1 = Infinity, gx2 = -Infinity, gy2 = -Infinity;
      for (const id of ids) {
        const ab = this._getAxisAlignedBounds(this._getObjectById(id));
        if (!ab) continue;
        gx1 = Math.min(gx1, ab.x); gy1 = Math.min(gy1, ab.y);
        gx2 = Math.max(gx2, ab.x + ab.w); gy2 = Math.max(gy2, ab.y + ab.h);
      }
      const pad = 6;
      const gb = { cx: (gx1+gx2)/2, cy: (gy1+gy2)/2, w: gx2-gx1+pad*2, h: gy2-gy1+pad*2, angle: 0 };
      rh = this._getRotationHandlePos(gb);
    }
    if (rh) this._drawRotAnglePill(rh.x, rh.y, angleDeg);
  }

  _drawRotAnglePill(hx, hy, deg) {
    const label = `${deg}°`;
    const ctx   = this.pctx;
    ctx.save();
    ctx.font = 'bold 11px system-ui, sans-serif';
    const tw  = ctx.measureText(label).width;
    const pw  = tw + 12, ph = 20, pr = 5;
    // Position pill to the right of the handle (or flip left near edge)
    const margin = 8;
    let px = hx + this.ROT_HANDLE_R + margin;
    if (px + pw > this.preview.width - 4) px = hx - this.ROT_HANDLE_R - margin - pw;
    const py = hy - ph / 2;
    // Pill background
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, pr);
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fill();
    // Label text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px + 6, py + ph / 2);
    ctx.restore();
  }

  _normalizeAngleDeg(rad) {
    let deg = Math.round(rad * 180 / Math.PI) % 360;
    if (deg < 0) deg += 360;
    return deg;
  }

  /* ── Alignment guides ──────────────────────────────────── */

  _drawAlignmentGuides() {
    const THRESH = 5; // px proximity to snap/show guide
    // Compute combined AABB of the moving selection
    let sx1 = Infinity, sy1 = Infinity, sx2 = -Infinity, sy2 = -Infinity;
    for (const id of this.selectedIds) {
      const b = this._getAxisAlignedBounds(this._getObjectById(id));
      if (!b) continue;
      sx1 = Math.min(sx1, b.x);       sy1 = Math.min(sy1, b.y);
      sx2 = Math.max(sx2, b.x + b.w); sy2 = Math.max(sy2, b.y + b.h);
    }
    if (!isFinite(sx1)) return;
    const scx = (sx1 + sx2) / 2, scy = (sy1 + sy2) / 2;
    const selAnchorsX = [sx1, scx, sx2];
    const selAnchorsY = [sy1, scy, sy2];

    const guides = []; // { axis:'x'|'y', value, span:[min,max] }

    for (const obj of this.objects) {
      if (this.selectedIds.has(obj.id)) continue;
      const b = this._getAxisAlignedBounds(obj);
      if (!b) continue;
      const ox1 = b.x, ox2 = b.x + b.w, ocx = (ox1 + ox2) / 2;
      const oy1 = b.y, oy2 = b.y + b.h, ocy = (oy1 + oy2) / 2;
      const targetsX = [ox1, ocx, ox2];
      const targetsY = [oy1, ocy, oy2];

      for (const sa of selAnchorsX) {
        for (const ta of targetsX) {
          if (Math.abs(sa - ta) <= THRESH) {
            const spanMin = Math.min(sy1, sy2, oy1, oy2);
            const spanMax = Math.max(sy1, sy2, oy1, oy2);
            guides.push({ axis: 'x', value: ta, span: [spanMin, spanMax] });
          }
        }
      }
      for (const sa of selAnchorsY) {
        for (const ta of targetsY) {
          if (Math.abs(sa - ta) <= THRESH) {
            const spanMin = Math.min(sx1, sx2, ox1, ox2);
            const spanMax = Math.max(sx1, sx2, ox1, ox2);
            guides.push({ axis: 'y', value: ta, span: [spanMin, spanMax] });
          }
        }
      }
    }

    // Deduplicate by axis+value
    const seen = new Set();
    this._alignGuides = guides.filter(g => {
      const key = `${g.axis}${g.value.toFixed(1)}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    this._paintAlignmentGuides();
  }

  _paintAlignmentGuides() {
    if (!this._alignGuides || !this._alignGuides.length) return;
    const ctx = this.pctx;
    const W = this.preview.width, H = this.preview.height;
    ctx.save();
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth   = 1;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = 0;
    for (const g of this._alignGuides) {
      const [sp0, sp1] = g.span;
      ctx.beginPath();
      if (g.axis === 'x') {
        // Vertical line — extend slightly beyond the span
        const pad = 16;
        ctx.moveTo(g.value + 0.5, Math.max(0, sp0 - pad));
        ctx.lineTo(g.value + 0.5, Math.min(H, sp1 + pad));
      } else {
        // Horizontal line
        const pad = 16;
        ctx.moveTo(Math.max(0, sp0 - pad), g.value + 0.5);
        ctx.lineTo(Math.min(W, sp1 + pad), g.value + 0.5);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Rotates point (px,py) around center (cx,cy) by angle radians */
  _rotatePoint(cx, cy, px, py, angle) {
    if (!angle) return { x: px, y: py };
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const dx = px - cx, dy = py - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  /** Returns handle index 0-7 if hit, else -1 */
  _hitResizeHandle(obj, x, y) {
    const b = this._getBoundsForOverlay(obj);
    if (!b) return -1;
    const handles = this._getHandlePositions(b);
    const R = this.HANDLE_R + 3;
    for (let i = 0; i < handles.length; i++) {
      if (Math.hypot(x - handles[i].x, y - handles[i].y) <= R) return i;
    }
    return -1;
  }

  /** Returns true if (x,y) hits the rotation handle */
  _hitRotationHandle(obj, x, y) {
    const b = this._getBoundsForOverlay(obj);
    if (!b) return false;
    const rh = this._getRotationHandlePos(b);
    return Math.hypot(x - rh.x, y - rh.y) <= this.ROT_HANDLE_R + 4;
  }

  /** Apply resize drag to the object */
  _applyResize(x, y) {
    const obj  = this._getObjectById(this.resizeObjId);
    const base = this.resizeBase;
    if (!obj || !base) return;

    const type  = obj.type || obj.tool;
    const angle = base.rotation || 0;
    const ab    = this._getAxisAlignedBoundsFromObj(base);
    if (!ab) return;
    const cx = ab.x + ab.w / 2, cy = ab.y + ab.h / 2;

    // Transform mouse and start point into un-rotated local space
    const localMouse = this._rotatePoint(cx, cy, x, y, -angle);
    const localStart = this._rotatePoint(cx, cy, this.dragStart.x, this.dragStart.y, -angle);
    const dx = localMouse.x - localStart.x;
    const dy = localMouse.y - localStart.y;

    const hi = this.resizeHandleIdx;
    // 0=TL 1=TC 2=TR / 3=ML 4=MR / 5=BL 6=BC 7=BR

    // Shift-lock: constrain proportions for corner handles
    const _shiftConstrain = (bx, by, bw, bh, nxIn, nyIn, nwIn, nhIn) => {
      if (!this.shiftDown || ![0,2,5,7].includes(hi)) return [nxIn, nyIn, nwIn, nhIn];
      const ar = bh > 0 ? bw / bh : 1;
      const scaleX = bw > 0 ? nwIn / bw : 1;
      const scaleY = bh > 0 ? nhIn / bh : 1;
      const scale = Math.abs(scaleX) >= Math.abs(scaleY) ? scaleX : scaleY;
      let nw2 = bw * scale, nh2 = bh * scale;
      if (nw2 < 4) nw2 = 4;
      if (nh2 < 4) nh2 = 4;
      let nx2 = nxIn, ny2 = nyIn;
      if ([0,3,5].includes(hi)) nx2 = bx + bw - nw2;  // left-side handles: anchor right edge
      if ([0,1,2].includes(hi)) ny2 = by + bh - nh2;  // top handles: anchor bottom edge
      return [nx2, ny2, nw2, nh2];
    };

    if (type === 'stroke') {
      const bx = ab.x, by = ab.y, bw = ab.w, bh = ab.h;
      let nx = bx, ny = by, nw = bw, nh = bh;
      if ([0,3,5].includes(hi)) { nx = bx + dx; nw = bw - dx; }
      if ([2,4,7].includes(hi)) { nw = bw + dx; }
      if ([0,1,2].includes(hi)) { ny = by + dy; nh = bh - dy; }
      if ([5,6,7].includes(hi)) { nh = bh + dy; }
      if (nw < 4) nw = 4; if (nh < 4) nh = 4;
      [nx, ny, nw, nh] = _shiftConstrain(bx, by, bw, bh, nx, ny, nw, nh);
      const scaleX = bw > 0 ? nw / bw : 1;
      const scaleY = bh > 0 ? nh / bh : 1;
      obj.points = base.points.map(p => ({ x: nx + (p.x - bx) * scaleX, y: ny + (p.y - by) * scaleY }));
      return;
    }

    if (type === 'text') {
      const bh = ab.h;
      let delta = 0;
      if ([0,1,2].includes(hi)) delta = -dy;
      if ([5,6,7].includes(hi)) delta = dy;
      const scale = bh > 0 ? (bh + delta) / bh : 1;
      obj.fontSize = Math.max(6, (base.fontSize || 14) * scale);
      return;
    }

    if (type === 'group') {
      const bx = ab.x, by = ab.y, bw = ab.w, bh = ab.h;
      let nx = bx, ny = by, nw = bw, nh = bh;
      if ([0,3,5].includes(hi)) { nx = bx + dx; nw = bw - dx; }
      if ([2,4,7].includes(hi)) { nw = bw + dx; }
      if ([0,1,2].includes(hi)) { ny = by + dy; nh = bh - dy; }
      if ([5,6,7].includes(hi)) { nh = bh + dy; }
      if (nw < 4) nw = 4; if (nh < 4) nh = 4;
      [nx, ny, nw, nh] = _shiftConstrain(bx, by, bw, bh, nx, ny, nw, nh);
      const oldB = { x: bx, y: by, w: bw, h: bh };
      const newB = { x: nx, y: ny, w: nw, h: nh };
      obj.children = base.children.map(child => {
        const c = this._cloneObject(child);
        this._scaleObjCoords(c, oldB, newB);
        return c;
      });
      return;
    }

    if (type === 'image') {
      const bx = base.x, by = base.y, bw = base.w, bh = base.h;
      let nx = bx, ny = by, nw = bw, nh = bh;
      if ([0,3,5].includes(hi)) { nx = bx + dx; nw = bw - dx; }
      if ([2,4,7].includes(hi)) { nw = bw + dx; }
      if ([0,1,2].includes(hi)) { ny = by + dy; nh = bh - dy; }
      if ([5,6,7].includes(hi)) { nh = bh + dy; }
      if (nw < 10) nw = 10; if (nh < 10) nh = 10;
      [nx, ny, nw, nh] = _shiftConstrain(bx, by, bw, bh, nx, ny, nw, nh);
      obj.x = nx; obj.y = ny; obj.w = nw; obj.h = nh;
      return;
    }

    // Shape: manipulate x1,y1,x2,y2
    const sbx=Math.min(base.x1,base.x2), sby=Math.min(base.y1,base.y2);
    const sbw=Math.abs(base.x2-base.x1), sbh=Math.abs(base.y2-base.y1);
    let lx1 = Math.min(base.x1, base.x2), ly1 = Math.min(base.y1, base.y2);
    let lx2 = Math.max(base.x1, base.x2), ly2 = Math.max(base.y1, base.y2);
    if ([0,3,5].includes(hi)) lx1 += dx;
    if ([2,4,7].includes(hi)) lx2 += dx;
    if ([0,1,2].includes(hi)) ly1 += dy;
    if ([5,6,7].includes(hi)) ly2 += dy;
    if (lx2 - lx1 < 4) { if ([0,3,5].includes(hi)) lx1 = lx2 - 4; else lx2 = lx1 + 4; }
    if (ly2 - ly1 < 4) { if ([0,1,2].includes(hi)) ly1 = ly2 - 4; else ly2 = ly1 + 4; }
    {
      let [nx, ny, nw, nh] = _shiftConstrain(sbx, sby, sbw, sbh, lx1, ly1, lx2-lx1, ly2-ly1);
      lx1=nx; ly1=ny; lx2=nx+nw; ly2=ny+nh;
    }
    const origFlipX = base.x1 > base.x2, origFlipY = base.y1 > base.y2;
    obj.x1 = origFlipX ? lx2 : lx1; obj.y1 = origFlipY ? ly2 : ly1;
    obj.x2 = origFlipX ? lx1 : lx2; obj.y2 = origFlipY ? ly1 : ly2;
  }

  /** Computes the handle-overlay bounds for the multi-select group box (same rect as the red dashed border) */
  _multiSelectHandleBounds() {
    if (this.selectedIds.size < 2) return null;
    let gx1=Infinity, gy1=Infinity, gx2=-Infinity, gy2=-Infinity;
    for (const id of this.selectedIds) {
      const obj = this._getObjectById(id);
      if (!obj) continue;
      const ab = this._getAxisAlignedBounds(obj);
      if (!ab) continue;
      gx1 = Math.min(gx1, ab.x);       gy1 = Math.min(gy1, ab.y);
      gx2 = Math.max(gx2, ab.x+ab.w);  gy2 = Math.max(gy2, ab.y+ab.h);
    }
    if (!isFinite(gx1)) return null;
    const pad = 6;
    return { cx: (gx1+gx2)/2, cy: (gy1+gy2)/2, w: gx2-gx1+pad*2, h: gy2-gy1+pad*2, angle: 0 };
  }

  /** Proportionally scale all selected objects to match the new dragged group bounding box */
  _applyGroupResize(x, y) {
    const gb  = this.groupResizeGb;
    const hi  = this.groupResizeHIdx;
    const dx  = x - this.dragStart.x;
    const dy  = y - this.dragStart.y;
    let nx=gb.x, ny=gb.y, nw=gb.w, nh=gb.h;
    if ([0,3,5].includes(hi)) { nx=gb.x+dx; nw=gb.w-dx; }
    if ([2,4,7].includes(hi)) { nw=gb.w+dx; }
    if ([0,1,2].includes(hi)) { ny=gb.y+dy; nh=gb.h-dy; }
    if ([5,6,7].includes(hi)) { nh=gb.h+dy; }
    if (nw < 10) { if ([0,3,5].includes(hi)) nx=gb.x+gb.w-10; nw=10; }
    if (nh < 10) { if ([0,1,2].includes(hi)) ny=gb.y+gb.h-10; nh=10; }
    // Shift: lock aspect ratio on corner handles
    if (this.shiftDown && [0,2,5,7].includes(hi)) {
      const ar = gb.h > 0 ? gb.w / gb.h : 1;
      const scaleX = gb.w > 0 ? nw / gb.w : 1;
      const scaleY = gb.h > 0 ? nh / gb.h : 1;
      const scale = Math.abs(scaleX) >= Math.abs(scaleY) ? scaleX : scaleY;
      nw = gb.w * scale; nh = gb.h * scale;
      if ([0,3,5].includes(hi)) nx = gb.x + gb.w - nw;
      if ([0,1,2].includes(hi)) ny = gb.y + gb.h - nh;
    }
    const newGb = { x: nx, y: ny, w: nw, h: nh };
    for (const [id, base] of this.groupResizeBases) {
      const obj = this._getObjectById(id);
      if (!obj) continue;
      const c = this._cloneObject(base);
      this._scaleObjCoords(c, gb, newGb);
      this._copyObjCoords(obj, c);
    }
  }

  /** Rotate all selected objects around the group center */
  _applyGroupRotate(x, y) {
    const { cx, cy } = this.groupRotateCenter;
    const curAng = Math.atan2(y - cy, x - cx);
    const delta  = curAng - this.groupRotateBase0;
    for (const [id, info] of this.groupRotateBases) {
      const obj = this._getObjectById(id);
      if (!obj) continue;
      // Rotate the saved object-center around group center to get new position
      const np = this._rotatePoint(cx, cy, info.cx, info.cy, delta);
      const ddx = np.x - info.cx;
      const ddy = np.y - info.cy;
      this._moveFromBase(obj, info.obj, ddx, ddy);
      obj.rotation = (info.obj.rotation || 0) + delta;
    }
  }

  /** Copy positional coords from src to dst without touching style properties */
  _copyObjCoords(dst, src) {
    const type = dst.type || dst.tool;
    if (type === 'stroke')      { dst.points = src.points; }
    else if (type === 'text')   { dst.x = src.x; dst.y = src.y; dst.fontSize = src.fontSize; }
    else if (type === 'image')  { dst.x = src.x; dst.y = src.y; dst.w = src.w; dst.h = src.h; }
    else if (type === 'group')  { dst.children = src.children; }
    else                        { dst.x1=src.x1; dst.y1=src.y1; dst.x2=src.x2; dst.y2=src.y2; }
  }

  _updateSelectCursor(x, y) {
    // Group handles first
    if (this.selectedIds.size > 1) {
      const gb = this._multiSelectHandleBounds();
      if (gb) {
        const rh = this._getRotationHandlePos(gb);
        if (Math.hypot(x - rh.x, y - rh.y) <= this.ROT_HANDLE_R + 4) { this.preview.style.cursor = 'grab'; return; }
        const handles = this._getHandlePositions(gb);
        const R = this.HANDLE_R + 3;
        const cursors = ['nw-resize','n-resize','ne-resize','w-resize','e-resize','sw-resize','s-resize','se-resize'];
        for (let i = 0; i < handles.length; i++) {
          if (Math.hypot(x - handles[i].x, y - handles[i].y) <= R) { this.preview.style.cursor = cursors[i]; return; }
        }
      }
    }
    if (this.selectedIds.size === 1) {
      const [id] = this.selectedIds;
      const obj  = this._getObjectById(id);
      if (obj) {
        if (this._hitRotationHandle(obj, x, y)) { this.preview.style.cursor = 'grab'; return; }
        const hi = this._hitResizeHandle(obj, x, y);
        if (hi !== -1) {
          const cursors = ['nw-resize','n-resize','ne-resize','w-resize',
                           'e-resize','sw-resize','s-resize','se-resize'];
          this.preview.style.cursor = cursors[hi];
          return;
        }
      }
    }
    const hov = this._findObjectAt(x, y);
    this.preview.style.cursor = (hov && this.selectedIds.has(hov.id)) ? 'move' : hov ? 'pointer' : 'default';
  }

  _drawDashedRect(x, y, w, h, color) {
    this.pctx.save();
    this.pctx.lineWidth = 1;
    this.pctx.setLineDash([5, 5]);
    this.pctx.strokeStyle = 'rgba(255,255,255,0.8)';
    this.pctx.lineDashOffset = 0;
    this.pctx.strokeRect(x + 0.5, y + 0.5, w, h);
    this.pctx.strokeStyle = color;
    this.pctx.lineDashOffset = -5;
    this.pctx.strokeRect(x + 0.5, y + 0.5, w, h);
    this.pctx.restore();
  }

  /* ── Freehand drawing ──────────────────────────────────── */
  _updateFreehandPreview(x, y) {
    if (!this.currentStroke) return;
    this.currentStroke.points.push({ x, y });
    if (this.tool === 'eraser') {
      this._renderWithOverlay();
      return;
    }
    this.renderAll();
    this._drawStroke(this.ctx, this.currentStroke);
  }

  /* ── Shape preview & commit ────────────────────────────── */
  _updateShapePreview(x, y) {
    if (!this.currentShape) return;
    let ex = x, ey = y;
    if (this.shiftDown) {
      const dx = ex - this.currentShape.x1;
      const dy = ey - this.currentShape.y1;
      const side = Math.min(Math.abs(dx), Math.abs(dy));
      ex = this.currentShape.x1 + Math.sign(dx || 1) * side;
      ey = this.currentShape.y1 + Math.sign(dy || 1) * side;
    }
    this.currentShape.x2 = ex;
    this.currentShape.y2 = ey;
    this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
    this._drawObject(this.pctx, this.currentShape);
  }

  /* ── Text tool ─────────────────────────────────────────── */

  placeText(x, y) {
    const overlay = document.getElementById('textOverlay');
    const input   = document.getElementById('textInput');
    const fontSize = Math.max(14, this.size * 2.5);

    overlay.style.left    = x + 'px';
    overlay.style.top     = y + 'px';
    overlay.style.display = 'block';

    input.style.color    = this.color;
    input.style.fontSize = fontSize + 'px';
    input.value = '';
    this.textPending = { x, y, fontSize };

    input.onblur   = () => this.commitText();
    input.onkeydown = e => { if (e.key === 'Escape') { input.value = ''; this.commitText(); } };

    setTimeout(() => input.focus(), 10);
  }

  commitText() {
    const overlay = document.getElementById('textOverlay');
    const input   = document.getElementById('textInput');
    if (!this.textPending || overlay.style.display === 'none') return;

    const text = input.value.trim();
    const { x, y, fontSize } = this.textPending;

    if (text) {
      const lines = text.split('\n');
      this.objects.push({
        id: this._nextId++,
        type: 'text',
        x,
        y,
        lines,
        fontSize,
        color: this.color,
        opacity: this.opacity,
        fontFamily: "'Segoe UI', sans-serif"
      });
      this.renderAll();
      this.saveSnap();
    }

    overlay.style.display = 'none';
    this.textPending = null;
  }

  /* ── History ───────────────────────────────────────────── */

  saveSnap() {
    // Discard any forward history after current pointer
    this.history = this.history.slice(0, this.historyPtr + 1);
    this.history.push(this._cloneObjects());
    if (this.history.length > this.MAX_HISTORY) this.history.shift();
    this.historyPtr = this.history.length - 1;
    this.updateHistoryUI();
    this._updateCurrentPageThumbnail();
  }

  undo() {
    this._setSelection(null);
    if (this.historyPtr <= 0) return;
    this.historyPtr--;
    this.objects = this._cloneObjects(this.history[this.historyPtr]);
    this.renderAll();
    this.updateHistoryUI();
    this._updateCurrentPageThumbnail();
  }

  redo() {
    this._setSelection(null);
    if (this.historyPtr >= this.history.length - 1) return;
    this.historyPtr++;
    this.objects = this._cloneObjects(this.history[this.historyPtr]);
    this.renderAll();
    this.updateHistoryUI();
    this._updateCurrentPageThumbnail();
  }

  updateHistoryUI() {
    document.getElementById('undoBtn').disabled = this.historyPtr <= 0;
    document.getElementById('redoBtn').disabled = this.historyPtr >= this.history.length - 1;
  }

  /* ── Actions ───────────────────────────────────────────── */

  clearCanvas() {
    this._setSelection(null);
    this.objects = [];
    this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
    this.ctx.clearRect(0, 0, this.main.width, this.main.height);
    this.saveSnap();
  }

  download() {
    // Composite onto background (or transparent if bg hidden)
    const tmp    = document.createElement('canvas');
    tmp.width    = this.main.width;
    tmp.height   = this.main.height;
    const tc     = tmp.getContext('2d');
    if (this.bgVisible) {
      tc.fillStyle = this.bgColor;
      tc.fillRect(0, 0, tmp.width, tmp.height);
    }
    tc.drawImage(this.main, 0, 0);

    const a      = document.createElement('a');
    const ts     = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    a.download   = `canvas-${ts}.png`;
    a.href       = tmp.toDataURL('image/png');
    a.click();
  }

  close() {
    if (window.parent !== window) {
      window.parent.postMessage('canvas-close', '*');
    } else {
      window.close();
    }
  }

  /* ── Keyboard shortcuts ────────────────────────────────── */

  onKey(e) {
    // Ctrl/Meta combos
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); this.redo(); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); this.download(); return; }
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        if (e.shiftKey) this._ungroupSelected(); else this._groupSelected();
        return;
      }
      if ((e.key === 'a' || e.key === 'A') && this.tool === 'select') {
        e.preventDefault();
        this.selectedIds = new Set(this.objects.map(o => o.id));
        this._drawSelectionOverlay();
        return;
      }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); this._toggleLock(); return; }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); this._copySelected(); return; }
      if (e.key === 'd' || e.key === 'D') { e.preventDefault(); this._duplicateSelected(); return; }
      if (e.key === ']' || e.key === '}') { e.preventDefault(); e.shiftKey ? this._bringToFront() : this._bringForward(); return; }
      if (e.key === '[' || e.key === '{') { e.preventDefault(); e.shiftKey ? this._sendToBack()   : this._sendBackward();  return; }
      // Ctrl+V: handled entirely via the 'paste' DOM event (see _handleExternalPaste).
      // Do NOT preventDefault here — that would suppress the paste event in Chromium.
      return;
    }

    if (this.isTyping()) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && this.tool === 'select' && this.selectedIds.size > 0) {
      e.preventDefault();
      this._deleteSelected();
      return;
    }

    if (this.tool === 'select' && this.selectedIds.size > 0 &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
      for (const id of this.selectedIds) {
        const obj = this._getObjectById(id);
        if (obj && !obj.locked) this._moveFromBase(obj, this._cloneObject(obj), dx, dy);
      }
      this.renderAll();
      this._drawSelectionOverlay();
      // Debounce saveSnap so holding a key doesn't flood history
      clearTimeout(this._nudgeSnapTimer);
      this._nudgeSnapTimer = setTimeout(() => this.saveSnap(), 400);
      return;
    }

    const toolMap = {
      v: 'select',
      p: 'pencil', b: 'brush', m: 'marker', e: 'eraser',
      l: 'line',   r: 'rect',  c: 'circle', g: 'polygon',
      a: 'arrow',  t: 'text'
    };
    const tool = toolMap[e.key.toLowerCase()];
    if (tool) { e.preventDefault(); this.selectTool(tool); return; }

    if (e.key === 'Escape') { this.commitText(); this._setSelection(null); return; }
  }

  isTyping() {
    const el = document.activeElement;
    return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
  }

  selectTool(name) {
    this._setSelection(null);
    this.tool = name;
    const isBrush = ['pencil','brush','marker','eraser'].includes(name);
    if (isBrush) this._updateBrushTrigger(name);
    const isShape = [
      'line','rect','circle','polygon','triangle','hexagon','arrow',
      'pill','diamond','parallelogram','trapezoid','trapdown',
      'cross','frame','heart','cloud','speechbubble','speechoval',
      'bookmark','ribbon','arch','stadium',
      'star','starburst'
    ].includes(name);
    if (isShape) this._updateFlyoutTrigger('shapeFlyout', name);
    // Snap sides slider to the natural default when switching to a fixed-polygon tool
    const defaultSides = name === 'triangle' ? 3 : name === 'hexagon' ? 6 : null;
    if (defaultSides !== null) {
      this.sides = defaultSides;
      const sr = document.getElementById('sidesRange');
      const sv = document.getElementById('sidesVal');
      if (sr) sr.value = defaultSides;
      if (sv) sv.textContent = defaultSides;
    }
    document.querySelectorAll('.cv-tool[data-tool]').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === name);
    });
    this.updateCursor();
  }

  _updateBrushTrigger(name) {
    this._updateFlyoutTrigger('brushFlyout', name);
  }

  _updateFlyoutTrigger(flyoutId, name) {
    const flyout = document.getElementById(flyoutId);
    if (!flyout) return;
    const trigger = flyout.querySelector('[id$="Trigger"]');
    const source  = flyout.querySelector(`.cv-flyout-menu [data-tool="${name}"]`);
    if (!trigger || !source) return;
    trigger.dataset.tool = name;
    trigger.title = source.title;
    // Copy the icon — works for both <i> (FontAwesome) and inline <svg> buttons
    trigger.innerHTML = source.innerHTML;
  }

  _bindFlyout(flyoutId) {
    const flyout = document.getElementById(flyoutId);
    const menu   = flyout && flyout.querySelector('.cv-flyout-menu');
    if (!flyout || !menu) return;
    let hideTimer = null;
    const show = () => {
      clearTimeout(hideTimer);
      const r = flyout.getBoundingClientRect();
      menu.style.top  = r.bottom + 'px';   // no gap — avoids mouseleave dead zone
      menu.style.left = '0px';
      menu.classList.add('open');
      requestAnimationFrame(() => {
        menu.style.left = (r.left + r.width / 2 - menu.offsetWidth / 2) + 'px';
      });
    };
    const hide = (e) => {
      // Skip if mouse is moving between the trigger wrapper and the menu
      if (e && (flyout.contains(e.relatedTarget) || menu.contains(e.relatedTarget))) return;
      hideTimer = setTimeout(() => menu.classList.remove('open'), 300);
    };
    flyout.addEventListener('mouseenter', show);
    flyout.addEventListener('mouseleave', hide);
    menu.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    menu.addEventListener('mouseleave', hide);
  }

  /* ── Object model helpers ─────────────────────────────── */

  _commitFreehandStroke(x, y) {
    if (!this.currentStroke) return;
    this.currentStroke.points.push({ x, y });

    if (this.currentStroke.tool === 'eraser') {
      this._eraseByStroke(this.currentStroke);
      this.currentStroke = null;
      this.renderAll();
      this.saveSnap();
      return;
    }

    this.objects.push({
      id: this._nextId++,
      type: 'stroke',
      points: this.currentStroke.points,
      color: this.currentStroke.color,
      size: this.currentStroke.size,
      opacity: this.currentStroke.opacity,
      tool: this.currentStroke.tool
    });
    this.currentStroke = null;
    this.renderAll();
    this.saveSnap();
  }

  _commitShape(x, y) {
    if (!this.currentShape) return;
    let ex = x, ey = y;
    if (this.shiftDown) {
      const dx = ex - this.currentShape.x1;
      const dy = ey - this.currentShape.y1;
      const side = Math.min(Math.abs(dx), Math.abs(dy));
      ex = this.currentShape.x1 + Math.sign(dx || 1) * side;
      ey = this.currentShape.y1 + Math.sign(dy || 1) * side;
    }
    this.currentShape.x2 = ex;
    this.currentShape.y2 = ey;
    const shape = {
      id: this._nextId++,
      type: this.currentShape.tool,
      x1: this.currentShape.x1,
      y1: this.currentShape.y1,
      x2: this.currentShape.x2,
      y2: this.currentShape.y2,
      color: this.currentShape.color,
      size: this.currentShape.size,
      opacity: this.currentShape.opacity,
      fill: this.currentShape.fill,
      cornerRadius: this.cornerRadius,
      sides: this.sides,
      rotation: 0
    };
    this.currentShape = null;
    this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
    this.objects.push(shape);
    this.renderAll();
    this.saveSnap();
  }

  renderAll() {
    this.ctx.clearRect(0, 0, this.main.width, this.main.height);
    if (this.bgVisible) {
      this.ctx.save();
      this.ctx.fillStyle = this.bgColor;
      this.ctx.fillRect(0, 0, this.main.width, this.main.height);
      this.ctx.restore();
    }
    this.objects.forEach(obj => this._drawObject(this.ctx, obj));
  }

  _renderWithOverlay() {
    this.renderAll();
    this._drawSelectionOverlay();
  }

  _drawObject(ctx, obj) {
    const type = obj.type || obj.tool;

    if (type === 'group') {
      ctx.save();
      const rotation = obj.rotation || 0;
      if (rotation) {
        const b = this._getAxisAlignedBoundsFromObj(obj);
        if (b) {
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          ctx.translate(cx, cy); ctx.rotate(rotation); ctx.translate(-cx, -cy);
        }
      }
      obj.children.forEach(child => this._drawObject(ctx, child));
      ctx.restore();
      return;
    }

    if (type === 'stroke') {
      this._drawStroke(ctx, obj);
      return;
    }

    if (type === 'text') {
      this._drawText(ctx, obj);
      return;
    }

    if (type === 'image') {
      this._drawImageObj(ctx, obj);
      return;
    }

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = this.rgba(obj.color, obj.opacity);
    ctx.fillStyle   = this.rgba(obj.color, obj.opacity);
    ctx.lineWidth   = obj.size || this.size;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowBlur  = 0;

    const x1 = obj.x1, y1 = obj.y1;
    const x2 = obj.x2, y2 = obj.y2;
    const w = x2 - x1, h = y2 - y1;

    // Apply rotation around object center
    const rotation = obj.rotation || 0;
    if (rotation) {
      const cx = x1 + w / 2, cy = y1 + h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      ctx.translate(-cx, -cy);
    }

    ctx.beginPath();
    switch (type) {
      case 'line':
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;

      case 'rect': {
        const cr = obj.cornerRadius || 0;
        const radius = cr > 0 ? (cr / 100) * Math.min(Math.abs(w), Math.abs(h)) / 2 : 0;
        if (radius > 0) {
          ctx.roundRect(x1, y1, w, h, radius);
          if (obj.fill) ctx.fill(); else ctx.stroke();
        } else {
          if (obj.fill) ctx.fillRect(x1, y1, w, h);
          else ctx.strokeRect(x1, y1, w, h);
        }
        break;
      }

      case 'circle': {
        const cx = x1 + w / 2, cy = y1 + h / 2;
        const rx = Math.abs(w) / 2 || 1;
        const ry = Math.abs(h) / 2 || 1;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'triangle':
      case 'hexagon':
      case 'polygon': {
        const n = (obj.sides != null ? Math.round(obj.sides) : (type === 'hexagon' ? 6 : 3));
        const cx = x1 + w / 2, cy = y1 + h / 2;
        const rx = Math.abs(w) / 2 || 1;
        const ry = Math.abs(h) / 2 || 1;
        // Start from top (-π/2) for odd-sided polygons (triangle points up)
        const startAngle = -Math.PI / 2;
        const cr = obj.cornerRadius || 0;
        if (cr > 0) {
          // Rounded polygon: arc at each vertex
          const arcR = (cr / 100) * Math.min(rx, ry) * 0.8;
          const verts = [];
          for (let i = 0; i < n; i++) {
            const a = startAngle + (i / n) * Math.PI * 2;
            verts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
          }
          for (let i = 0; i < n; i++) {
            const prev = verts[(i - 1 + n) % n];
            const cur  = verts[i];
            const next  = verts[(i + 1) % n];
            const d1x = cur.x - prev.x, d1y = cur.y - prev.y;
            const d2x = next.x - cur.x, d2y = next.y - cur.y;
            const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
            const t = Math.min(arcR, l1 / 2, l2 / 2);
            const p1 = { x: cur.x - t * d1x / l1, y: cur.y - t * d1y / l1 };
            const p2 = { x: cur.x + t * d2x / l2, y: cur.y + t * d2y / l2 };
            if (i === 0) ctx.moveTo(p1.x, p1.y);
            else ctx.lineTo(p1.x, p1.y);
            ctx.quadraticCurveTo(cur.x, cur.y, p2.x, p2.y);
          }
        } else {
          for (let i = 0; i < n; i++) {
            const a = startAngle + (i / n) * Math.PI * 2;
            const px = cx + rx * Math.cos(a);
            const py = cy + ry * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
        }
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'arrow': {
        const angle  = Math.atan2(y2 - y1, x2 - x1);
        const headLen = Math.max(15, (obj.size || this.size) * 3);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(
          x2 - headLen * Math.cos(angle - Math.PI / 6),
          y2 - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(x2, y2);
        ctx.lineTo(
          x2 - headLen * Math.cos(angle + Math.PI / 6),
          y2 - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
        break;
      }

      /* ── New extra shapes ─────────────────────────────── */

      case 'pill': {
        // Fully-rounded stadium / pill
        const r = Math.min(Math.abs(w), Math.abs(h)) / 2;
        ctx.roundRect(x1, y1, w, h, r);
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'diamond': {
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||1, bh = Math.abs(h)||1;
        ctx.moveTo(bx + bw/2, by);
        ctx.lineTo(bx + bw,   by + bh/2);
        ctx.lineTo(bx + bw/2, by + bh);
        ctx.lineTo(bx,        by + bh/2);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'parallelogram': {
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||1, bh = Math.abs(h)||1;
        const sl = bw * 0.25;
        ctx.moveTo(bx + sl,      by);
        ctx.lineTo(bx + bw,      by);
        ctx.lineTo(bx + bw - sl, by + bh);
        ctx.lineTo(bx,           by + bh);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'trapezoid': {
        // Wider bottom, narrower top
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||1, bh = Math.abs(h)||1;
        const ins = bw * 0.2;
        ctx.moveTo(bx + ins,      by);
        ctx.lineTo(bx + bw - ins, by);
        ctx.lineTo(bx + bw,       by + bh);
        ctx.lineTo(bx,            by + bh);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'trapdown': {
        // Wider top, narrower bottom
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||1, bh = Math.abs(h)||1;
        const ins = bw * 0.2;
        ctx.moveTo(bx,            by);
        ctx.lineTo(bx + bw,       by);
        ctx.lineTo(bx + bw - ins, by + bh);
        ctx.lineTo(bx + ins,      by + bh);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'cross': {
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||1, bh = Math.abs(h)||1;
        const tx = bw / 3, ty = bh / 3;
        ctx.moveTo(bx + tx,      by);
        ctx.lineTo(bx + bw - tx, by);
        ctx.lineTo(bx + bw - tx, by + ty);
        ctx.lineTo(bx + bw,      by + ty);
        ctx.lineTo(bx + bw,      by + bh - ty);
        ctx.lineTo(bx + bw - tx, by + bh - ty);
        ctx.lineTo(bx + bw - tx, by + bh);
        ctx.lineTo(bx + tx,      by + bh);
        ctx.lineTo(bx + tx,      by + bh - ty);
        ctx.lineTo(bx,           by + bh - ty);
        ctx.lineTo(bx,           by + ty);
        ctx.lineTo(bx + tx,      by + ty);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'frame': {
        // Pincushion / barrel — all 4 sides bow inward
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||1, bh = Math.abs(h)||1;
        const bow = Math.min(bw, bh) * 0.15;
        const mx = bx + bw / 2, my = by + bh / 2;
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(mx,        by + bow,      bx + bw, by);
        ctx.quadraticCurveTo(bx+bw-bow, my,            bx + bw, by + bh);
        ctx.quadraticCurveTo(mx,        by+bh-bow,     bx,      by + bh);
        ctx.quadraticCurveTo(bx + bow,  my,            bx,      by);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      // case 'heart': {
      //   const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||2, bh = Math.abs(h)||2;
      //   const p = (nx, ny) => [bx + nx * bw, by + ny * bh];
      //   ctx.moveTo(...p(0.5, 0.30));    // top notch
      //   // Left hump
      //   ctx.bezierCurveTo(...p(0.45, 0.02), ...p(0.0, 0.07), ...p(0.04, 0.38));
      //   // Left lower → bottom tip
      //   ctx.bezierCurveTo(...p(0.0, 0.65), ...p(0.28, 0.88), ...p(0.5, 1.0));
      //   // Right lower ← bottom tip
      //   ctx.bezierCurveTo(...p(0.72, 0.88), ...p(1.0, 0.65), ...p(0.96, 0.38));
      //   // Right hump → notch
      //   ctx.bezierCurveTo(...p(1.0, 0.07), ...p(0.55, 0.02), ...p(0.5, 0.30));
      //   ctx.closePath();
      //   if (obj.fill) ctx.fill(); else ctx.stroke();
      //   break;
      // }

      case 'heart': {
          const bx = Math.min(x1, x2),
                by = Math.min(y1, y2),
                bw = Math.abs(w) || 1,
                bh = Math.abs(h) || 1;
          const sx = bw / 64;
          const sy = bh / 56;
          ctx.moveTo(bx + 2.53725 * sx, by + 8.94154 * sy);
          ctx.bezierCurveTo(
            bx + (-2.65195) * sx, by + 17.4906 * sy,
            bx + 1.00387 * sx,    by + 25.8117 * sy,
            bx + 5.59813 * sx,    by + 30.2281 * sy
          );        
          ctx.lineTo(bx + 32.4604 * sx, by + 56 * sy);        
          ctx.lineTo(bx + 58.7557 * sx, by + 30.3202 * sy);
          ctx.bezierCurveTo(
            bx + 63.0287 * sx, by + 25.5693 * sy,
            bx + 64.6666 * sx, by + 20.5299 * sy,
            bx + 63.7569 * sx, by + 14.9185 * sy
          );
          ctx.bezierCurveTo(
            bx + 62.5004 * sx, by + 7.1561 * sy,
            bx + 56.1037 * sx, by + 1.13372 * sy,
            bx + 48.2017 * sx, by + 0.273726 * sy
          );
          ctx.bezierCurveTo(
            bx + 43.3553 * sx, by + (-0.248088) * sy,
            bx + 38.6736 * sx, by + 1.12342 * sy,
            bx + 35.0197 * sx, by + 4.15976 * sy
          );
          ctx.bezierCurveTo(
            bx + 34.0362 * sx, by + 4.97672 * sy,
            bx + 33.1572 * sx, by + 5.89005 * sy,
            bx + 32.3911 * sx, by + 6.88277 * sy
          );
          ctx.bezierCurveTo(
            bx + 31.4821 * sx, by + 5.75248 * sy,
            bx + 30.4163 * sx, by + 4.71854 * sy,
            bx + 29.2108 * sx, by + 3.80219 * sy
          );
          ctx.bezierCurveTo(
            bx + 25.009 * sx,  by + 0.608875 * sy,
            bx + 19.6604 * sx, by + (-0.658994) * sy,
            bx + 14.5228 * sx, by + 0.327059 * sy
          );
          ctx.bezierCurveTo(
            bx + 9.65689 * sx, by + 1.26705 * sy,
            bx + 5.28924 * sx, by + 4.40582 * sy,
            bx + 2.53725 * sx, by + 8.94154 * sy
          );
          ctx.closePath();
          if (obj.fill) ctx.fill(); else ctx.stroke();
          break;
        }  

      // case 'cloud': {
      //   const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||2, bh = Math.abs(h)||2;
      //   const px = t => bx + t * bw, py = t => by + t * bh;
      //   const floor = py(0.78);
      //   ctx.moveTo(px(0.04), floor);
      //   // Bumps left to right using quadratic bezier
      //   ctx.quadraticCurveTo(px(0.0),  py(0.50), px(0.07), py(0.50));
      //   ctx.quadraticCurveTo(px(0.04), py(0.20), px(0.23), py(0.22));
      //   ctx.quadraticCurveTo(px(0.18), py(0.0),  px(0.42), py(0.05));
      //   ctx.quadraticCurveTo(px(0.38), py(-0.08),px(0.62), py(0.05));
      //   ctx.quadraticCurveTo(px(0.62), py(-0.02),px(0.78), py(0.15));
      //   ctx.quadraticCurveTo(px(0.9),  py(0.05), px(0.96), py(0.28));
      //   ctx.quadraticCurveTo(px(1.0),  py(0.28), px(1.0),  py(0.50));
      //   ctx.quadraticCurveTo(px(1.0),  py(0.78), px(0.96), floor);
      //   ctx.lineTo(px(0.04), floor);
      //   ctx.closePath();
      //   if (obj.fill) ctx.fill(); else ctx.stroke();
      //   break;
      // }

      case 'cloud': {
        const bx = Math.min(x1, x2),
              by = Math.min(y1, y2),
              bw = Math.abs(w) || 1,
              bh = Math.abs(h) || 1;
        const sx = bw / 64;
        const sy = bh / 42;
        ctx.moveTo(bx + 36.3378 * sx, by + 0 * sy);
        ctx.bezierCurveTo(
          bx + 37.0398 * sx, by + 0 * sy,
          bx + 37.746  * sx, by + 0 * sy,
          bx + 38.4466 * sx, by + 0 * sy
        );
        ctx.bezierCurveTo(
          bx + 44.0323 * sx, by + 0.701488 * sy,
          bx + 47.5231 * sx, by + 3.03656  * sy,
          bx + 49.1131 * sx, by + 6.85746  * sy
        );
        ctx.bezierCurveTo(
          bx + 58.4254 * sx, by + 6.34791 * sy,
          bx + 65.196  * sx, by + 13.5727 * sy,
          bx + 61.0698 * sx, by + 20.6635 * sy
        );
        ctx.bezierCurveTo(
          bx + 62.4419 * sx, by + 22.1535 * sy,
          bx + 63.5866 * sx, by + 23.8202 * sy,
          bx + 64 * sx,      by + 26.0572 * sy
        );
        ctx.lineTo(bx + 64 * sx, by + 27.978 * sy);
        ctx.bezierCurveTo(
          bx + 62.768  * sx, by + 33.6714 * sy,
          bx + 57.4667 * sx, by + 37.5186 * sy,
          bx + 48.7634 * sx, by + 36.4829 * sy
        );
        ctx.bezierCurveTo(
          bx + 46.5241 * sx, by + 39.4062 * sy,
          bx + 42.5395 * sx, by + 42.3337 * sy,
          bx + 36.3391 * sx, by + 41.9691 * sy
        );
        ctx.bezierCurveTo(
          bx + 33.1342 * sx, by + 41.7772 * sy,
          bx + 30.9046 * sx, by + 40.6656 * sy,
          bx + 28.9525 * sx, by + 39.3151 * sy
        );
        ctx.bezierCurveTo(
          bx + 26.8964 * sx, by + 40.4377 * sy,
          bx + 24.6696 * sx, by + 41.3187 * sy,
          bx + 21.4522 * sx, by + 41.3284 * sy
        );
        ctx.bezierCurveTo(
          bx + 14.0087 * sx, by + 41.345 * sy,
          bx + 9.02929 * sx, by + 37.0201 * sy,
          bx + 8.90858 * sx, by + 31.0878 * sy
        );
        ctx.bezierCurveTo(
          bx + 4.12339 * sx, by + 29.7 * sy,
          bx + 0.882395 * sx,by + 27.1095 * sy,
          bx + 0 * sx,       by + 22.6768 * sy
        );
        ctx.lineTo(bx + 0 * sx, by + 20.756 * sy);
        ctx.bezierCurveTo(
          bx + 0.973964 * sx, by + 16.3635 * sy,
          bx + 4.03876  * sx, by + 13.6044 * sy,
          bx + 9.14167  * sx, by + 12.4348 * sy
        );
        ctx.bezierCurveTo(
          bx + 8.83505 * sx, by + 5.02503 * sy,
          bx + 19.0423 * sx, by + 0.394932 * sy,
          bx + 27.4278 * sx, by + 3.65934 * sy
        );
        ctx.bezierCurveTo(
          bx + 29.4243 * sx, by + 2.04509 * sy,
          bx + 32.249  * sx, by + 0.284462 * sy,
          bx + 36.3378 * sx, by + 0 * sy
        );
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'speechbubble': {
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||2, bh = Math.abs(h)||2;
        const r = Math.min(bw, bh) * 0.12;
        const tailH = bh * 0.22;
        const bdy = by + bh - tailH; // bottom of bubble body
        // Body (rounded rect drawn as explicit path)
        ctx.moveTo(bx + r, by);
        ctx.lineTo(bx + bw - r, by);          ctx.arcTo(bx+bw, by,       bx+bw, by+r,           r);
        ctx.lineTo(bx + bw, bdy - r);         ctx.arcTo(bx+bw, bdy,      bx+bw-r, bdy,          r);
        // Tail right side → tip → left side
        ctx.lineTo(bx + bw * 0.35, bdy);
        ctx.lineTo(bx + bw * 0.12, by + bh);  // tail tip
        ctx.lineTo(bx + bw * 0.10, bdy);
        ctx.arcTo(bx, bdy,         bx, bdy-r,          r);
        ctx.lineTo(bx, by + r);               ctx.arcTo(bx, by,          bx+r, by,              r);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      // case 'speechoval': {
      //   const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||2, bh = Math.abs(h)||2;
      //   const tailH = bh * 0.22;
      //   const bodyH = bh - tailH;
      //   const ecx = bx + bw/2, ecy = by + bodyH/2;
      //   const erx = bw/2||1, ery = bodyH/2||1;
      //   // Ellipse body
      //   ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2);
      //   // Tail as a separate filled triangle
      //   ctx.moveTo(bx + bw * 0.30, by + bodyH * 0.85);
      //   ctx.lineTo(bx + bw * 0.14, by + bh);
      //   ctx.lineTo(bx + bw * 0.44, by + bodyH * 0.85);
      //   ctx.closePath();
      //   if (obj.fill) ctx.fill(); else ctx.stroke();
      //   break;
      // }

      case 'speechoval': {
        const bx = Math.min(x1, x2),
              by = Math.min(y1, y2),
              bw = Math.abs(w) || 1,
              bh = Math.abs(h) || 1;
        const sx = bw / 64;
        const sy = bh / 56;
        ctx.moveTo(bx + 41.7615 * sx, by + 0);
        ctx.lineTo(bx + 22.2368 * sx, by + 0);
        ctx.bezierCurveTo(
          bx + 9.95482 * sx, by + 0,
          bx + 0,            by + 9.72535 * sy,
          bx + 0,            by + 21.7221 * sy
        );
        ctx.bezierCurveTo(
          bx + 0,            by + 30.407 * sy,
          bx + 5.21881 * sx, by + 37.8984 * sy,
          bx + 12.7588 * sx, by + 41.3741 * sy
        );
        ctx.lineTo(bx + 12.7588 * sx, by + 56 * sy);
        ctx.lineTo(bx + 27.8617 * sx, by + 43.4435 * sy);
        ctx.lineTo(bx + 41.7615 * sx, by + 43.4435 * sy);
        ctx.bezierCurveTo(
          bx + 54.0443 * sx, by + 43.4435 * sy,
          bx + 64 * sx,      by + 33.7181 * sy,
          bx + 64 * sx,      by + 21.7213 * sy
        );
        ctx.bezierCurveTo(
          bx + 64 * sx,      by + 9.72535 * sy,
          bx + 54.0443 * sx, by + 0,
          bx + 41.7615 * sx, by + 0
        );
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'bookmark': {
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||1, bh = Math.abs(h)||1;
        ctx.moveTo(bx,           by);
        ctx.lineTo(bx + bw,      by);
        ctx.lineTo(bx + bw,      by + bh);
        ctx.lineTo(bx + bw / 2,  by + bh * 0.75);
        ctx.lineTo(bx,           by + bh);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'ribbon': {
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||1, bh = Math.abs(h)||1;
        const nh = bh * 0.18; // notch depth
        ctx.moveTo(bx,            by);
        ctx.lineTo(bx + bw,       by);
        ctx.lineTo(bx + bw,       by + bh);
        ctx.lineTo(bx + bw * 0.75, by + bh - nh);
        ctx.lineTo(bx + bw * 0.5,  by + bh);
        ctx.lineTo(bx + bw * 0.25, by + bh - nh);
        ctx.lineTo(bx,             by + bh);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      // case 'star': {
      //   // N-pointed star: outer vertices alternate with inner vertices
      //   const ns  = Math.max(3, Math.round(obj.sides != null ? obj.sides : 5));
      //   const bx  = Math.min(x1,x2), by = Math.min(y1,y2);
      //   const scx = bx + Math.abs(w)/2, scy = by + Math.abs(h)/2;
      //   const orx = Math.abs(w)/2 || 1, ory = Math.abs(h)/2 || 1;
      //   // Inner radius ratio: tighter for few points (sparkle), standard for more points
      //   const ratio = ns <= 4 ? 0.20 : ns <= 6 ? 0.38 : 0.40;
      //   const irx = orx * ratio, iry = ory * ratio;
      //   const sa  = -Math.PI / 2;
      //   for (let i = 0; i < ns * 2; i++) {
      //     const a  = sa + (i * Math.PI) / ns;
      //     const rx = i % 2 === 0 ? orx : irx;
      //     const ry = i % 2 === 0 ? ory : iry;
      //     const px = scx + rx * Math.cos(a);
      //     const py = scy + ry * Math.sin(a);
      //     if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      //   }
      //   ctx.closePath();
      //   if (obj.fill) ctx.fill(); else ctx.stroke();
      //   break;
      // }

      case 'starburst': {
        const nb  = Math.max(4, Math.round(obj.sides != null ? obj.sides : 12));
        const bx  = Math.min(x1, x2), by = Math.min(y1, y2);
        const bw  = Math.abs(w) || 1,  bh = Math.abs(h) || 1;
        const scx = bx + bw / 2,       scy = by + bh / 2;
        const orx = bw / 2,            ory = bh / 2;
        const ratio = 0.78;
        const irx = orx * ratio,        iry = ory * ratio;
        const sa  = -Math.PI / 2;
        const cr  = obj.cornerRadius || 0;
        const sv  = [];
        for (let i = 0; i < nb * 2; i++) {
          const a  = sa + (i * Math.PI) / nb;
          const rx = i % 2 === 0 ? orx : irx;
          const ry = i % 2 === 0 ? ory : iry;
          sv.push({ x: scx + rx * Math.cos(a), y: scy + ry * Math.sin(a) });
        }
        if (cr > 0) {
          const arcR = (cr / 100) * Math.min(orx, ory) * (1 - ratio) * 0.9;
          const n2   = sv.length;
          for (let i = 0; i < n2; i++) {
            const prev = sv[(i - 1 + n2) % n2], cur = sv[i], next = sv[(i + 1) % n2];
            const d1x = cur.x - prev.x, d1y = cur.y - prev.y, l1 = Math.hypot(d1x, d1y);
            const d2x = next.x - cur.x,  d2y = next.y - cur.y, l2 = Math.hypot(d2x, d2y);
            const t   = Math.min(arcR, l1 / 2, l2 / 2);
            const p1  = { x: cur.x - t * d1x / l1, y: cur.y - t * d1y / l1 };
            const p2  = { x: cur.x + t * d2x / l2, y: cur.y + t * d2y / l2 };
            if (i === 0) ctx.moveTo(p1.x, p1.y); else ctx.lineTo(p1.x, p1.y);
            ctx.quadraticCurveTo(cur.x, cur.y, p2.x, p2.y);
          }
        } else {
          sv.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        }
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }


      case 'star': {
        const ns  = Math.max(3, Math.round(obj.sides != null ? obj.sides : 5));
        const bx  = Math.min(x1, x2), by = Math.min(y1, y2);
        const bw  = Math.abs(w) || 1,  bh = Math.abs(h) || 1;
        const scx = bx + bw / 2,       scy = by + bh / 2;
        const orx = bw / 2,            ory = bh / 2;
        const ratio = ns <= 4 ? 0.20 : ns <= 6 ? 0.38 : 0.40;
        const irx = orx * ratio,        iry = ory * ratio;
        const sa  = -Math.PI / 2;
        const cr  = obj.cornerRadius || 0;
        const sv  = [];
        for (let i = 0; i < ns * 2; i++) {
          const a  = sa + (i * Math.PI) / ns;
          const rx = i % 2 === 0 ? orx : irx;
          const ry = i % 2 === 0 ? ory : iry;
          sv.push({ x: scx + rx * Math.cos(a), y: scy + ry * Math.sin(a) });
        }
        if (cr > 0) {
          const arcR = (cr / 100) * Math.min(orx, ory) * ratio * 0.9;
          const n2   = sv.length;
          for (let i = 0; i < n2; i++) {
            const prev = sv[(i - 1 + n2) % n2], cur = sv[i], next = sv[(i + 1) % n2];
            const d1x = cur.x - prev.x, d1y = cur.y - prev.y, l1 = Math.hypot(d1x, d1y);
            const d2x = next.x - cur.x,  d2y = next.y - cur.y, l2 = Math.hypot(d2x, d2y);
            const t   = Math.min(arcR, l1 / 2, l2 / 2);
            const p1  = { x: cur.x - t * d1x / l1, y: cur.y - t * d1y / l1 };
            const p2  = { x: cur.x + t * d2x / l2, y: cur.y + t * d2y / l2 };
            if (i === 0) ctx.moveTo(p1.x, p1.y); else ctx.lineTo(p1.x, p1.y);
            ctx.quadraticCurveTo(cur.x, cur.y, p2.x, p2.y);
          }
        } else {
          sv.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        }
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'arch': {
        // Rectangle with semicircular arch cut into the top
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||1, bh = Math.abs(h)||1;
        const archR = Math.min(bw / 2, bh * 0.65);
        const archY = by + archR;
        ctx.moveTo(bx,           by + bh);
        ctx.lineTo(bx,           archY);
        ctx.arc(bx + bw / 2, archY, archR, Math.PI, 0, false);
        ctx.lineTo(bx + bw,    by + bh);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'stadium': {
        // D-shape: flat top, semicircle at bottom
        const bx = Math.min(x1,x2), by = Math.min(y1,y2), bw = Math.abs(w)||1, bh = Math.abs(h)||1;
        const r = Math.min(bw / 2, bh * 0.65);
        const arcY = by + bh - r;
        ctx.moveTo(bx,         by);
        ctx.lineTo(bx + bw,    by);
        ctx.lineTo(bx + bw,    arcY);
        ctx.arc(bx + bw / 2, arcY, r, 0, Math.PI, false);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  _drawStroke(ctx, stroke) {
    if (!stroke.points || stroke.points.length === 0) return;
    ctx.save();
    const a = stroke.tool === 'marker' ? Math.min(stroke.opacity * 0.55, 1) : stroke.opacity;
    ctx.strokeStyle = this.rgba(stroke.color, a);
    ctx.fillStyle   = this.rgba(stroke.color, a);
    ctx.lineWidth   = stroke.tool === 'eraser' ? stroke.size * 2 : stroke.size;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    if (stroke.tool === 'brush') {
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur  = stroke.size * 0.6;
    } else {
      ctx.shadowBlur = 0;
    }

    // Apply rotation around stroke bounding-box center
    const rotation = stroke.rotation || 0;
    if (rotation) {
      const b = this._getAxisAlignedBoundsFromObj(stroke);
      if (b) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        ctx.translate(cx, cy);
        ctx.rotate(rotation);
        ctx.translate(-cx, -cy);
      }
    }

    const pts = stroke.points;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const p1 = pts[i - 1];
      const p2 = pts[i];
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      ctx.quadraticCurveTo(p1.x, p1.y, mx, my);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawText(ctx, obj) {
    ctx.save();
    ctx.globalAlpha = obj.opacity;
    ctx.fillStyle   = obj.color;
    ctx.font        = `${obj.fontSize}px ${obj.fontFamily}`;
    ctx.shadowBlur  = 0;

    const rotation = obj.rotation || 0;
    if (rotation) {
      const b = this._getAxisAlignedBoundsFromObj(obj);
      if (b) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        ctx.translate(cx, cy);
        ctx.rotate(rotation);
        ctx.translate(-cx, -cy);
      }
    }

    const lineHeight = obj.fontSize * 1.4;
    obj.lines.forEach((line, i) => {
      ctx.fillText(line, obj.x, obj.y + obj.fontSize + i * lineHeight);
    });
    ctx.restore();
  }

  _eraseByStroke(stroke) {
    if (!stroke.points || stroke.points.length === 0) return;
    const toRemove = new Set();
    for (const obj of this.objects) {
      for (const p of stroke.points) {
        if (this._hitTest(obj, p.x, p.y, stroke.size * 1.5)) {
          toRemove.add(obj.id);
          break;
        }
      }
    }
    if (toRemove.size === 0) return;
    this.objects = this.objects.filter(o => !toRemove.has(o.id));
  }

  _hitTest(obj, x, y, pad = 0) {
    const type = obj.type || obj.tool;
    const rotation = obj.rotation || 0;

    // For groups: inverse-rotate the test point, then test each child
    if (type === 'group') {
      let gx = x, gy = y;
      if (rotation) {
        const b = this._getAxisAlignedBoundsFromObj(obj);
        if (b) {
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          const p = this._rotatePoint(cx, cy, x, y, -rotation);
          gx = p.x; gy = p.y;
        }
      }
      for (const child of obj.children) {
        if (this._hitTest(child, gx, gy, pad)) return true;
      }
      return false;
    }

    // Transform test point into object's un-rotated local space
    let lx = x, ly = y;
    if (rotation) {
      const b = this._getAxisAlignedBoundsFromObj(obj);
      if (b) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const p = this._rotatePoint(cx, cy, x, y, -rotation);
        lx = p.x; ly = p.y;
      }
    }

    if (type === 'stroke') return this._hitStroke(obj, lx, ly, pad);

    if (type === 'text') {
      const b = this._getAxisAlignedBoundsFromObj(obj);
      return lx >= b.x - pad && lx <= b.x + b.w + pad && ly >= b.y - pad && ly <= b.y + b.h + pad;
    }

    const b = this._getAxisAlignedBoundsFromObj(obj);
    if (!b) return false;
    if (type === 'rect') {
      if (obj.fill) {
        return lx >= b.x - pad && lx <= b.x + b.w + pad && ly >= b.y - pad && ly <= b.y + b.h + pad;
      }
      return this._hitRectOutline(b, lx, ly, (obj.size || this.size) + pad);
    }
    if (type === 'circle' || type === 'triangle' || type === 'polygon' || type === 'hexagon' ||
        type === 'pill' || type === 'diamond' || type === 'parallelogram' ||
        type === 'trapezoid' || type === 'trapdown' || type === 'cross' ||
        type === 'frame' || type === 'heart' || type === 'cloud' ||
        type === 'speechbubble' || type === 'speechoval' ||
        type === 'bookmark' || type === 'ribbon' ||
        type === 'arch' || type === 'stadium' ||
        type === 'star' || type === 'starburst' || type === 'image') {
      // Always use bounding-box containment — polygon/triangle edges are inside the bbox,
      // so outline-only checking leaves most of the shape un-hittable.
      return lx >= b.x - pad && lx <= b.x + b.w + pad && ly >= b.y - pad && ly <= b.y + b.h + pad;
    }
    if (type === 'line' || type === 'arrow') {
      return this._distToSegment(lx, ly, obj.x1, obj.y1, obj.x2, obj.y2) <= (obj.size || this.size) + pad;
    }
    return false;
  }

  _hitStroke(stroke, x, y, pad = 0) {
    const pts = stroke.points;
    if (!pts || pts.length === 0) return false;
    const size = (stroke.size || this.size) + pad;
    for (let i = 1; i < pts.length; i++) {
      const p1 = pts[i - 1];
      const p2 = pts[i];
      if (this._distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= size) return true;
    }
    return false;
  }

  _hitRectOutline(b, x, y, size) {
    const left   = Math.abs(x - b.x) <= size && y >= b.y - size && y <= b.y + b.h + size;
    const right  = Math.abs(x - (b.x + b.w)) <= size && y >= b.y - size && y <= b.y + b.h + size;
    const top    = Math.abs(y - b.y) <= size && x >= b.x - size && x <= b.x + b.w + size;
    const bottom = Math.abs(y - (b.y + b.h)) <= size && x >= b.x - size && x <= b.x + b.w + size;
    return left || right || top || bottom;
  }

  _getBounds(obj) {
    return this._getAxisAlignedBoundsFromObj(obj);
  }

  /**
   * Returns the axis-aligned bounding box accounting for rotation.
   * Used for marquee selection and multi-select group box.
   */
  _getAxisAlignedBounds(obj) {
    const local = this._getAxisAlignedBoundsFromObj(obj);
    if (!local) return null;
    const rotation = obj.rotation || 0;
    if (!rotation) return local;
    const cx = local.x + local.w / 2, cy = local.y + local.h / 2;
    const corners = [
      { x: local.x,           y: local.y },
      { x: local.x + local.w, y: local.y },
      { x: local.x + local.w, y: local.y + local.h },
      { x: local.x,           y: local.y + local.h }
    ];
    const rotated = corners.map(c => this._rotatePoint(cx, cy, c.x, c.y, rotation));
    const xs = rotated.map(p => p.x), ys = rotated.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys),
             w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  /** Returns the un-rotated logical bounding box of an object */
  _getAxisAlignedBoundsFromObj(obj) {
    const type = obj.type || obj.tool;
    if (type === 'group') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const child of obj.children) {
        const b = this._getAxisAlignedBoundsFromObj(child);
        if (!b) continue;
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      }
      if (minX === Infinity) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    if (type === 'stroke') {
      const pts = obj.points;
      if (!pts || pts.length === 0) return null;
      let minX = pts[0].x, minY = pts[0].y, maxX = pts[0].x, maxY = pts[0].y;
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const pad = obj.size || this.size;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    if (type === 'text') {
      this.ctx.save();
      this.ctx.font = `${obj.fontSize}px ${obj.fontFamily}`;
      const widths = obj.lines.map(line => this.ctx.measureText(line).width);
      this.ctx.restore();
      const w = Math.max(1, ...widths);
      const h = obj.lines.length * obj.fontSize * 1.4;
      return { x: obj.x, y: obj.y, w, h };
    }
    if (type === 'image') {
      return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
    }
    const x1 = Math.min(obj.x1, obj.x2), y1 = Math.min(obj.y1, obj.y2);
    const x2 = Math.max(obj.x1, obj.x2), y2 = Math.max(obj.y1, obj.y2);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  _distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
    const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    const tt = Math.max(0, Math.min(1, t));
    const cx = x1 + tt * dx;
    const cy = y1 + tt * dy;
    return Math.hypot(px - cx, py - cy);
  }

  _findObjectAt(x, y) {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj = this.objects[i];
      if (this._hitTest(obj, x, y)) return obj;
    }
    return null;
  }

  _getObjectById(id) {
    return this.objects.find(obj => obj.id === id);
  }

  _deleteSelected() {
    if (this.selectedIds.size === 0) return;
    // Never delete locked objects
    this.objects = this.objects.filter(obj => !this.selectedIds.has(obj.id) || obj.locked);
    // Remove locked ids from selection so the set stays consistent
    for (const id of [...this.selectedIds]) {
      const o = this._getObjectById(id);
      if (!o) this.selectedIds.delete(id);
    }
    this._setSelection(null);
    this.renderAll();
    this.saveSnap();
  }

  _moveFromBase(obj, base, dx, dy) {
    const type = obj.type || obj.tool;
    if (type === 'group') {
      obj.children = base.children.map(baseChild => {
        const liveChild = this._cloneObject(baseChild);
        this._moveFromBase(liveChild, baseChild, dx, dy);
        return liveChild;
      });
      return;
    }
    if (type === 'stroke') {
      obj.points = base.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }

    if (type === 'text') {
      obj.x = base.x + dx;
      obj.y = base.y + dy;
      return;
    }

    if (type === 'image') {
      obj.x = base.x + dx;
      obj.y = base.y + dy;
      return;
    }

    obj.x1 = base.x1 + dx;
    obj.y1 = base.y1 + dy;
    obj.x2 = base.x2 + dx;
    obj.y2 = base.y2 + dy;
  }

  _cloneObject(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  _cloneObjects(list = this.objects) {
    return list.map(obj => this._cloneObject(obj));
  }

  /* ── Utility ───────────────────────────────────────────── */

  /** Scale an object's coordinates from oldB bounds to newB bounds (used for resize & group resize) */
  _scaleObjCoords(obj, oldB, newB) {
    const sx = oldB.w > 0 ? newB.w / oldB.w : 1;
    const sy = oldB.h > 0 ? newB.h / oldB.h : 1;
    const type = obj.type || obj.tool;
    if (type === 'stroke') {
      obj.points = obj.points.map(p => ({
        x: newB.x + (p.x - oldB.x) * sx,
        y: newB.y + (p.y - oldB.y) * sy
      }));
    } else if (type === 'text') {
      obj.x = newB.x + (obj.x - oldB.x) * sx;
      obj.y = newB.y + (obj.y - oldB.y) * sy;
      obj.fontSize = Math.max(6, obj.fontSize * Math.max(sx, sy));
    } else if (type === 'image') {
      obj.x = newB.x + (obj.x - oldB.x) * sx;
      obj.y = newB.y + (obj.y - oldB.y) * sy;
      obj.w = Math.max(10, obj.w * sx);
      obj.h = Math.max(10, obj.h * sy);
    } else if (type === 'group') {
      obj.children.forEach(c => this._scaleObjCoords(c, oldB, newB));
    } else {
      obj.x1 = newB.x + (obj.x1 - oldB.x) * sx;
      obj.y1 = newB.y + (obj.y1 - oldB.y) * sy;
      obj.x2 = newB.x + (obj.x2 - oldB.x) * sx;
      obj.y2 = newB.y + (obj.y2 - oldB.y) * sy;
    }
  }

  /* ── Group / Ungroup ───────────────────────────────────── */

  _groupSelected() {
    if (this.selectedIds.size < 2) return;
    const members = [];
    for (const id of this.selectedIds) {
      const o = this._getObjectById(id);
      if (o) members.push(this._cloneObject(o));
    }
    // Preserve z-order: remove original objects, insert group at the topmost position
    const topIdx = Math.max(
      ...members.map(m => this.objects.findIndex(o => o.id === m.id))
    );
    this.objects = this.objects.filter(o => !this.selectedIds.has(o.id));
    const group = { id: this._nextId++, type: 'group', children: members, rotation: 0 };
    this.objects.splice(Math.min(topIdx, this.objects.length), 0, group);
    this.selectedIds = new Set([group.id]);
    this.renderAll();
    this._drawSelectionOverlay();
    this.saveSnap();
  }

  _ungroupSelected() {
    if (this.selectedIds.size !== 1) return;
    const [id] = this.selectedIds;
    const group = this._getObjectById(id);
    if (!group || (group.type || group.tool) !== 'group') return;

    const groupRotation = group.rotation || 0;
    const newIds = new Set();
    const children = group.children.map(child => {
      const c = this._cloneObject(child);
      c.id = this._nextId++;
      // Bake group rotation into each child so they render in the same spot
      if (groupRotation) c.rotation = ((c.rotation || 0) + groupRotation);
      newIds.add(c.id);
      return c;
    });

    // Replace group with children at the same z-order position
    const idx = this.objects.findIndex(o => o.id === id);
    this.objects.splice(idx, 1, ...children);
    this.selectedIds = newIds;
    this.renderAll();
    this._drawSelectionOverlay();
    this.saveSnap();
  }

  /* ── Apply properties to selection ────────────────────── */

  _applyPropToSelected(prop, value) {
    if (this.selectedIds.size === 0) return;
    let changed = false;
    for (const id of this.selectedIds) {
      const obj = this._getObjectById(id);
      if (obj) { this._applyPropToObj(obj, prop, value); changed = true; }
    }
    if (changed) { this.renderAll(); this._drawSelectionOverlay(); }
  }

  _applyPropToObj(obj, prop, value) {
    const type = obj.type || obj.tool;
    if (type === 'group') {
      obj.children.forEach(c => this._applyPropToObj(c, prop, value));
      return;
    }
    if (prop === 'color')   { obj.color   = value; }
    if (prop === 'opacity') { obj.opacity = value; }
    if (prop === 'size')    {
      if (type === 'text') obj.fontSize = Math.max(6, Math.round(value * 2.5));
      else obj.size = value;
    }
    if (prop === 'cornerRadius') {
      if (['rect', 'polygon', 'triangle', 'hexagon', 'star', 'starburst', 'image'].includes(type)) obj.cornerRadius = value;
    }
    if (prop === 'sides') {
      if (['polygon', 'triangle', 'hexagon', 'star', 'starburst'].includes(type)) obj.sides = Math.round(value);
    }
  }

  /* ── Sync controls to selection ───────────────────────── */

  _syncControlsToSelection() {
    // Only sync when exactly 1 non-group object or 1 group is selected
    if (this.selectedIds.size !== 1) return;
    const [id] = this.selectedIds;
    const obj = this._getObjectById(id);
    if (!obj) return;

    // If locked, read values into controls but disable all editing inputs
    const locked = !!obj.locked;
    const editIds = ['colorPicker','sizeRange','opacityRange','cornerRoundingRange','sidesRange','fillToggle'];
    editIds.forEach(eid => {
      const el = document.getElementById(eid);
      if (el) el.disabled = locked;
    });
    // Also grey the color preview click-through label
    const colorBtn = document.querySelector('.cv-color-btn');
    if (colorBtn) colorBtn.style.pointerEvents = locked ? 'none' : '';

    // Use first child as representative for groups
    const rep = ((obj.type || obj.tool) === 'group' && obj.children.length > 0)
      ? obj.children[0] : obj;
    if (rep.color) {
      this.color = rep.color;
      document.getElementById('colorPicker').value = rep.color;
      document.getElementById('colorPreview').style.background = rep.color;
    }
    if (rep.opacity != null) {
      this.opacity = rep.opacity;
      const pct = Math.round(rep.opacity * 100);
      document.getElementById('opacityRange').value = pct;
      document.getElementById('opacityVal').textContent = pct + '%';
    }
    const repSize = ((rep.type || rep.tool) === 'text')
      ? Math.round((rep.fontSize || 14) / 2.5)
      : (rep.size != null ? rep.size : null);
    if (repSize != null) {
      this.size = repSize;
      document.getElementById('sizeRange').value = repSize;
      document.getElementById('sizeVal').textContent = repSize;
    }
    const repType = rep.type || rep.tool;
    if (repType === 'rect' || repType === 'polygon' || repType === 'triangle' || repType === 'hexagon' || repType === 'image') {
      const cr = rep.cornerRadius != null ? rep.cornerRadius : 0;
      this.cornerRadius = cr;
      document.getElementById('cornerRoundingRange').value = cr;
      document.getElementById('cornerRoundingVal').textContent = cr;
    }
    if (repType === 'polygon' || repType === 'triangle' || repType === 'hexagon') {
      const s = rep.sides != null ? rep.sides : (repType === 'hexagon' ? 6 : 3);
      this.sides = s;
      document.getElementById('sidesRange').value = s;
      document.getElementById('sidesVal').textContent = s;
    }
  }

  /* ── Group/Ungroup button state ────────────────────────── */

  _updateGroupUI() {
    const groupBtn   = document.getElementById('groupBtn');
    const ungroupBtn = document.getElementById('ungroupBtn');
    if (!groupBtn || !ungroupBtn) return;
    // Check if entire selection is locked
    const allLocked = this.selectedIds.size > 0 && [...this.selectedIds].every(id => {
      const o = this._getObjectById(id); return o && o.locked;
    });
    // Re-enable editing controls whenever selection is unlocked or cleared
    if (!allLocked) {
      ['colorPicker','sizeRange','opacityRange','cornerRoundingRange','sidesRange','fillToggle'].forEach(eid => {
        const el = document.getElementById(eid);
        if (el) el.disabled = false;
      });
      const colorBtn = document.querySelector('.cv-color-btn');
      if (colorBtn) colorBtn.style.pointerEvents = '';
    }
    groupBtn.disabled   = allLocked || this.selectedIds.size < 2;
    const sole = this.selectedIds.size === 1
      ? this._getObjectById([...this.selectedIds][0]) : null;
    ungroupBtn.disabled = allLocked || !(sole && (sole.type || sole.tool) === 'group');
    this._updateLayerUI();
  }

  _updateLayerUI() {
    const has = this.selectedIds.size > 0;
    const allLocked = has && [...this.selectedIds].every(id => {
      const o = this._getObjectById(id); return o && o.locked;
    });
    const trigger  = document.getElementById('layerTrigger');
    const frontBtn = document.getElementById('bringFrontBtn');
    const fwdBtn   = document.getElementById('bringForwardBtn');
    const bwdBtn   = document.getElementById('sendBackwardBtn');
    const backBtn  = document.getElementById('sendBackBtn');
    if (!frontBtn) return;
    if (trigger)   trigger.disabled   = !has || allLocked;
    frontBtn.disabled = !has || allLocked;
    fwdBtn.disabled   = !has || allLocked;
    bwdBtn.disabled   = !has || allLocked;
    backBtn.disabled  = !has || allLocked;
    // Copy / Duplicate
    const copyBtn = document.getElementById('copyBtn');
    const dupBtn  = document.getElementById('duplicateBtn');
    if (copyBtn) copyBtn.disabled = !has || allLocked;
    if (dupBtn)  dupBtn.disabled  = !has || allLocked;
    // Lock button — always enabled when something selected
    const lockBtn = document.getElementById('lockBtn');
    if (!lockBtn) return;
    lockBtn.disabled = !has;
    if (has) {
      lockBtn.classList.toggle('active', allLocked);
      lockBtn.title = allLocked ? 'Unlock  Ctrl+L' : 'Lock  Ctrl+L';
      lockBtn.querySelector('i').className = allLocked ? 'fa-solid fa-lock-open' : 'fa-solid fa-lock';
    } else {
      lockBtn.classList.remove('active');
      lockBtn.title = 'Lock / Unlock  Ctrl+L';
      lockBtn.querySelector('i').className = 'fa-solid fa-lock';
    }
  }

  rgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /* ── Layer order ────────────────────────────────────────── */

  // Returns the highest index among all selected objects
  _topSelectedIdx() {
    return Math.max(...[...this.selectedIds].map(id => this.objects.findIndex(o => o.id === id)));
  }
  // Returns the lowest index among all selected objects
  _bottomSelectedIdx() {
    return Math.min(...[...this.selectedIds].map(id => this.objects.findIndex(o => o.id === id)));
  }

  /* ── Lock / Unlock ──────────────────────────────────────── */

  _toggleLock() {
    if (this.selectedIds.size === 0) return;
    const allLocked = [...this.selectedIds].every(id => {
      const o = this._getObjectById(id); return o && o.locked;
    });
    for (const id of this.selectedIds) {
      const o = this._getObjectById(id);
      if (o) o.locked = !allLocked;
    }
    // Deselect everything if we just locked them (can't act on locked objects)
    if (!allLocked) this._setSelection(null);
    this.renderAll();
    this._drawSelectionOverlay();
    this.saveSnap();
  }

  _bringToFront() {
    if (this.selectedIds.size === 0) return;
    const chosen = this.objects.filter(o => this.selectedIds.has(o.id));
    this.objects  = this.objects.filter(o => !this.selectedIds.has(o.id));
    this.objects.push(...chosen);
    this.renderAll(); this._drawSelectionOverlay(); this.saveSnap();
  }

  _sendToBack() {
    if (this.selectedIds.size === 0) return;
    const chosen = this.objects.filter(o => this.selectedIds.has(o.id));
    this.objects  = this.objects.filter(o => !this.selectedIds.has(o.id));
    this.objects.unshift(...chosen);
    this.renderAll(); this._drawSelectionOverlay(); this.saveSnap();
  }

  _bringForward() {
    if (this.selectedIds.size === 0) return;
    // Move each selected object one step toward the end, working from the top down
    const indices = [...this.selectedIds]
      .map(id => this.objects.findIndex(o => o.id === id))
      .filter(i => i !== -1)
      .sort((a, b) => b - a); // process top-first so they don't block each other
    for (const idx of indices) {
      if (idx < this.objects.length - 1 && !this.selectedIds.has(this.objects[idx + 1].id)) {
        [this.objects[idx], this.objects[idx + 1]] = [this.objects[idx + 1], this.objects[idx]];
      }
    }
    this.renderAll(); this._drawSelectionOverlay(); this.saveSnap();
  }

  _sendBackward() {
    if (this.selectedIds.size === 0) return;
    // Move each selected object one step toward the start, working from the bottom up
    const indices = [...this.selectedIds]
      .map(id => this.objects.findIndex(o => o.id === id))
      .filter(i => i !== -1)
      .sort((a, b) => a - b); // process bottom-first
    for (const idx of indices) {
      if (idx > 0 && !this.selectedIds.has(this.objects[idx - 1].id)) {
        [this.objects[idx], this.objects[idx - 1]] = [this.objects[idx - 1], this.objects[idx]];
      }
    }
    this.renderAll(); this._drawSelectionOverlay(); this.saveSnap();
  }

  /* ── Clipboard copy / paste ──────────────────────────────── */

  _copySelected() {
    if (this.selectedIds.size === 0) return;
    this._clipboard = [...this.selectedIds].map(id => {
      const obj = this._getObjectById(id);
      return obj ? this._cloneObject(obj) : null;
    }).filter(Boolean);
    // Flag that canvas copy owns the clipboard; Ctrl+V should prefer canvas objects
    // over whatever image might be sitting in the OS clipboard.
    this._canvasClipboardOwned = this._clipboard.length > 0;
  }

  _duplicateSelected() {
    if (this.selectedIds.size === 0) return;
    const OFFSET = 16;
    const newIds = new Set();
    const duped = [...this.selectedIds].map(id => {
      const obj = this._getObjectById(id);
      if (!obj) return null;
      const c = this._cloneObject(obj);
      c.id = this._nextId++;
      this._offsetObj(c, OFFSET, OFFSET);
      newIds.add(c.id);
      return c;
    }).filter(Boolean);
    if (!duped.length) return;
    this.objects.push(...duped);
    this.selectedIds = newIds;
    this.renderAll();
    this._drawSelectionOverlay();
    this.saveSnap();
  }

  _pasteClipboard() {
    // If canvas objects are on the clipboard, paste them
    if (this._canvasClipboardOwned && this._clipboard.length > 0) {
      this._pasteCanvasObjects();
      return;
    }
    // Otherwise try to read an image from the OS clipboard via the async API
    if (navigator.clipboard && navigator.clipboard.read) {
      navigator.clipboard.read().then(items => {
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith('image/'));
          if (imgType) {
            item.getType(imgType).then(blob => {
              const reader = new FileReader();
              reader.onload = ev => this._pasteImageSrc(ev.target.result);
              reader.readAsDataURL(blob);
            });
            return;
          }
        }
        // No image found — paste internal objects if any
        this._pasteCanvasObjects();
      }).catch(() => this._pasteCanvasObjects());
      return;
    }
    this._pasteCanvasObjects();
  }

  _pasteCanvasObjects() {
    if (this._clipboard.length === 0) return;
    const OFFSET = 16;
    this._setSelection(null);
    const newIds = new Set();
    const pasted = this._clipboard.map(obj => {
      const c = this._cloneObject(obj);
      c.id = this._nextId++;
      this._offsetObj(c, OFFSET, OFFSET);
      newIds.add(c.id);
      return c;
    });
    this.objects.push(...pasted);
    this.selectedIds = newIds;
    // Update clipboard so repeated pastes cascade
    this._clipboard = pasted.map(o => this._cloneObject(o));
    this.renderAll();
    this._drawSelectionOverlay();
    this.saveSnap();
  }

  _offsetObj(obj, dx, dy) {
    const type = obj.type || obj.tool;
    if (type === 'stroke') {
      obj.points = obj.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    } else if (type === 'text' || type === 'image') {
      obj.x += dx; obj.y += dy;
    } else if (type === 'group') {
      obj.children.forEach(c => this._offsetObj(c, dx, dy));
    } else {
      obj.x1 += dx; obj.y1 += dy; obj.x2 += dx; obj.y2 += dy;
    }
  }

  /* ── Image from OS clipboard ──────────────────────────────── */

  _handleExternalPaste(e) {
    // Let the browser handle paste into text inputs (text tool overlay)
    if (this.isTyping()) return;
    e.preventDefault();
    // If the user's most recent Ctrl+C was on canvas objects, always paste those
    // regardless of what's in the OS clipboard (e.g. a previously copied image).
    if (this._canvasClipboardOwned && this._clipboard.length > 0) {
      this._pasteClipboard();
      return;
    }
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgItem = items.find(it => it.type.startsWith('image/'));
    if (imgItem) {
      const blob = imgItem.getAsFile();
      if (blob) {
        const reader = new FileReader();
        reader.onload = ev => this._pasteImageSrc(ev.target.result);
        reader.readAsDataURL(blob);
        return;
      }
    }
    // No OS image — fall back to internal canvas-object clipboard
    this._pasteClipboard();
  }

  _pasteImageSrc(src) {
    const img = new Image();
    img.onload = () => {
      const cw = this.main.width  || 800;
      const ch = this.main.height || 600;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const maxW = cw * 0.8, maxH = ch * 0.8;
      if (w > maxW || h > maxH) {
        const scale = Math.min(maxW / w, maxH / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const x = Math.round((cw - w) / 2);
      const y = Math.round((ch - h) / 2);
      const obj = { id: this._nextId++, type: 'image', x, y, w, h, src, rotation: 0, opacity: 1 };
      this._imgCache.set(obj.id, img);
      this.objects.push(obj);
      this._setSelection(obj.id);
      this.renderAll();
      this._drawSelectionOverlay();
      this.saveSnap();
    };
    img.src = src;
  }

  _drawImageObj(ctx, obj) {
    let img = this._imgCache.get(obj.id);
    if (!img) {
      img = new Image();
      img.onload = () => this.renderAll();
      img.src = obj.src;
      this._imgCache.set(obj.id, img);
    }
    if (!img.complete || img.naturalWidth === 0) return;
    ctx.save();
    ctx.globalAlpha = obj.opacity != null ? obj.opacity : 1;
    const rotation = obj.rotation || 0;
    if (rotation) {
      const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      ctx.translate(-cx, -cy);
    }
    const cr = obj.cornerRadius || 0;
    if (cr > 0) {
      const r = (cr / 100) * Math.min(obj.w, obj.h) / 2;
      ctx.beginPath();
      ctx.roundRect(obj.x, obj.y, obj.w, obj.h, r);
      ctx.clip();
    }
    ctx.drawImage(img, obj.x, obj.y, obj.w, obj.h);
    ctx.restore();
  }

  /* ── Pages ─────────────────────────────────────────────── */

  _initPages() {
    this.pages = [{
      objects:    this._cloneObjects(),
      history:    this.history.map(s => this._cloneObjects(s)),
      historyPtr: this.historyPtr,
      bgColor:    this.bgColor,
      bgVisible:  this.bgVisible
    }];
    this.currentPageIdx = 0;
    this._rebuildPageStrip();
    document.getElementById('pageAddBtn').addEventListener('click', () => this._addPage());
  }

  _savePage(idx) {
    this.pages[idx].objects    = this._cloneObjects();
    this.pages[idx].history    = this.history.map(s => this._cloneObjects(s));
    this.pages[idx].historyPtr = this.historyPtr;
    this.pages[idx].bgColor    = this.bgColor;
    this.pages[idx].bgVisible  = this.bgVisible;
  }

  _loadPage(idx) {
    const p = this.pages[idx];
    this.objects    = this._cloneObjects(p.objects);
    this.history    = p.history.map(s => this._cloneObjects(s));
    this.historyPtr = p.historyPtr;
    this.bgColor    = p.bgColor;
    this.bgVisible  = p.bgVisible;
  }

  _switchPage(idx) {
    if (idx === this.currentPageIdx) return;
    this._savePage(this.currentPageIdx);
    this.currentPageIdx = idx;
    this._loadPage(idx);
    this._setSelection(null);
    this.renderAll();
    this.updateHistoryUI();
    this._syncBgUI();
    this._rebuildPageStrip();
  }

  _syncBgUI() {
    document.getElementById('bgColorPicker').value = this.bgColor;
    document.getElementById('bgColorPreview').style.background = this.bgColor;
    const btn = document.getElementById('bgToggle');
    btn.querySelector('i').className = this.bgVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    btn.classList.toggle('active', this.bgVisible);
    this.wrap.classList.toggle('bg-hidden', !this.bgVisible);
  }

  _addPage() {
    this._savePage(this.currentPageIdx);
    this.pages.push({
      objects:    [],
      history:    [[]],
      historyPtr: 0,
      bgColor:    '#252525',
      bgVisible:  true
    });
    this.currentPageIdx = this.pages.length - 1;
    this._loadPage(this.currentPageIdx);
    this._setSelection(null);
    this.renderAll();
    this.updateHistoryUI();
    this._syncBgUI();
    this._rebuildPageStrip();
    setTimeout(() => {
      const scroll = document.getElementById('pagesScroll');
      if (scroll) scroll.scrollLeft = scroll.scrollWidth;
    }, 50);
  }

  _deletePage(idx) {
    if (this.pages.length <= 1) return;
    // Flush live state so the snapshot captures the latest objects
    if (idx === this.currentPageIdx) this._savePage(idx);
    const snapshot = {
      objects:    this._cloneObjects(this.pages[idx].objects),
      history:    this.pages[idx].history.map(s => this._cloneObjects(s)),
      historyPtr: this.pages[idx].historyPtr,
      bgColor:    this.pages[idx].bgColor,
      bgVisible:  this.pages[idx].bgVisible
    };
    const pageNum = idx + 1;
    this.pages.splice(idx, 1);
    let newIdx = this.currentPageIdx;
    if (newIdx >= idx && newIdx > 0) newIdx--;
    if (newIdx >= this.pages.length) newIdx = this.pages.length - 1;
    this.currentPageIdx = newIdx;
    this._loadPage(newIdx);
    this._setSelection(null);
    this.renderAll();
    this.updateHistoryUI();
    this._syncBgUI();
    this._rebuildPageStrip();
    this._showPageDeletedToast(snapshot, idx, pageNum);
  }

  _showPageDeletedToast(snapshot, atIdx, pageNum) {
    // Cancel any previous pending toast
    if (this._undoToastTimer) {
      clearTimeout(this._undoToastTimer);
      this._undoToastTimer = null;
    }
    const toast = document.getElementById('cvUndoToast');
    toast.querySelector('.cv-undo-toast-msg').textContent = `Page ${pageNum} deleted`;

    // Reset and restart the progress bar animation
    const bar = toast.querySelector('.cv-undo-toast-bar');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    toast.classList.add('visible');
    bar.offsetWidth; // force reflow
    bar.style.transition = 'width 3s linear';
    bar.style.width = '0%';

    // Re-clone the button to clear any previous click listener
    const oldBtn = toast.querySelector('.cv-undo-toast-btn');
    const btn = oldBtn.cloneNode(true);
    oldBtn.replaceWith(btn);
    btn.addEventListener('click', () => {
      clearTimeout(this._undoToastTimer);
      this._undoToastTimer = null;
      toast.classList.remove('visible');
      this._savePage(this.currentPageIdx);
      this.pages.splice(atIdx, 0, snapshot);
      this.currentPageIdx = atIdx;
      this._loadPage(atIdx);
      this._setSelection(null);
      this.renderAll();
      this.updateHistoryUI();
      this._syncBgUI();
      this._rebuildPageStrip();
    });

    this._undoToastTimer = setTimeout(() => {
      toast.classList.remove('visible');
      this._undoToastTimer = null;
    }, 3000);
  }

  _rebuildPageStrip() {
    const scroll = document.getElementById('pagesScroll');
    if (!scroll) return;
    scroll.innerHTML = '';
    this.pages.forEach((page, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'cv-page-thumb' + (idx === this.currentPageIdx ? ' active' : '');
      const wrap = document.createElement('div');
      wrap.className = 'cv-page-canvas-wrap';
      const tc = document.createElement('canvas');
      tc.width  = 124;
      tc.height = 108;
      wrap.appendChild(tc);
      const label = document.createElement('div');
      label.className = 'cv-page-label';
      label.textContent = `Page ${idx + 1}`;
      wrap.appendChild(label);
      const del = document.createElement('span');
      del.className = 'cv-page-del';
      del.textContent = '×';
      del.title = 'Delete page';
      del.addEventListener('click', e => { e.stopPropagation(); this._deletePage(idx); });
      thumb.appendChild(wrap);
      thumb.appendChild(del);
      thumb.addEventListener('click', () => this._switchPage(idx));
      scroll.appendChild(thumb);
      requestAnimationFrame(() => this._renderThumbnail(tc, page, idx));
    });
  }

  _renderThumbnail(tc, page, idx) {
    const tctx = tc.getContext('2d');
    tctx.clearRect(0, 0, tc.width, tc.height);
    const objs      = idx === this.currentPageIdx ? this.objects   : page.objects;
    const bgColor   = idx === this.currentPageIdx ? this.bgColor   : page.bgColor;
    const bgVisible = idx === this.currentPageIdx ? this.bgVisible : page.bgVisible;
    if (bgVisible) { tctx.fillStyle = bgColor; tctx.fillRect(0, 0, tc.width, tc.height); }
    const cw = this.main.width  || tc.width;
    const ch = this.main.height || tc.height;
    tctx.save();
    tctx.scale(tc.width / cw, tc.height / ch);
    objs.forEach(obj => this._drawObject(tctx, obj));
    tctx.restore();
  }

  _updateCurrentPageThumbnail() {
    if (!this.pages) return;
    const scroll = document.getElementById('pagesScroll');
    if (!scroll) return;
    const thumbs = scroll.querySelectorAll('.cv-page-thumb');
    const activeThumb = thumbs[this.currentPageIdx];
    if (!activeThumb) return;
    const tc = activeThumb.querySelector('canvas');
    if (!tc) return;
    this._renderThumbnail(tc, this.pages[this.currentPageIdx], this.currentPageIdx);
  }
}

document.addEventListener('DOMContentLoaded', () => new CanvasApp());
