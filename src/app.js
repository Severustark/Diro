'use strict';

// ── State ────────────────────────────────────────────────────
const state = {
  username: '',
  userColor: '#e94560',
  roomId: '',
  tool: 'select',
  strokeColor: '#1a1a2e',
  fillColor: 'transparent',
  strokeWidth: 2,
  opacity: 1,
  fontSize: 18,
  zoom: 1,
  panX: 0,
  panY: 0,

  // Realtime
  pusher: null,
  channel: null,
  peerId: null,
  presenceHeartbeat: null,

  // Fabric
  canvas: null,

  // Drawing state
  isDrawing: false,
  drawStart: null,
  activeShape: null,
  isPanning: false,
  lastPanPoint: null,

  // Sync lock
  syncing: false,

  // Remote users
  peers: {}
};

// ── Utilities ────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getObjectById(id) {
  return state.canvas.getObjects().find(o => o._id === id);
}

function setStatus(msg) {
  const el = document.getElementById('status-msg');
  if (el) el.textContent = msg;
}

function setConnStatus(status, msg) {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.className = 'conn-dot ' + status;
  el.textContent = '● ' + msg;
}

function showToast(msg, duration = 2500) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:48px;left:50%;transform:translateX(-50%);
    background:#1e1e30;border:0.5px solid rgba(255,255,255,0.14);
    color:#f0f0f0;padding:8px 20px;border-radius:8px;
    font-size:13px;z-index:9999;pointer-events:none;
  `;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(() => t.remove(), 350);
  }, duration);
}

function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function bringTextToFront(textObj) {
  if (textObj) state.canvas.bringToFront(textObj);
}

// ── Sticky helpers ───────────────────────────────────────────
function updateStickyLayout(rect) {
  if (!rect || rect._type !== 'sticky-bg') return;

  const text = getObjectById(rect._linkedTextId);
  if (!text) return;

  const PAD = 12;
  const newWidth = rect.width * rect.scaleX;
  const newHeight = rect.height * rect.scaleY;

  rect.set({
    width: newWidth,
    height: newHeight,
    scaleX: 1,
    scaleY: 1
  });

  text.set({
    left: rect.left + PAD,
    top: rect.top + PAD,
    width: Math.max(40, newWidth - PAD * 2)
  });

  text.setCoords();
  rect.setCoords();
  bringTextToFront(text);
  state.canvas.renderAll();
}

function moveStickyTextWithRect(rect) {
  if (!rect || rect._type !== 'sticky-bg') return;

  const text = getObjectById(rect._linkedTextId);
  if (!text) return;

  const PAD = 12;

  text.set({
    left: rect.left + PAD,
    top: rect.top + PAD,
    width: Math.max(40, rect.width - PAD * 2)
  });

  text.setCoords();
  bringTextToFront(text);
  state.canvas.renderAll();
}

// ── Modal / Room Setup ───────────────────────────────────────
let selectedCreateColor = '#e94560';
let selectedJoinColor = '#0f3460';
let currentRoomCode = '';

window.switchTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && tab === 'create') || (i === 1 && tab === 'join'));
  });
  document.getElementById('tab-create').classList.toggle('active', tab === 'create');
  document.getElementById('tab-join').classList.toggle('active', tab === 'join');
};

window.pickColor = function(el, group) {
  document.querySelectorAll(`#${group === 'create' ? 'create-colors' : 'join-colors'} .color-dot`)
    .forEach(d => d.classList.remove('active'));
  el.classList.add('active');
  if (group === 'create') selectedCreateColor = el.dataset.color;
  else selectedJoinColor = el.dataset.color;
};

window.createRoom = function() {
  const name = document.getElementById('create-username').value.trim();
  if (!name) {
    showToast('Kullanıcı adı gir!');
    return;
  }

  currentRoomCode = randomRoomCode();
  document.getElementById('room-code-text').textContent = currentRoomCode;
  document.getElementById('room-created').style.display = 'flex';

  state.username = name;
  state.userColor = selectedCreateColor;
  state.roomId = 'diro-' + currentRoomCode;
  state.peerId = uid();

  setTimeout(() => launchApp(), 800);
};

window.joinRoom = function() {
  const name = document.getElementById('join-username').value.trim();
  const code = document.getElementById('join-room-code').value.trim().toUpperCase();

  if (!name) {
    showToast('Kullanıcı adı gir!');
    return;
  }
  if (!code || code.length < 4) {
    showToast('Geçerli bir oda kodu gir!');
    return;
  }

  state.username = name;
  state.userColor = selectedJoinColor;
  state.roomId = 'diro-' + code;
  currentRoomCode = code;
  state.peerId = uid();

  launchApp();
};

