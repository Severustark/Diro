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

  // Yjs (optional)
  ydoc: null,
  provider: null,
  yObjects: null,
  awareness: null,

  // Fabric
  canvas: null,

  // Drawing state
  isDrawing: false,
  drawStart: null,
  activeShape: null,
  isPanning: false,
  lastPanPoint: null,

  // CRDT sync lock
  syncing: false,

  // Remote users
  peers: {},
};

// ── Utilities ────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function getObjectById(id) {
  return state.canvas.getObjects().find(o => o._id === id);
}
function bringTextToFront(textObj) {
  if (textObj) state.canvas.bringToFront(textObj);
}
function updateStickyLayout(rect) {
  if (!rect || rect._type !== 'sticky-bg') return;
  const text = getObjectById(rect._linkedTextId);
  if (!text) return;
  const PAD = 12;
  const newWidth  = rect.width  * rect.scaleX;
  const newHeight = rect.height * rect.scaleY;
  rect.set({ width: newWidth, height: newHeight, scaleX: 1, scaleY: 1 });
  text.set({ left: rect.left + PAD, top: rect.top + PAD, width: Math.max(40, newWidth - PAD * 2) });
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
  text.set({ left: rect.left + PAD, top: rect.top + PAD, width: Math.max(40, rect.width - PAD * 2) });
  text.setCoords();
  bringTextToFront(text);
  state.canvas.renderAll();
}
function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, ()=> chars[Math.floor(Math.random()*chars.length)]).join('');
}
function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}
function setConnStatus(s, msg) {
  const el = document.getElementById('conn-status');
  el.className = 'conn-dot ' + s;
  el.textContent = '● ' + msg;
}
function showToast(msg, duration=2500) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:48px;left:50%;transform:translateX(-50%);
    background:#1e1e30;border:0.5px solid rgba(255,255,255,0.14);
    color:#f0f0f0;padding:8px 20px;border-radius:8px;
    font-size:13px;z-index:9999;pointer-events:none;
    animation:toastIn 0.3s ease;
  `;
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(()=>t.remove(),350); }, duration);
}

// ── Modal / Room Setup ────────────────────────────────────────
let selectedCreateColor = '#e94560';
let selectedJoinColor   = '#0f3460';
let currentRoomCode     = '';

window.switchTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach((b,i)=>{
    b.classList.toggle('active',(i===0&&tab==='create')||(i===1&&tab==='join'));
  });
  document.getElementById('tab-create').classList.toggle('active', tab==='create');
  document.getElementById('tab-join').classList.toggle('active',   tab==='join');
};
window.pickColor = function(el, group) {
  document.querySelectorAll(`#${group==='create'?'create-colors':'join-colors'} .color-dot`)
    .forEach(d=>d.classList.remove('active'));
  el.classList.add('active');
  if(group==='create') selectedCreateColor = el.dataset.color;
  else selectedJoinColor = el.dataset.color;
};
window.createRoom = function() {
  const name = document.getElementById('create-username').value.trim();
  if(!name){ showToast('Kullanıcı adı gir!'); return; }
  currentRoomCode = randomRoomCode();
  document.getElementById('room-code-text').textContent = currentRoomCode;
  document.getElementById('room-created').style.display = 'flex';
  state.username  = name;
  state.userColor = selectedCreateColor;
  state.roomId    = 'diro-' + currentRoomCode;
  setTimeout(()=> launchApp(), 1500);
};
window.joinRoom = function() {
  const name = document.getElementById('join-username').value.trim();
  const code = document.getElementById('join-room-code').value.trim().toUpperCase();
  if(!name){ showToast('Kullanıcı adı gir!'); return; }
  if(!code || code.length < 4){ showToast('Geçerli bir oda kodu gir!'); return; }
  state.username  = name;
  state.userColor = selectedJoinColor;
  state.roomId    = 'diro-' + code;
  currentRoomCode = code;
  launchApp();
};
window.copyRoomCode = function() {
  navigator.clipboard.writeText(currentRoomCode).then(()=>showToast('Oda kodu kopyalandı!'));
};
window.leaveRoom = function() {
  if(state.provider) state.provider.destroy();
  if(state.ydoc)     state.ydoc.destroy();
  if(state.bc)       state.bc.close();
  location.reload();
};

