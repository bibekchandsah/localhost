/**
 * Canvas drawing app — canvas.js
 * Tools: pencil, brush, marker, eraser, line, rect, circle, triangle, arrow, text
 */
class CanvasApp {
  constructor() {
    this.tool     = 'pencil';
    this.color    = '#e74c3c';
    this.size     = 5;
    this.opacity  = 1.0;
    this.fillShapes = false;

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

    // Current in-progress strokes/shapes
    this.currentStroke = null;
    this.currentShape  = null;

    // Selection state — Set of selected object IDs
    this.selectedIds = new Set();
    this.isDragging  = false;
    this.dragStart   = null;
    this.dragBases   = null; // Map<id, clonedObj>

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
    const el = document.getElementById('palette');
    this.PALETTE.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'cv-swatch';
      btn.style.background = c;
      btn.title = c;
      btn.addEventListener('click', () => this.setColor(c));
      el.appendChild(btn);
    });

    // Set initial preview color
    document.getElementById('colorPreview').style.background = this.color;
    document.getElementById('colorPicker').value = this.color;
  }

  setColor(c) {
    this.color = c;
    document.getElementById('colorPicker').value = c;
    document.getElementById('colorPreview').style.background = c;
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
    });

    // Size
    const sizeR = document.getElementById('sizeRange');
    const sizeV = document.getElementById('sizeVal');
    sizeR.addEventListener('input', () => {
      this.size = parseInt(sizeR.value);
      sizeV.textContent = this.size;
    });

    // Opacity
    const opR = document.getElementById('opacityRange');
    const opV = document.getElementById('opacityVal');
    opR.addEventListener('input', () => {
      this.opacity = parseInt(opR.value) / 100;
      opV.textContent = opR.value + '%';
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

    // Close
    document.getElementById('closeBtn').addEventListener('click', () => this.close());

    // Keyboard shortcuts
    document.addEventListener('keydown', e => this.onKey(e));
  }

  updateCursor() {
    if (this.tool === 'select') { this.preview.style.cursor = 'default'; return; }
    const map = { eraser: 'cell', text: 'text' };
    this.preview.style.cursor = map[this.tool] || 'crosshair';
  }

  /* ── Canvas event bindings ─────────────────────────────── */

  bindCanvas() {
    const p = this.preview;
    p.addEventListener('mousedown',  e => this.onDown(e));
    p.addEventListener('mousemove',  e => this.onMove(e));
    p.addEventListener('mouseup',    e => this.onUp(e));
    p.addEventListener('mouseleave', e => { if (this.isDrawing) this.onUp(e); });

    // Touch support
    p.addEventListener('touchstart',  e => { e.preventDefault(); this.onDown(this.t2m(e)); }, { passive: false });
    p.addEventListener('touchmove',   e => { e.preventDefault(); this.onMove(this.t2m(e)); }, { passive: false });
    p.addEventListener('touchend',    e => { e.preventDefault(); this.onUp(this.t2m(e));   }, { passive: false });
  }

  t2m(e) {
    const t = e.touches[0] || e.changedTouches[0];
    return { clientX: t.clientX, clientY: t.clientY };
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
        fill: this.fillShapes
      };
    }
  }

  onMove(e) {
    const { x, y } = this.pos(e);

    if (this.tool === 'select') {
      if (!this.isDrawing) {
        const hov = this._findObjectAt(x, y);
        this.preview.style.cursor = (hov && this.selectedIds.has(hov.id)) ? 'move'
          : hov ? 'pointer' : 'default';
        this._drawSelectionOverlay();
        return;
      }
      this._handleSelectMove(x, y);
      return;
    }

    if (!this.isDrawing) return;

    if (this.isFreehand()) {
      this._updateFreehandPreview(x, y);
    } else {
      this._updateShapePreview(x, y);
    }

    this.lastX = x; this.lastY = y;
  }

  onUp(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    const { x, y } = this.pos(e);

    if (this.tool === 'select') { this._handleSelectUp(x, y); return; }

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
    const hit = this._findObjectAt(x, y);

    if (shiftKey) {
      // Shift+click: toggle the hit object; empty click keeps selection
      if (hit) {
        if (this.selectedIds.has(hit.id)) this.selectedIds.delete(hit.id);
        else this.selectedIds.add(hit.id);
      }
    } else {
      if (hit) {
        // Plain click on an unselected object → replace selection
        if (!this.selectedIds.has(hit.id)) this.selectedIds = new Set([hit.id]);
        // Plain click on already-selected object → keep selection (allow group drag)
      } else {
        // Plain click on empty space → deselect all
        this.selectedIds.clear();
      }
    }

    this._drawSelectionOverlay();

    // Begin drag if we clicked on a selected object
    if (hit && this.selectedIds.has(hit.id)) {
      this.isDrawing  = true;
      this.isDragging = true;
      this.dragStart  = { x, y };
      this.dragBases  = new Map();
      for (const id of this.selectedIds) {
        const obj = this._getObjectById(id);
        if (obj) this.dragBases.set(id, this._cloneObject(obj));
      }
    }
  }

  _handleSelectMove(x, y) {
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

  _handleSelectUp() {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragStart  = null;
      this.dragBases  = null;
      this.saveSnap();
    }
  }

  // Pass null to clear all, or a single id to select only that id
  _setSelection(id) {
    this.selectedIds = id != null ? new Set([id]) : new Set();
    this._drawSelectionOverlay();
  }

  _drawSelectionOverlay() {
    this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
    if (this.selectedIds.size === 0) return;

    let gx1 = Infinity, gy1 = Infinity, gx2 = -Infinity, gy2 = -Infinity;

    for (const id of this.selectedIds) {
      const obj = this._getObjectById(id);
      if (!obj) continue;
      const b = this._getBounds(obj);
      if (!b) continue;
      this._drawDashedRect(b.x, b.y, b.w, b.h, '#0078d4');
      gx1 = Math.min(gx1, b.x);   gy1 = Math.min(gy1, b.y);
      gx2 = Math.max(gx2, b.x + b.w); gy2 = Math.max(gy2, b.y + b.h);
    }

    // Group bounding box when more than one object is selected
    if (this.selectedIds.size > 1) {
      const pad = 6;
      this._drawDashedRect(gx1 - pad, gy1 - pad, gx2 - gx1 + pad * 2, gy2 - gy1 + pad * 2, '#e74c3c');
    }
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
    this.currentShape.x2 = x;
    this.currentShape.y2 = y;
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
      l: 'line',   r: 'rect',  c: 'circle', g: 'triangle',
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
    document.querySelectorAll('.cv-tool[data-tool]').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === name);
    });
    this.updateCursor();
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
    this.currentShape.x2 = x;
    this.currentShape.y2 = y;
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
      fill: this.currentShape.fill
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

    const x1 = obj.x1;
    const y1 = obj.y1;
    const x2 = obj.x2;
    const y2 = obj.y2;
    const w = x2 - x1;
    const h = y2 - y1;

    ctx.beginPath();
    switch (type) {
      case 'line':
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;

      case 'rect':
        if (obj.fill) ctx.fillRect(x1, y1, w, h);
        else ctx.strokeRect(x1, y1, w, h);
        break;

      case 'circle': {
        const cx = x1 + w / 2, cy = y1 + h / 2;
        const rx = Math.abs(w) / 2 || 1;
        const ry = Math.abs(h) / 2 || 1;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      }

      case 'triangle':
        ctx.moveTo(x1 + w / 2, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x1, y2);
        ctx.closePath();
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;

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
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
    if (stroke.tool === 'brush') {
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur  = stroke.size * 0.6;
    } else {
      ctx.shadowBlur = 0;
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
    if (type === 'stroke') {
      return this._hitStroke(obj, x, y, pad);
    }

    if (type === 'text') {
      const b = this._getBounds(obj);
      return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
    }

    const b = this._getBounds(obj);
    if (!b) return false;
    if (type === 'rect' || type === 'circle' || type === 'triangle') {
      if (obj.fill) {
        return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
      }
      return this._hitRectOutline(b, x, y, (obj.size || this.size) + pad);
    }

    if (type === 'line' || type === 'arrow') {
      return this._distToSegment(x, y, obj.x1, obj.y1, obj.x2, obj.y2) <= (obj.size || this.size) + pad;
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
    const type = obj.type || obj.tool;
    if (type === 'stroke') {
      const pts = obj.points;
      if (!pts || pts.length === 0) return null;
      let minX = pts[0].x;
      let minY = pts[0].y;
      let maxX = pts[0].x;
      let maxY = pts[0].y;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
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

    const x1 = Math.min(obj.x1, obj.x2);
    const y1 = Math.min(obj.y1, obj.y2);
    const x2 = Math.max(obj.x1, obj.x2);
    const y2 = Math.max(obj.y1, obj.y2);
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

  rgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
}

document.addEventListener('DOMContentLoaded', () => new CanvasApp());