window.copyRoomCode = function() {
  navigator.clipboard.writeText(currentRoomCode).then(() => showToast('Oda kodu kopyalandı!'));
};

window.leaveRoom = function() {
  stopRealtime();
  location.reload();
};

// ── App Init ─────────────────────────────────────────────────
function launchApp() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('app').style.display = 'grid';
  document.getElementById('room-badge').textContent = '# ' + currentRoomCode;

  initCanvas();
  initRealtime();
  setupKeyboard();
  updateUsersBar();
  setStatus('Hazır — ' + state.username);
}

// ── Fabric Canvas Init ───────────────────────────────────────
function initCanvas() {
  const container = document.getElementById('canvas-container');
  const W = container.clientWidth;
  const H = container.clientHeight;

  const canvasEl = document.getElementById('main-canvas');
  canvasEl.width = W;
  canvasEl.height = H;

  const fc = new fabric.Canvas('main-canvas', {
    selection: true,
    selectionColor: 'rgba(100,100,255,0.1)',
    selectionBorderColor: '#533483',
    selectionLineWidth: 1,
    preserveObjectStacking: true,
    backgroundColor: null
  });

  state.canvas = fc;

  fc.on('mouse:down', onMouseDown);
  fc.on('mouse:move', onMouseMove);
  fc.on('mouse:up', onMouseUp);
  fc.on('path:created', onPathCreated);
  fc.on('object:modified', onObjectModified);
  fc.on('object:removed', onObjectRemoved);
  fc.on('selection:created', onSelection);
  fc.on('selection:updated', onSelection);
  fc.on('selection:cleared', () => {});
  fc.on('object:moving', onObjectMoving);
  fc.on('text:changed', onTextChanged);

  container.addEventListener('mousemove', broadcastCursor);

  window.addEventListener('resize', () => {
    fc.setWidth(container.clientWidth);
    fc.setHeight(container.clientHeight);
    fc.renderAll();
  });
}

// ── Pusher Realtime ──────────────────────────────────────────
function initRealtime() {
  if (!window.Pusher || !window.PUSHER_CONFIG?.key || !window.PUSHER_CONFIG?.cluster) {
    console.error('Pusher config eksik.');
    setConnStatus('disconnected', 'Pusher yok');
    setStatus('Pusher yapılandırması eksik');
    showToast('Pusher key/cluster eklenmemiş.');
    return;
  }

  setConnStatus('connecting', 'Bağlanıyor...');
  setStatus('Pusher bağlantısı kuruluyor...');

  Pusher.logToConsole = false;

  state.pusher = new Pusher(window.PUSHER_CONFIG.key, {
    cluster: window.PUSHER_CONFIG.cluster
  });

  state.channel = state.pusher.subscribe(state.roomId);

  state.pusher.connection.bind('connected', () => {
    setConnStatus('connected', 'Bağlandı');
    setStatus('Senkronize — ' + state.username);
    showToast('Pusher bağlandı');
  });

  state.pusher.connection.bind('disconnected', () => {
    setConnStatus('disconnected', 'Bağlantı koptu');
    setStatus('Pusher bağlantısı kesildi');
  });

  state.pusher.connection.bind('error', (err) => {
    console.error('Pusher error:', err);
    setConnStatus('disconnected', 'Hata');
    setStatus('Pusher bağlantı hatası');
  });

  state.channel.bind('object:add', (payload) => {
    console.log('object:add geldi ->', payload);

    if (!payload) return;
    if (payload.peerId === state.peerId) return;
    if (!payload.object) return;

    addObjectFromRemote(payload.object);
  });
}

function stopRealtime() {
  if (state.channel) {
    try {
      state.channel.unbind_all();
    } catch (e) {}
  }

  if (state.pusher) {
    try {
      state.pusher.disconnect();
    } catch (e) {}
  }

  state.channel = null;
  state.pusher = null;
}

function publish() {
  return;
}

function handleRealtimeMessage() {
  return;
}

function startPresenceHeartbeat() {
  return;
}

function publishPresence() {
  return;
}

function handlePresence() {
  return;
}