// ── App Init ─────────────────────────────────────────────────
function launchApp() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('app').style.display = 'grid';
  document.getElementById('room-badge').textContent = '# ' + currentRoomCode;

  initCanvas();
  initSync();   // BroadcastChannel + optional Yjs
  setupKeyboard();
  updateUsersBar();
  setStatus('Hazır — ' + state.username);
}

// ── Fabric Canvas Init ────────────────────────────────────────
function initCanvas() {
  const container = document.getElementById('canvas-container');
  const W = container.clientWidth;
  const H = container.clientHeight;
  const canvasEl = document.getElementById('main-canvas');
  canvasEl.width  = W;
  canvasEl.height = H;

  const fc = new fabric.Canvas('main-canvas', {
    selection: true,
    selectionColor: 'rgba(100,100,255,0.1)',
    selectionBorderColor: '#533483',
    selectionLineWidth: 1,
    preserveObjectStacking: true,
    backgroundColor: null,
  });
  state.canvas = fc;

  fc.on('mouse:down',       onMouseDown);
  fc.on('mouse:move',       onMouseMove);
  fc.on('mouse:up',         onMouseUp);
  fc.on('path:created',     onPathCreated);
  fc.on('object:modified',  onObjectModified);
  fc.on('object:removed',   onObjectRemoved);
  fc.on('selection:created',onSelection);
  fc.on('selection:updated',onSelection);
  fc.on('object:moving',    onObjectMoving);
  fc.on('text:changed',     onTextChanged);

  container.addEventListener('mousemove', broadcastCursor);

  window.addEventListener('resize', ()=>{
    fc.setWidth(container.clientWidth);
    fc.setHeight(container.clientHeight);
    fc.renderAll();
  });
}

// ── Sync Layer: BroadcastChannel (primary) + Yjs (optional) ──
function initSync() {
  // ── 1. BroadcastChannel — always active for same-origin tabs ──
  state.bc = new BroadcastChannel(state.roomId);
  state.bc.onmessage = (e) => {
    const { type, data } = e.data;
    if (type === 'object:add')          addObjectFromRemote(data);
    else if (type === 'object:modify')  modifyObjectFromRemote(data);
    else if (type === 'object:remove')  removeObjectById(data._id);
    else if (type === 'cursor')         updateRemoteCursor(data);
    else if (type === 'clear')          { state.syncing=true; state.canvas.clear(); state.syncing=false; state.canvas.renderAll(); }
    else if (type === 'full-sync-req')  broadcastFullSync();
    else if (type === 'full-sync')      receiveFullSync(data);
    else if (type === 'user-join')      onRemoteUserJoin(data);
    else if (type === 'user-leave')     onRemoteUserLeave(data);
  };

  // Announce ourselves & request existing canvas state
  state.bc.postMessage({ type: 'user-join',      data: { username: state.username, color: state.userColor, id: state.username } });
  state.bc.postMessage({ type: 'full-sync-req',  data: {} });

  setConnStatus('connected', 'Bağlandı (Yerel)');
  setStatus('BroadcastChannel hazır');
  showToast('Oda hazır — oda kodunu paylaş!');

  // ── 2. Yjs over WebSocket — best-effort, degrades gracefully ──
  try {
    if (typeof Y !== 'undefined' && typeof WebsocketProvider !== 'undefined') {
      state.ydoc     = new Y.Doc();
      state.yObjects = state.ydoc.getMap('objects');
      state.provider = new WebsocketProvider('wss://demos.yjs.dev', state.roomId, state.ydoc);

      state.provider.on('status', (event) => {
        if (event.status === 'connected') {
          setConnStatus('connected', 'Bağlandı (P2P)');
          loadFromYDoc();
        }
      });
      state.yObjects.observe(onYObjectChange);
    }
  } catch(err) {
    console.warn('Yjs init failed (non-fatal):', err);
  }
}

function broadcastFullSync() {
  // Serialize all objects and send over BroadcastChannel
  const objects = state.canvas.getObjects().map(obj => {
    const data = obj.toObject(['_id','_owner','_type','_noteId','_linkedTextId','_linkedRectId']);
    data._id             = obj._id;
    data._owner          = obj._owner;
    data._type           = obj._type;
    data._noteId         = obj._noteId;
    data._linkedTextId   = obj._linkedTextId;
    data._linkedRectId   = obj._linkedRectId;
    return data;
  });
  state.bc.postMessage({ type: 'full-sync', data: objects });
}

