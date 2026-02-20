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
    window.addEventListener('resize', () => this.resize());
    // Allow parent page to trigger a resize after making overlay visible
    window.addEventListener('message', e => {
      if (e.data === 'canvas-resize') this.resize();
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
      this._applyPropToSelected('color', c);
      this.saveSnap();
    }
  }

  /* ── UI bindings ───────────────────────────────────────── */

  bindUI() {
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
    sidesR.addEventListener('input', () => {
      this.sides = parseInt(sidesR.value);
      sidesV.textContent = this.sides;
      this._applyPropToSelected('sides', this.sides);
    });
    sidesR.addEventListener('change', () => {
      if (this.selectedIds.size > 0) this.saveSnap();
    });

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

    // 1. Check rotation handle (only when single object selected)
    if (this.selectedIds.size === 1) {
      const [id] = this.selectedIds;
      const obj  = this._getObjectById(id);
      if (obj) {
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
        // Begin drag
        this.isDrawing  = true;
        this.isDragging = true;
        this.dragStart  = { x, y };
        this.dragBases  = new Map();
        for (const id of this.selectedIds) {
          const o = this._getObjectById(id);
          if (o) this.dragBases.set(id, this._cloneObject(o));
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
      return;
    }
    if (this.isGroupResizing) {
      this._applyGroupResize(x, y);
      this.renderAll(); this._drawSelectionOverlay();
      return;
    }
    if (this.isRotating) {
      const obj = this._getObjectById(this.rotateObjId);
      if (!obj) return;
      obj.rotation = Math.atan2(y - this.rotateCenter.y, x - this.rotateCenter.x) + Math.PI / 2;
      this.renderAll();
      this._drawSelectionOverlay();
      return;
    }

    if (this.isResizing) {
      this._applyResize(x, y);
      this.renderAll();
      this._drawSelectionOverlay();
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
  }

  _handleSelectUp(x, y) {
    if (this.isGroupRotating) {
      this.isGroupRotating = false; this.isDrawing = false;
      this.groupRotateBases = null;
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
      this.saveSnap();
      this._drawSelectionOverlay();
      return;
    }

    if (this.isResizing) {
      this.isResizing = false;
      this.isDrawing  = false;
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

      if (this.selectedIds.size === 1) {
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
      this._drawResizeHandles(gb);
      this._drawRotationHandle(gb);
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
  }

  undo() {
    this._setSelection(null);
    if (this.historyPtr <= 0) return;
    this.historyPtr--;
    this.objects = this._cloneObjects(this.history[this.historyPtr]);
    this.renderAll();
    this.updateHistoryUI();
  }

  redo() {
    this._setSelection(null);
    if (this.historyPtr >= this.history.length - 1) return;
    this.historyPtr++;
    this.objects = this._cloneObjects(this.history[this.historyPtr]);
    this.renderAll();
    this.updateHistoryUI();
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
    // Composite onto white background so PNG isn't transparent
    const tmp    = document.createElement('canvas');
    tmp.width    = this.main.width;
    tmp.height   = this.main.height;
    const tc     = tmp.getContext('2d');
    tc.fillStyle = '#ffffff';
    tc.fillRect(0, 0, tmp.width, tmp.height);
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
      return;
    }

    if (this.isTyping()) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && this.tool === 'select' && this.selectedIds.size > 0) {
      e.preventDefault();
      this._deleteSelected();
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
    const isShape = ['line','rect','circle','polygon','arrow'].includes(name);
    if (isShape) this._updateFlyoutTrigger('shapeFlyout', name);
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
    trigger.querySelector('i').className = source.querySelector('i').className;
  }

  _bindFlyout(flyoutId) {
    const flyout = document.getElementById(flyoutId);
    const menu   = flyout && flyout.querySelector('.cv-flyout-menu');
    if (!flyout || !menu) return;
    let hideTimer = null;
    const show = () => {
      clearTimeout(hideTimer);
      const r = flyout.getBoundingClientRect();
      menu.style.top  = (r.bottom + 4) + 'px';
      menu.style.left = '0px';
      menu.classList.add('open');
      requestAnimationFrame(() => {
        menu.style.left = (r.left + r.width / 2 - menu.offsetWidth / 2) + 'px';
      });
    };
    const hide = () => { hideTimer = setTimeout(() => menu.classList.remove('open'), 120); };
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
      case 'polygon': {
        const n = (obj.sides != null ? Math.round(obj.sides) : 3);
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
    if (type === 'circle' || type === 'triangle' || type === 'polygon') {
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
    this.objects = this.objects.filter(obj => !this.selectedIds.has(obj.id));
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
      if (['rect', 'polygon', 'triangle'].includes(type)) obj.cornerRadius = value;
    }
    if (prop === 'sides') {
      if (['polygon', 'triangle'].includes(type)) obj.sides = Math.round(value);
    }
  }

  /* ── Sync controls to selection ───────────────────────── */

  _syncControlsToSelection() {
    // Only sync when exactly 1 non-group object or 1 group is selected
    if (this.selectedIds.size !== 1) return;
    const [id] = this.selectedIds;
    const obj = this._getObjectById(id);
    if (!obj) return;
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
    if (repType === 'rect' || repType === 'polygon' || repType === 'triangle') {
      const cr = rep.cornerRadius != null ? rep.cornerRadius : 0;
      this.cornerRadius = cr;
      document.getElementById('cornerRoundingRange').value = cr;
      document.getElementById('cornerRoundingVal').textContent = cr;
    }
    if (repType === 'polygon' || repType === 'triangle') {
      const s = rep.sides != null ? rep.sides : 3;
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
    groupBtn.disabled   = this.selectedIds.size < 2;
    const sole = this.selectedIds.size === 1
      ? this._getObjectById([...this.selectedIds][0]) : null;
    ungroupBtn.disabled = !(sole && (sole.type || sole.tool) === 'group');
  }

  rgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
}

document.addEventListener('DOMContentLoaded', () => new CanvasApp());