function cleanupStalePeers() {
  const now = Date.now();
  Object.keys(state.peers).forEach(peerId => {
    if (now - (state.peers[peerId].ts || 0) > 10000) {
      delete state.peers[peerId];
      removePeerCursor(peerId);
    }
  });
}

// ── Awareness / Cursors ──────────────────────────────────────
function broadcastCursor() {
  return;
}

function updateRemoteCursor(data) {
  if (!data?.peerId) return;

  state.peers[data.peerId] = {
    username: data.username,
    color: data.color,
    ts: data.ts || Date.now()
  };

  let el = document.getElementById('cursor-' + data.peerId);
  if (!el) {
    el = document.createElement('div');
    el.id = 'cursor-' + data.peerId;
    el.className = 'remote-cursor';
    el.innerHTML = `
      <div class="cursor-icon" style="color:${data.color}"></div>
      <div class="cursor-label" style="background:${data.color}">${data.username}</div>
    `;
    const layer = document.getElementById('cursors-layer');
    if (layer) layer.appendChild(el);
  }

  el.style.transform = `translate(${data.x}px, ${data.y}px)`;
  updateUsersBar();
}

function removePeerCursor(peerId) {
  const el = document.getElementById('cursor-' + peerId);
  if (el) el.remove();
}

// ── Users Bar ────────────────────────────────────────────────
function updateUsersBar() {
  cleanupStalePeers();

  const bar = document.getElementById('users-bar');
  if (!bar) return;

  bar.innerHTML = '';

  const self = document.createElement('div');
  self.className = 'user-avatar';
  self.style.background = state.userColor;
  self.textContent = state.username.slice(0, 2).toUpperCase();
  self.title = state.username + ' (sen)';
  bar.appendChild(self);

  Object.entries(state.peers).forEach(([peerId, peer]) => {
    if (!peer || peerId === state.peerId) return;

    const av = document.createElement('div');
    av.className = 'user-avatar';
    av.style.background = peer.color || '#888';
    av.textContent = (peer.username || '?').slice(0, 2).toUpperCase();
    av.title = peer.username || 'Katılımcı';
    bar.appendChild(av);
  });
}

// ── Tool Management ───────────────────────────────────────────
window.setTool = function(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });

  const fc = state.canvas;
  fc.isDrawingMode = false;
  fc.selection = true;
  fc.defaultCursor = 'default';
  fc.hoverCursor = 'move';

  const fontSec = document.getElementById('font-section');

  if (tool === 'draw') {
    fc.isDrawingMode = true;
    fc.freeDrawingBrush = new fabric.PencilBrush(fc);
    fc.freeDrawingBrush.width = state.strokeWidth;
    fc.freeDrawingBrush.color = state.strokeColor;
    fontSec.style.display = 'none';
  } else if (tool === 'eraser') {
    fc.isDrawingMode = false;
    fc.selection = false;
    fc.defaultCursor = 'cell';
    fontSec.style.display = 'none';
  } else if (tool === 'hand') {
    fc.selection = false;
    fc.defaultCursor = 'grab';
    fc.hoverCursor = 'grab';
    fontSec.style.display = 'none';
  } else if (tool === 'select') {
    fontSec.style.display = 'none';
  } else if (tool === 'text') {
    fc.selection = false;
    fc.defaultCursor = 'text';
    fontSec.style.display = 'block';
  } else {
    fc.selection = false;
    fc.defaultCursor = 'crosshair';
    fontSec.style.display = 'none';
  }

  fc.renderAll();
  setStatus('Araç: ' + tool);
};