function receiveFullSync(objects) {
  if (!objects || !objects.length) return;
  state.syncing = true;
  state.canvas.clear();
  state.canvas.renderAll();
  state.syncing = false;

  // Add objects one by one with a tiny delay so Fabric can breathe
  objects.forEach((objData, i) => {
    setTimeout(() => deserializeAndAdd(objData, true), i * 10);
  });
  setStatus('Canvas senkronize edildi');
}

function onRemoteUserJoin(data) {
  state.peers[data.id] = data;
  updateUsersBar();
  showToast(`${data.username} odaya katıldı`);
  // Reply with our own full sync so the newcomer gets everything
  setTimeout(broadcastFullSync, 300);
}
function onRemoteUserLeave(data) {
  delete state.peers[data.id];
  removePeerCursor(data.id);
  updateUsersBar();
}

// ── Yjs Observe ──────────────────────────────────────────────
function onYObjectChange(event) {
  if (state.syncing) return;
  event.changes.keys.forEach((change, key) => {
    if (change.action === 'add' || change.action === 'update') {
      const data = state.yObjects.get(key);
      if (data) updateCanvasFromYjs(key, data);
    } else if (change.action === 'delete') {
      removeObjectById(key);
    }
  });
}
function updateCanvasFromYjs(id, data) {
  const existing = state.canvas.getObjects().find(o => o._id === id);
  if (existing) {
    state.syncing = true;
    existing.set(data);
    existing.setCoords();
    state.canvas.renderAll();
    state.syncing = false;
  } else {
    deserializeAndAdd(data, false);
  }
}
function loadFromYDoc() {
  state.yObjects.forEach((data, id) => updateCanvasFromYjs(id, data));
}

// ── Awareness / Cursors ───────────────────────────────────────
function broadcastCursor(e) {
  const rect = document.getElementById('canvas-container').getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (state.bc) {
    state.bc.postMessage({ type: 'cursor', data: {
      peerId:   state.username,
      username: state.username,
      color:    state.userColor,
      x, y,
    }});
  }
}
function updateRemoteCursor(data) {
  const { peerId, username, color, x, y } = data;
  let el = document.getElementById('cursor-' + peerId);
  if (!el) {
    el = document.createElement('div');
    el.id = 'cursor-' + peerId;
    el.className = 'remote-cursor';
    el.innerHTML = `
      <div class="cursor-icon" style="color:${color}">▸</div>
      <div class="cursor-label" style="background:${color}">${username}</div>
    `;
    document.getElementById('cursors-layer').appendChild(el);
  }
  el.style.transform = `translate(${x}px,${y}px)`;
}
function removePeerCursor(peerId) {
  const el = document.getElementById('cursor-' + peerId);
  if (el) el.remove();
}

// ── Users Bar ─────────────────────────────────────────────────
function updateUsersBar() {
  const bar = document.getElementById('users-bar');
  bar.innerHTML = '';
  const self = document.createElement('div');
  self.className = 'user-avatar';
  self.style.background = state.userColor;
  self.textContent = state.username.slice(0,2).toUpperCase();
  self.title = state.username + ' (sen)';
  bar.appendChild(self);

  Object.values(state.peers).forEach(peer => {
    const av = document.createElement('div');
    av.className = 'user-avatar';
    av.style.background = peer.color || '#888';
    av.textContent = (peer.username||'?').slice(0,2).toUpperCase();
    av.title = peer.username;
    bar.appendChild(av);
  });
}

// ── Tool Management ───────────────────────────────────────────
window.setTool = function(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>{
    b.classList.toggle('active', b.dataset.tool===tool);
  });
  const fc = state.canvas;
  fc.isDrawingMode = false;
  fc.selection     = true;
  fc.defaultCursor = 'default';
  fc.hoverCursor   = 'move';
  const fontSec = document.getElementById('font-section');

  if (tool === 'draw') {
    fc.isDrawingMode = true;
    fc.freeDrawingBrush = new fabric.PencilBrush(fc);
    fc.freeDrawingBrush.width = state.strokeWidth;
    fc.freeDrawingBrush.color = state.strokeColor;
    fontSec.style.display = 'none';
  } else if (tool === 'eraser') {
    fc.isDrawingMode = false;
    fc.selection     = false;
    fc.defaultCursor = 'cell';
    fontSec.style.display = 'none';
  } else if (tool === 'hand') {
    fc.selection     = false;
    fc.defaultCursor = 'grab';
    fc.hoverCursor   = 'grab';
    fontSec.style.display = 'none';
  } else if (tool === 'select') {
    fontSec.style.display = 'none';
  } else if (tool === 'text') {
    fc.selection     = false;
    fc.defaultCursor = 'text';
    fontSec.style.display = 'block';
  } else {
    fc.selection     = false;
    fc.defaultCursor = 'crosshair';
    fontSec.style.display = 'none';
  }
  fc.renderAll();
  setStatus('Araç: ' + tool);
};

// ── Mouse Events ──────────────────────────────────────────────
function onMouseDown(opt) {
  const e = opt.e;
  const fc = state.canvas;
  const pointer = fc.getPointer(e);

  if (state.tool === 'hand') {
    state.isPanning    = true;
    state.lastPanPoint = { x: e.clientX, y: e.clientY };
    fc.defaultCursor   = 'grabbing';
    return;
  }
  if (state.tool === 'select' || state.tool === 'draw') return;
  if (state.tool === 'eraser') {
    const target = fc.findTarget(e);
    if (target) removeObject(target);
    return;
  }
  if (state.tool === 'sticky') {
    addStickyNote(pointer.x, pointer.y);
    return;
  }
  if (state.tool === 'text') {
    state.isDrawing  = true;
    state.drawStart  = { x: pointer.x, y: pointer.y };
    const textbox = new fabric.Textbox('Yazı...', {
      left: pointer.x, top: pointer.y, width: 200,
      fontSize: state.fontSize, fontFamily: 'DM Sans, sans-serif',
      fill: state.strokeColor, opacity: state.opacity,
      selectable: true, editable: true, splitByGrapheme: true,
    });
    textbox.on('editing:exited', () => { if (textbox._id) syncModify(textbox); });
    state.activeShape = textbox;
    state.canvas.add(textbox);
    return;
  }

  state.isDrawing = true;
  state.drawStart = { x: pointer.x, y: pointer.y };

  if (state.tool === 'rect') {
    state.activeShape = new fabric.Rect({
      left: pointer.x, top: pointer.y, width: 1, height: 1,
      stroke: state.strokeColor, strokeWidth: state.strokeWidth,
      fill: state.fillColor === 'transparent' ? 'transparent' : state.fillColor,
      opacity: state.opacity, selectable: false,
    });
    fc.add(state.activeShape);
  } else if (state.tool === 'circle') {
    state.activeShape = new fabric.Ellipse({
      left: pointer.x, top: pointer.y, rx: 1, ry: 1,
      stroke: state.strokeColor, strokeWidth: state.strokeWidth,
      fill: state.fillColor === 'transparent' ? 'transparent' : state.fillColor,
      opacity: state.opacity, selectable: false,
    });
    fc.add(state.activeShape);
  } else if (state.tool === 'arrow') {
    state.activeShape = new fabric.Line(
      [pointer.x, pointer.y, pointer.x, pointer.y],
      { stroke: state.strokeColor, strokeWidth: state.strokeWidth, opacity: state.opacity, selectable: false }
    );
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
    state.panX += dx; state.panY += dy;
    state.lastPanPoint = { x: e.clientX, y: e.clientY };
    const vpt = fc.viewportTransform.slice();
    vpt[4] += dx; vpt[5] += dy;
    fc.setViewportTransform(vpt);
    fc.renderAll();
    return;
  }
  if (!state.isDrawing || !state.activeShape || !state.drawStart) return;

  const dx = pointer.x - state.drawStart.x;
  const dy = pointer.y - state.drawStart.y;

  if (state.tool === 'rect') {
    state.activeShape.set({
      left: dx<0 ? pointer.x : state.drawStart.x,
      top:  dy<0 ? pointer.y : state.drawStart.y,
      width: Math.abs(dx), height: Math.abs(dy),
    });
  } else if (state.tool === 'circle') {
    state.activeShape.set({
      rx: Math.abs(dx)/2, ry: Math.abs(dy)/2,
      left: dx<0 ? pointer.x : state.drawStart.x,
      top:  dy<0 ? pointer.y : state.drawStart.y,
    });
  } else if (state.tool === 'arrow') {
    state.activeShape.set({ x2: pointer.x, y2: pointer.y });
  } else if (state.tool === 'text') {
    state.activeShape.set({
      left: pointer.x < state.drawStart.x ? pointer.x : state.drawStart.x,
      width: Math.max(40, Math.abs(dx)),
    });
  }
  fc.renderAll();
}