// ── Mouse Events ─────────────────────────────────────────────
function onMouseDown(opt) {
  const e = opt.e;
  const fc = state.canvas;
  const pointer = fc.getPointer(e);

  if (state.tool === 'hand') {
    state.isPanning = true;
    state.lastPanPoint = { x: e.clientX, y: e.clientY };
    fc.defaultCursor = 'grabbing';
    return;
  }

  if (state.tool === 'select' || state.tool === 'draw') return;

  if (state.tool === 'eraser') {
    const target = fc.findTarget(e);
    if (target) removeObject(target);
    return;
  }

  if (state.tool === 'text') {
    state.isDrawing = true;
    state.drawStart = { x: pointer.x, y: pointer.y };

    const textbox = new fabric.Textbox('Yazı...', {
      left: pointer.x,
      top: pointer.y,
      width: 200,
      fontSize: state.fontSize,
      fontFamily: 'DM Sans, sans-serif',
      fill: state.strokeColor,
      opacity: state.opacity,
      selectable: true,
      editable: true,
      splitByGrapheme: true
    });

    textbox.on('editing:exited', () => {
      if (!textbox._id) return;
      syncAdd(textbox);
    });

    state.activeShape = textbox;
    state.canvas.add(textbox);
    return;
  }

  if (state.tool === 'sticky') {
    addStickyNote(pointer.x, pointer.y);
    return;
  }

  state.isDrawing = true;
  state.drawStart = { x: pointer.x, y: pointer.y };

  if (state.tool === 'rect') {
    state.activeShape = new fabric.Rect({
      left: pointer.x,
      top: pointer.y,
      width: 1,
      height: 1,
      stroke: state.strokeColor,
      strokeWidth: state.strokeWidth,
      fill: state.fillColor === 'transparent' ? 'transparent' : state.fillColor,
      opacity: state.opacity,
      selectable: false
    });
    fc.add(state.activeShape);
  } else if (state.tool === 'circle') {
    state.activeShape = new fabric.Ellipse({
      left: pointer.x,
      top: pointer.y,
      rx: 1,
      ry: 1,
      stroke: state.strokeColor,
      strokeWidth: state.strokeWidth,
      fill: state.fillColor === 'transparent' ? 'transparent' : state.fillColor,
      opacity: state.opacity,
      selectable: false
    });
    fc.add(state.activeShape);
  } else if (state.tool === 'arrow') {
    state.activeShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
      stroke: state.strokeColor,
      strokeWidth: state.strokeWidth,
      opacity: state.opacity,
      selectable: false
    });
    fc.add(state.activeShape);
  }
}

function onMouseMove(opt) {
  const e = opt.e;
  const fc = state.canvas;
  const pointer = fc.getPointer(e);

  if (state.isPanning && state.tool === 'hand') {
    const dx = e.clientX - state.lastPanPoint.x;
    const dy = e.clientY - state.lastPanPoint.y;
    state.panX += dx;
    state.panY += dy;
    state.lastPanPoint = { x: e.clientX, y: e.clientY };
    const vpt = fc.viewportTransform.slice();
    vpt[4] += dx;
    vpt[5] += dy;
    fc.setViewportTransform(vpt);
    fc.renderAll();
    return;
  }

  if (!state.isDrawing || !state.activeShape || !state.drawStart) return;

  const dx = pointer.x - state.drawStart.x;
  const dy = pointer.y - state.drawStart.y;

  if (state.tool === 'rect') {
    state.activeShape.set({
      left: dx < 0 ? pointer.x : state.drawStart.x,
      top: dy < 0 ? pointer.y : state.drawStart.y,
      width: Math.abs(dx),
      height: Math.abs(dy)
    });
  } else if (state.tool === 'circle') {
    state.activeShape.set({
      rx: Math.abs(dx) / 2,
      ry: Math.abs(dy) / 2,
      left: dx < 0 ? pointer.x : state.drawStart.x,
      top: dy < 0 ? pointer.y : state.drawStart.y
    });
  } else if (state.tool === 'arrow') {
    state.activeShape.set({ x2: pointer.x, y2: pointer.y });
  } else if (state.tool === 'text') {
    const width = Math.max(40, Math.abs(pointer.x - state.drawStart.x));
    state.activeShape.set({
      left: pointer.x < state.drawStart.x ? pointer.x : state.drawStart.x,
      width
    });
  }

  fc.renderAll();
}

function onMouseUp() {
  if (state.isPanning) {
    state.isPanning = false;
    state.canvas.defaultCursor = 'grab';
  }

  if (state.isDrawing && state.activeShape) {
    const obj = state.activeShape;
    obj.set({ selectable: true });
    obj._id = uid();
    obj._owner = state.username;

    if (state.tool === 'text') {
      state.canvas.setActiveObject(obj);
      state.canvas.renderAll();
      obj.enterEditing();
      obj.selectAll();
      setStatus('Metin kutusu eklendi');
    } else {
      if (state.tool === 'arrow') addArrowhead(obj);
      state.canvas.renderAll();
      syncAdd(obj);
      setStatus('Nesne eklendi');
    }
  }

  state.isDrawing = false;
  state.activeShape = null;
  state.drawStart = null;
}

function onPathCreated(opt) {
  const path = opt.path;
  path._id = uid();
  path._owner = state.username;
  syncAdd(path);
  setStatus('Çizim tamamlandı');
}