function onMouseUp() {
  if (state.isPanning) {
    state.isPanning    = false;
    state.canvas.defaultCursor = 'grab';
  }
  if (state.isDrawing && state.activeShape) {
    const obj = state.activeShape;
    obj.set({ selectable: true });
    obj._id    = uid();
    obj._owner = state.username;

    if (state.tool === 'text') {
      state.canvas.setActiveObject(obj);
      state.canvas.renderAll();
      obj.enterEditing();
      obj.selectAll();
      syncAdd(obj);
      setStatus('Metin kutusu eklendi');
    } else {
      if (state.tool === 'arrow') addArrowhead(obj);
      state.canvas.renderAll();
      syncAdd(obj);
      setStatus('Nesne eklendi');
    }
  }
  state.isDrawing   = false;
  state.activeShape = null;
  state.drawStart   = null;
}

function onPathCreated(opt) {
  const path = opt.path;
  path._id    = uid();
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
  syncModify(obj);
}

function onObjectRemoved(opt) {
  if (state.syncing) return;
  const obj = opt.target;
  if (!obj._id) return;
  syncRemove(obj._id);
}

function onSelection(opt) {
  const active = state.canvas.getActiveObject();
  if (!active) return;
  if (active.stroke) updateColorUI(active.stroke);
}

function onObjectMoving(opt) {
  const obj = opt.target;
  if (!obj) return;
  if (obj._type === 'sticky-bg') moveStickyTextWithRect(obj);
}

function onTextChanged(opt) {
  const obj = opt.target;
  if (!obj) return;
  if (obj._type === 'sticky-text') {
    const rect = getObjectById(obj._linkedRectId);
    if (!rect) return;
    const PAD = 12;
    obj.set({ width: Math.max(40, rect.width - PAD*2), left: rect.left+PAD, top: rect.top+PAD });
    obj.setCoords();
    const neededHeight = obj.height + PAD*2;
    if (neededHeight > rect.height) { rect.set({ height: neededHeight }); rect.setCoords(); }
    state.canvas.renderAll();
    syncModify(obj);
    syncModify(rect);
  }
}