function onObjectModified(opt) {
  if (state.syncing) return;

  const obj = opt.target;
  if (!obj || !obj._id) return;

  if (obj._type === 'sticky-bg') {
    updateStickyLayout(obj);
    syncModify(obj);

    const text = getObjectById(obj._linkedTextId);
    if (text && text._id) syncModify(text);
    return;
  }

  if (obj._type === 'sticky-text') {
    syncModify(obj);
    return;
  }

  syncModify(obj);
}

function onObjectRemoved(opt) {
  if (state.syncing) return;
  const obj = opt.target;
  if (!obj || !obj._id) return;
  syncRemove(obj._id);
}

function onSelection() {
  const active = state.canvas.getActiveObject();
  if (!active) return;
  if (active.stroke) updateColorUI(active.stroke);
}

function onObjectMoving(opt) {
  const obj = opt.target;
  if (!obj) return;

  if (obj._type === 'sticky-bg') {
    moveStickyTextWithRect(obj);
  }
}

function onTextChanged(opt) {
  const obj = opt.target;
  if (!obj) return;

  if (obj._type === 'sticky-text') {
    const rect = getObjectById(obj._linkedRectId);
    if (!rect) return;

    const PAD = 12;

    obj.set({
      width: Math.max(40, rect.width - PAD * 2),
      left: rect.left + PAD,
      top: rect.top + PAD
    });

    obj.setCoords();

    const neededHeight = obj.height + PAD * 2;
    if (neededHeight > rect.height) {
      rect.set({ height: neededHeight });
      rect.setCoords();
    }

    state.canvas.renderAll();
    syncModify(obj);
    syncModify(rect);
  }
}

// ── Text & Sticky Notes ──────────────────────────────────────
function addStickyNote(x, y) {
  const colors = ['#fff9c4', '#ffecd2', '#e8f5e9', '#e3f2fd', '#f3e5f5'];
  const bg = colors[Math.floor(Math.random() * colors.length)];
  const W = 180, H = 140;
  const PAD = 12;
  const noteId = uid();

  const rect = new fabric.Rect({
    left: x,
    top: y,
    width: W,
    height: H,
    fill: bg,
    stroke: 'rgba(0,0,0,0.08)',
    strokeWidth: 1,
    rx: 6,
    ry: 6,
    shadow: new fabric.Shadow({
      color: 'rgba(0,0,0,0.18)',
      blur: 8,
      offsetX: 2,
      offsetY: 2
    }),
    selectable: true,
    hasControls: true,
    lockUniScaling: false
  });

  const text = new fabric.Textbox('Not yaz...', {
    left: x + PAD,
    top: y + PAD,
    width: W - PAD * 2,
    fontSize: 14,
    lineHeight: 1.2,
    fontFamily: 'DM Sans, sans-serif',
    fill: '#333',
    editable: true,
    selectable: true,
    splitByGrapheme: true
  });

  rect._id = noteId + '-bg';
  rect._noteId = noteId;
  rect._type = 'sticky-bg';
  rect._owner = state.username;

  text._id = noteId + '-text';
  text._noteId = noteId;
  text._type = 'sticky-text';
  text._owner = state.username;

  rect._linkedTextId = text._id;
  text._linkedRectId = rect._id;

  state.canvas.add(rect);
  state.canvas.add(text);

  bringTextToFront(text);
  state.canvas.setActiveObject(text);
  text.enterEditing();
  text.selectAll();

  syncAdd(rect);
  syncAdd(text);

  setTool('select');
  setStatus('Yapışkan not eklendi');
}

// ── Arrow Helpers ────────────────────────────────────────────
function addArrowhead(line) {
  const x1 = line.x1, y1 = line.y1, x2 = line.x2, y2 = line.y2;
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  const headLen = Math.min(20, line.strokeWidth * 5 + 10);

  const triangle = new fabric.Triangle({
    left: x2,
    top: y2,
    width: headLen,
    height: headLen,
    fill: line.stroke,
    angle: angle + 90,
    originX: 'center',
    originY: 'center',
    selectable: false
  });

  triangle._id = uid();
  triangle._owner = state.username;
  state.canvas.add(triangle);
  syncAdd(triangle);
}