// ── Sticky Notes ──────────────────────────────────────────────
function addStickyNote(x, y) {
  const colors = ['#fff9c4','#ffecd2','#e8f5e9','#e3f2fd','#f3e5f5'];
  const bg = colors[Math.floor(Math.random()*colors.length)];
  const W=180, H=140, PAD=12;
  const noteId = uid();

  const rect = new fabric.Rect({
    left: x, top: y, width: W, height: H,
    fill: bg, stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1,
    rx: 6, ry: 6,
    shadow: new fabric.Shadow({ color:'rgba(0,0,0,0.18)', blur:8, offsetX:2, offsetY:2 }),
    selectable: true, hasControls: true, lockUniScaling: false,
  });
  const text = new fabric.Textbox('Not yaz...', {
    left: x+PAD, top: y+PAD, width: W-PAD*2,
    fontSize: 14, lineHeight: 1.2, fontFamily:'DM Sans, sans-serif',
    fill:'#333', editable:true, selectable:true, splitByGrapheme:true,
  });

  rect._id = noteId+'-bg';   rect._noteId = noteId; rect._type='sticky-bg';   rect._owner=state.username;
  text._id = noteId+'-text'; text._noteId = noteId; text._type='sticky-text'; text._owner=state.username;
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

// ── Arrow Helpers ─────────────────────────────────────────────
function addArrowhead(line) {
  const { x1, y1, x2, y2 } = line;
  const angle = Math.atan2(y2-y1, x2-x1)*180/Math.PI;
  const headLen = Math.min(20, line.strokeWidth*5+10);
  const triangle = new fabric.Triangle({
    left: x2, top: y2, width: headLen, height: headLen,
    fill: line.stroke, angle: angle+90,
    originX:'center', originY:'center', selectable:false,
  });
  triangle._id    = uid();
  triangle._owner = state.username;
  state.canvas.add(triangle);
  syncAdd(triangle);
}

// ── Object Management ─────────────────────────────────────────
function removeObject(obj) {
  if (!obj) return;
  if (obj._type === 'sticky-bg') {
    const text = getObjectById(obj._linkedTextId);
    if (text) { state.canvas.remove(text); if (text._id) syncRemove(text._id); }
  }
  if (obj._type === 'sticky-text') {
    const rect = getObjectById(obj._linkedRectId);
    if (rect) { state.canvas.remove(rect); if (rect._id) syncRemove(rect._id); }
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
  if (obj) { state.canvas.bringForward(obj); state.canvas.renderAll(); }
};
window.sendBackward = function() {
  const obj = state.canvas.getActiveObject();
  if (obj) { state.canvas.sendBackwards(obj); state.canvas.renderAll(); }
};
window.clearCanvas = function() {
  if (!confirm('Tuvali temizlemek istediğinizden emin misiniz?')) return;
  state.syncing = true;
  state.canvas.clear();
  state.syncing = false;
  state.canvas.renderAll();
  if (state.ydoc) {
    state.ydoc.transact(()=>{ state.yObjects.forEach((v,k)=>state.yObjects.delete(k)); });
  }
  if (state.bc) state.bc.postMessage({ type:'clear', data:{} });
  setStatus('Tuval temizlendi');
};

// ── Serialization & Sync ──────────────────────────────────────
const CUSTOM_PROPS = ['_id','_owner','_type','_noteId','_linkedTextId','_linkedRectId'];

function syncAdd(obj) {
  if (state.syncing) return;
  const data = obj.toObject(CUSTOM_PROPS);
  // Ensure custom props are on the top-level data object
  CUSTOM_PROPS.forEach(p => { if (obj[p] !== undefined) data[p] = obj[p]; });

  if (state.bc) state.bc.postMessage({ type:'object:add', data });
  if (state.yObjects && obj._id) {
    state.ydoc.transact(()=>{ state.yObjects.set(obj._id, data); });
  }
}

function syncModify(obj) {
  if (state.syncing) return;
  const data = obj.toObject(CUSTOM_PROPS);
  CUSTOM_PROPS.forEach(p => { if (obj[p] !== undefined) data[p] = obj[p]; });

  if (state.bc) state.bc.postMessage({ type:'object:modify', data });
  if (state.yObjects && obj._id) {
    state.ydoc.transact(()=>{ state.yObjects.set(obj._id, data); });
  }
  setStatus('Değişiklik senkronize edildi');
}

function syncRemove(id) {
  if (state.bc) state.bc.postMessage({ type:'object:remove', data:{ _id:id } });
  if (state.yObjects) {
    state.ydoc.transact(()=>{ state.yObjects.delete(id); });
  }
}

function addObjectFromRemote(data) {
  if (!data || !data._id) return;
  const exists = state.canvas.getObjects().find(o => o._id === data._id);
  if (exists) return; // already have it
  state.syncing = true;
  deserializeAndAdd(data, true);
  state.syncing = false;
}

function modifyObjectFromRemote(data) {
  if (!data || !data._id) return;
  const existing = state.canvas.getObjects().find(o => o._id === data._id);
  if (existing) {
    state.syncing = true;
    existing.set(data);
    // Restore custom props that fabric.set() doesn't restore
    CUSTOM_PROPS.forEach(p => { if (data[p] !== undefined) existing[p] = data[p]; });
    existing.setCoords();
    state.canvas.renderAll();
    state.syncing = false;
  } else {
    addObjectFromRemote(data);
  }
}

function removeObjectById(id) {
  const obj = state.canvas.getObjects().find(o => o._id === id);
  if (obj) {
    state.syncing = true;
    state.canvas.remove(obj);
    state.canvas.renderAll();
    state.syncing = false;
  }
}

/**
 * deserializeAndAdd — robustly recreates a Fabric object from plain data.
 * Uses fabric.util.enlivenObjects and manually restores custom properties.
 */
function deserializeAndAdd(data, fromRemote) {
  if (!data || !data.type) return;

  // Fabric 5.x: enlivenObjects signature is (objects, callback, namespace, reviver)
  fabric.util.enlivenObjects([data], (objects) => {
    objects.forEach(obj => {
      // Restore custom properties (enlivenObjects drops unknown props)
      CUSTOM_PROPS.forEach(p => { if (data[p] !== undefined) obj[p] = data[p]; });

      // Avoid duplicates
      if (state.canvas.getObjects().find(o => o._id === obj._id)) return;

      state.canvas.add(obj);
    });
    state.canvas.renderAll();
  }, 'fabric');
}

// ── Property Controls ─────────────────────────────────────────
window.setStrokeColor = function(el) {
  document.querySelectorAll('#stroke-colors .cp-swatch').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  state.strokeColor = el.dataset.color;
  if (state.tool==='draw') state.canvas.freeDrawingBrush.color = state.strokeColor;
  applyToSelected({ stroke: state.strokeColor });
};
window.setFillColor = function(el) {
  document.querySelectorAll('#fill-colors .cp-swatch').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  state.fillColor = el.dataset.color;
  applyToSelected({ fill: state.fillColor==='transparent' ? 'transparent' : state.fillColor });
};
window.setCustomColor = function(val) {
  state.strokeColor = val;
  if (state.tool==='draw') state.canvas.freeDrawingBrush.color = val;
  applyToSelected({ stroke: val });
};
window.setStrokeWidth = function(val) {
  state.strokeWidth = parseInt(val);
  document.getElementById('stroke-width-val').textContent = val+'px';
  if (state.tool==='draw') state.canvas.freeDrawingBrush.width = state.strokeWidth;
  applyToSelected({ strokeWidth: state.strokeWidth });
};
window.setOpacity = function(val) {
  state.opacity = parseFloat(val);
  document.getElementById('opacity-val').textContent = Math.round(val*100)+'%';
  applyToSelected({ opacity: state.opacity });
};
window.setFontSize = function(val) {
  state.fontSize = parseInt(val);
  document.getElementById('font-size-val').textContent = val+'px';
  applyToSelected({ fontSize: state.fontSize });
};
function applyToSelected(props) {
  const active = state.canvas.getActiveObject();
  if (!active) return;
  active.set(props);
  state.canvas.renderAll();
  if (active._id) syncModify(active);
}
function updateColorUI(color) {}

// ── Zoom ──────────────────────────────────────────────────────
window.zoom = function(delta) {
  state.zoom = Math.max(0.1, Math.min(5, state.zoom+delta));
  const fc = state.canvas;
  const center = fc.getCenter();
  fc.zoomToPoint({ x:center.left, y:center.top }, state.zoom);
  document.getElementById('zoom-label').textContent = Math.round(state.zoom*100)+'%';
};
window.resetZoom = function() {
  state.zoom = 1;
  state.canvas.setViewportTransform([1,0,0,1,0,0]);
  document.getElementById('zoom-label').textContent = '100%';
};
document.addEventListener('wheel', (e) => {
  if (!state.canvas) return;
  e.preventDefault();
  const delta = e.deltaY>0 ? -0.05 : 0.05;
  state.zoom = Math.max(0.1, Math.min(5, state.zoom+delta));
  state.canvas.zoomToPoint({ x:e.offsetX, y:e.offsetY }, state.zoom);
  document.getElementById('zoom-label').textContent = Math.round(state.zoom*100)+'%';
}, { passive:false });

// ── Export ────────────────────────────────────────────────────
window.exportPNG = function() {
  const dataURL = state.canvas.toDataURL({ format:'png', multiplier:2 });
  const a = document.createElement('a');
  a.href = dataURL; a.download = 'diro-'+currentRoomCode+'.png'; a.click();
  showToast('PNG indiriliyor...');
};

// ── Keyboard Shortcuts ────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    if (e.target.isContentEditable) return;
    const key = e.key.toLowerCase();
    if      (key==='v') setTool('select');
    else if (key==='h') setTool('hand');
    else if (key==='t') setTool('text');
    else if (key==='n') setTool('sticky');
    else if (key==='r') setTool('rect');
    else if (key==='c') setTool('circle');
    else if (key==='a') setTool('arrow');
    else if (key==='d') setTool('draw');
    else if (key==='e') setTool('eraser');
    else if (key==='delete'||key==='backspace') deleteSelected();
    else if (e.ctrlKey&&key==='z') {
      const objs = state.canvas.getObjects();
      if (objs.length) removeObject(objs[objs.length-1]);
    }
    else if (e.ctrlKey&&key==='+') zoom(0.1);
    else if (e.ctrlKey&&key==='-') zoom(-0.1);
    else if (e.ctrlKey&&key==='0') resetZoom();
  });
}

// ── CSS animation ─────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
@keyframes toastIn {
  from { opacity:0; transform:translateX(-50%) translateY(10px); }
  to   { opacity:1; transform:translateX(-50%) translateY(0); }
}
.remote-cursor { position:absolute; pointer-events:none; display:flex; align-items:center; gap:4px; }
.cursor-label  { font-size:11px; padding:2px 6px; border-radius:4px; color:#fff; white-space:nowrap; }
`;
document.head.appendChild(style);