// ── Serialization / Sync ─────────────────────────────────────
function syncAdd(obj) {
  if (state.syncing || !obj?._id) return;

if (obj.type === 'path') {
  const simplifiedPath = Array.isArray(obj.path)
    ? obj.path.slice(0, 120)
    : [];

  const data = {
    type: 'path',
    _id: obj._id,
    _owner: obj._owner || state.username,
    left: obj.left ?? 0,
    top: obj.top ?? 0,
    scaleX: obj.scaleX ?? 1,
    scaleY: obj.scaleY ?? 1,
    angle: obj.angle ?? 0,
    opacity: obj.opacity ?? 1,
    stroke: obj.stroke ?? null,
    strokeWidth: obj.strokeWidth ?? 1,
    fill: obj.fill ?? '',
    path: simplifiedPath
  };

  fetch('http://localhost:3000/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      roomId: state.roomId,
      peerId: state.peerId,
      object: data
    })
  })
    .then(async (res) => {
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'ADD failed');
      }
      console.log('path backende gitti');
    })
    .catch((err) => {
      console.error('path sync error:', err);
    });

  return;
}

  const data = {
    type: obj.type,
    _id: obj._id,
    _owner: obj._owner || state.username,
    _type: obj._type || null,
    _noteId: obj._noteId || null,
    _linkedTextId: obj._linkedTextId || null,
    _linkedRectId: obj._linkedRectId || null,

    left: obj.left ?? 0,
    top: obj.top ?? 0,
    width: obj.width ?? 0,
    height: obj.height ?? 0,
    scaleX: obj.scaleX ?? 1,
    scaleY: obj.scaleY ?? 1,
    angle: obj.angle ?? 0,
    opacity: obj.opacity ?? 1,

    fill: obj.fill ?? 'transparent',
    stroke: obj.stroke ?? null,
    strokeWidth: obj.strokeWidth ?? 1
  };

  if (obj.type === 'rect') {
    data.rx = obj.rx ?? 0;
    data.ry = obj.ry ?? 0;
  }

  if (obj.type === 'ellipse') {
    data.rx = obj.rx ?? 0;
    data.ry = obj.ry ?? 0;
  }

  if (obj.type === 'line') {
    data.x1 = obj.x1;
    data.y1 = obj.y1;
    data.x2 = obj.x2;
    data.y2 = obj.y2;
  }

  if (obj.type === 'triangle') {
    data.originX = obj.originX ?? 'left';
    data.originY = obj.originY ?? 'top';
  }

if (obj.type === 'textbox') {
  data.text = obj.text ?? '';
  data.fontSize = obj.fontSize ?? 18;
  data.fontFamily = obj.fontFamily ?? 'DM Sans, sans-serif';
  data.lineHeight = obj.lineHeight ?? 1.16;
  data.editable = obj.editable ?? true;
  data.splitByGrapheme = obj.splitByGrapheme ?? true;
  data.width = obj.width ?? 200;

  data._type = obj._type || null;
  data._noteId = obj._noteId || null;
  data._linkedRectId = obj._linkedRectId || null;
}

  fetch('http://localhost:3000/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      roomId: state.roomId,
      peerId: state.peerId,
      object: data
    })
  })
    .then(async (res) => {
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'ADD failed');
      }
      console.log('object:add backende gitti');
    })
    .catch((err) => {
      console.error('syncAdd error:', err);
    });
}

function syncModify() {
  return;
}

function syncRemove() {
  return;
}

function addObjectFromRemote(data) {
  state.syncing = true;
  deserializeAndAdd(data);
  state.syncing = false;
  setStatus('← Uzak nesne alındı');
}

function modifyObjectFromRemote(data) {
  state.syncing = true;

  const existing = state.canvas.getObjects().find(o => o._id === data._id);
  if (existing) {
    existing.set(data);
    existing.setCoords();
    state.canvas.renderAll();
  } else {
    deserializeAndAdd(data);
  }

  state.syncing = false;
}

function removeObjectById(id) {
  state.syncing = true;
  const obj = state.canvas.getObjects().find(o => o._id === id);
  if (obj) state.canvas.remove(obj);
  state.canvas.renderAll();
  state.syncing = false;
}

function removeObjectFromRemote(id) {
  removeObjectById(id);
  setStatus('← Uzak nesne silindi');
}

function deserializeAndAdd(data) {
  if (!data || !data.type) return;

  const existing = state.canvas.getObjects().find(o => o._id === data._id);
  if (existing) return;

  let obj = null;

if (data.type === 'rect') {
  obj = new fabric.Rect(data);
} else if (data.type === 'ellipse') {
  obj = new fabric.Ellipse(data);
} else if (data.type === 'line') {
  obj = new fabric.Line([data.x1, data.y1, data.x2, data.y2], data);
} else if (data.type === 'triangle') {
  obj = new fabric.Triangle(data);
} else if (data.type === 'textbox') {
  obj = new fabric.Textbox(data.text || '', data);

  obj._type = data._type || null;
  obj._noteId = data._noteId || null;
  obj._linkedRectId = data._linkedRectId || null;

} else if (data.type === 'path') {
  obj = new fabric.Path(data.path, data);
} else {
  console.warn('Desteklenmeyen obje tipi:', data.type);
  return;
}

  obj._id = data._id || uid();
  obj._owner = data._owner || 'unknown';
  obj._type = data._type || null;
  obj._noteId = data._noteId || null;
  obj._linkedTextId = data._linkedTextId || null;
  obj._linkedRectId = data._linkedRectId || null;

  state.canvas.add(obj);

  if (obj._type === 'sticky-text') {
    bringTextToFront(obj);
  }

  state.canvas.renderAll();
}

// ── Object Management ────────────────────────────────────────
function removeObject(obj) {
  if (!obj) return;

  if (obj._type === 'sticky-bg') {
    const text = getObjectById(obj._linkedTextId);
    if (text) {
      state.canvas.remove(text);
      if (text._id) syncRemove(text._id);
    }
  }

  if (obj._type === 'sticky-text') {
    const rect = getObjectById(obj._linkedRectId);
    if (rect) {
      state.canvas.remove(rect);
      if (rect._id) syncRemove(rect._id);
    }
  }

  state.canvas.remove(obj);
  if (obj._id) syncRemove(obj._id);

  setStatus('Nesne silindi');
}

window.deleteSelected = function() {
  const active = state.canvas.getActiveObjects();
  if (!active.length) return;
  active.forEach(obj => removeObject(obj));
  state.canvas.discardActiveObject();
  state.canvas.renderAll();
};

window.bringForward = function() {
  const obj = state.canvas.getActiveObject();
  if (obj) {
    state.canvas.bringForward(obj);
    state.canvas.renderAll();
  }
};

window.sendBackward = function() {
  const obj = state.canvas.getActiveObject();
  if (obj) {
    state.canvas.sendBackwards(obj);
    state.canvas.renderAll();
  }
};

window.clearCanvas = function() {
  if (!confirm('Tuvali temizlemek istediğinizden emin misiniz?')) return;

  state.syncing = true;
  state.canvas.clear();
  state.syncing = false;
  state.canvas.renderAll();

  setStatus('Tuval temizlendi');
};

// ── Controls / UI helpers ────────────────────────────────────
window.setStrokeColor = function(el) {
  document.querySelectorAll('#stroke-colors .cp-swatch').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  state.strokeColor = el.dataset.color;
};

window.setFillColor = function(el) {
  document.querySelectorAll('#fill-colors .cp-swatch').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  state.fillColor = el.dataset.color;
};

window.setCustomColor = function(value) {
  state.strokeColor = value;
};

window.setStrokeWidth = function(value) {
  state.strokeWidth = Number(value);
  const el = document.getElementById('stroke-width-val');
  if (el) el.textContent = value + 'px';
};

window.setOpacity = function(value) {
  state.opacity = Number(value);
  const el = document.getElementById('opacity-val');
  if (el) el.textContent = Math.round(Number(value) * 100) + '%';
};

window.setFontSize = function(value) {
  state.fontSize = Number(value);
  const el = document.getElementById('font-size-val');
  if (el) el.textContent = value + 'px';
};

function updateColorUI() {}

window.exportPNG = function() {
  const dataUrl = state.canvas.toDataURL({
    format: 'png',
    multiplier: 2
  });

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `diro-${currentRoomCode}.png`;
  a.click();
};

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || document.activeElement?.contentEditable === 'true';
      if (!isTyping) {
        e.preventDefault();
        deleteSelected();
      }
    }

    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    const key = e.key.toLowerCase();
    if (key === 'v') setTool('select');
    if (key === 'h') setTool('hand');
    if (key === 't') setTool('text');
    if (key === 'n') setTool('sticky');
    if (key === 'r') setTool('rect');
    if (key === 'c') setTool('circle');
    if (key === 'a') setTool('arrow');
    if (key === 'd') setTool('draw');
    if (key === 'e') setTool('eraser');
  });
}