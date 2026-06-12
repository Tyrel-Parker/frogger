const DEBUG_HITBOXES = true;
let debugPaused = false;

// ─── ON-SCREEN ERROR LOG ─────────────────────────────────────────────────────
const errorLog = document.getElementById('error-log');
function logError(msg) {
  errorLog.style.display = 'block';
  errorLog.textContent += msg + '\n';
}
window.addEventListener('error', e => logError('ERR: ' + e.message + ' (' + e.lineno + ')'));
window.addEventListener('unhandledrejection', e => logError('REJ: ' + e.reason));

// ─── LAYOUT ───────────────────────────────────────────────────────────────────
const COLS = 14;
const ROWS = 14; // 1 safe bottom, 5 road, 1 median, 5 river, 1 home, 1 score-strip
const CELL = 40;

// Row types (top to bottom, row 0 = home pads, row 13 = frog start)
// 0: home
// 1-5: river (logs/turtles)
// 6: median (safe)
// 7-11: road (cars)
// 12: safe zone (frog start)
// We also draw a top border row above row 0, so canvas is 14 rows tall

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
canvas.width  = COLS * CELL;
canvas.height = ROWS * CELL;

function resizeCanvas() {
  const maxW = window.innerWidth - 16;
  const maxH = window.innerHeight - 110;
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
  canvas.style.width  = (canvas.width  * scale) + 'px';
  canvas.style.height = (canvas.height * scale) + 'px';
}
window.addEventListener('resize', resizeCanvas);

// ─── LANE DEFINITIONS ────────────────────────────────────────────────────────
// Each lane: { row, type: 'car'|'log'|'turtle', dir: 1|-1, speed, objects[] }
// objects: { x (left edge in cells), w (width in cells), diving? }

function makeLanes() {
  return [
    // River rows 1-5 (row 1 = just below home)
    { row: 1, type: 'log',    dir:  1, speed: 0.018, objects: makeLogs(3, 3) },
    { row: 2, type: 'turtle', dir: -1, speed: 0.022, objects: makeTurtles(3, 2) },
    { row: 3, type: 'log',    dir:  1, speed: 0.030, objects: makeLogs(2, 4) },
    { row: 4, type: 'turtle', dir: -1, speed: 0.025, objects: makeTurtles(4, 2) },
    { row: 5, type: 'log',    dir:  1, speed: 0.020, objects: makeLogs(3, 3) },
    // Road rows 7-11
    { row: 7,  type: 'car', dir: -1, speed: 0.035, objects: makeCars(3, 2) },
    { row: 8,  type: 'car', dir:  1, speed: 0.028, objects: makeCars(4, 1) },
    { row: 9,  type: 'car', dir: -1, speed: 0.045, objects: makeCars(2, 2) },
    { row: 10, type: 'car', dir:  1, speed: 0.032, objects: makeCars(3, 1) },
    { row: 11, type: 'car', dir: -1, speed: 0.025, objects: makeCars(4, 2) },
  ];
}

function makeLogs(count, w) {
  const spacing = COLS / count;
  return Array.from({ length: count }, (_, i) => ({ x: i * spacing, w }));
}

function makeTurtles(count, groupSize) {
  const spacing = COLS / count;
  return Array.from({ length: count }, (_, i) => ({
    x: i * spacing, w: groupSize,
    diveTimer: Math.floor(Math.random() * 300) + 100,
    diveState: 'up', // 'up' | 'diving' | 'under' | 'rising'
    diveFrame: 0,
  }));
}

function makeCars(count, w) {
  const spacing = COLS / count;
  return Array.from({ length: count }, (_, i) => ({ x: i * spacing, w }));
}

// ─── HOME PADS ───────────────────────────────────────────────────────────────
// 5 pads at columns 1, 3, 5, 9, 11 (0-indexed, each 2 cells wide centering in col)
const PAD_COLS = [1, 3, 7, 9, 11]; // center columns of each pad
let homePads = [false, false, false, false, false]; // filled?

// ─── FROG ────────────────────────────────────────────────────────────────────
const FROG_START = { col: 6.5, row: 12 };
const frog = { col: 6.5, row: 12, dead: false, deathFrame: 0, rideVel: 0 };

function resetFrog() {
  frog.col = FROG_START.col;
  frog.row = FROG_START.row;
  frog.dead = false;
  frog.deathFrame = 0;
  frog.rideVel = 0;
}

// ─── GAME STATE ──────────────────────────────────────────────────────────────
let score, lives, level, gameState, lanes, timeLeft, timeMax;
let floatingScores = [];
let helpOpen = false;
let leaderboard = JSON.parse(localStorage.getItem('frogger-leaderboard') || '[]');
let lastScore = 0;
// gameState: 'highscore' | 'nameentry' | 'playing' | 'dying' | 'levelclear' | 'gameover'

const TIME_PER_LEVEL = 60 * 60; // 60 seconds at 60fps

function initGame() {
  score = 0;
  lives = 3;
  level = 1;
  gameState = 'highscore';
  floatingScores = [];
  homePads = [false, false, false, false, false];
  lanes = makeLanes();
  timeLeft = TIME_PER_LEVEL;
  timeMax = TIME_PER_LEVEL;
  resetFrog();
  updateHUD();
  setMessage('');
}

function startLevel() {
  gameState = 'playing';
  setMessage('');
  floatingScores = [];
  homePads = [false, false, false, false, false];
  lanes = makeLanes();
  // Speed up each level
  lanes.forEach(l => { l.speed *= (1 + (level - 1) * 0.1); });
  timeLeft = TIME_PER_LEVEL;
  timeMax = TIME_PER_LEVEL;
  resetFrog();
}

function handleStart() {
  if (gameState === 'highscore') {
    initGame();
    startLevel();
  } else if (gameState === 'nameentry') {
    advanceNameCursor(1);
  } else if (gameState === 'dying') {
    if (lives > 0) { resetFrog(); gameState = 'playing'; setMessage(''); }
  } else if (gameState === 'levelclear') {
    level++;
    startLevel();
  }
}

// ─── CONTROLS ────────────────────────────────────────────────────────────────
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let controlMode = isMobile ? 'swipe' : 'keys';
let pendingMove = null; // { dc, dr } grid step

const modeBtn = document.getElementById('mode-btn');
const helpBtn = document.getElementById('help-btn');
const helpOverlay = document.getElementById('help-overlay');
const helpModeHintBtn = document.getElementById('mode-hint-btn');

let swipeStart = null;
document.addEventListener('touchstart', e => {
  if (helpOverlay.contains(e.target)) return;
  e.preventDefault();
  swipeStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: false });

document.addEventListener('touchend', e => {
  if (helpOverlay.contains(e.target)) return;
  e.preventDefault();
  if (helpOpen) return;
  if (!swipeStart) return;
  const dx = e.changedTouches[0].clientX - swipeStart.x;
  const dy = e.changedTouches[0].clientY - swipeStart.y;
  swipeStart = null;

  if (gameState === 'nameentry') {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { advanceNameCursor(1); }
    else if (Math.abs(dy) > Math.abs(dx)) { cycleNameChar(dy > 0 ? 1 : -1); }
    else { advanceNameCursor(dx > 0 ? 1 : -1); }
    return;
  }

  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { if (debugPaused) { debugPaused = false; return; } handleStart(); return; }
  if (controlMode !== 'swipe') return;

  if (Math.abs(dx) > Math.abs(dy)) {
    pendingMove = dx > 0 ? { dc: 1, dr: 0 } : { dc: -1, dr: 0 };
  } else {
    pendingMove = dy > 0 ? { dc: 0, dr: 1 } : { dc: 0, dr: -1 };
  }
}, { passive: false });

document.addEventListener('keydown', e => {
  if (helpOpen) {
    if (e.code === 'Escape') { closeHelp(); e.preventDefault(); }
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); if (debugPaused) { debugPaused = false; return; } handleStart(); return; }
  if (gameState === 'nameentry') {
    e.preventDefault();
    if (e.code === 'ArrowUp'    || e.code === 'KeyW') cycleNameChar(-1);
    if (e.code === 'ArrowDown'  || e.code === 'KeyS') cycleNameChar(1);
    if (e.code === 'ArrowLeft'  || e.code === 'KeyA') advanceNameCursor(-1);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') advanceNameCursor(1);
    if (e.code === 'Enter') confirmName();
    return;
  }
  if (controlMode !== 'keys') return;
  const moves = {
    ArrowLeft: { dc: -1, dr: 0 }, KeyA: { dc: -1, dr: 0 },
    ArrowRight: { dc: 1, dr: 0 }, KeyD: { dc: 1, dr: 0 },
    ArrowUp: { dc: 0, dr: -1 }, KeyW: { dc: 0, dr: -1 },
    ArrowDown: { dc: 0, dr: 1 }, KeyS: { dc: 0, dr: 1 },
  };
  if (moves[e.code]) { pendingMove = moves[e.code]; e.preventDefault(); }
});

// Tilt
let tiltPermissionGranted = false;
let tiltEventReceived = false, tiltCheckTimer = null;
const tiltIndicator = document.getElementById('tilt-indicator');
let lastTiltMove = 0;

async function requestTiltPermission() {
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { return (await DeviceOrientationEvent.requestPermission()) === 'granted'; }
    catch { return false; }
  }
  return true;
}

function handleOrientation(e) {
  if (controlMode !== 'tilt') return;
  tiltEventReceived = true;
  const beta = e.beta ?? 0, gamma = e.gamma ?? 0;
  tiltIndicator.textContent = `b${beta.toFixed(0)} g${gamma.toFixed(0)}`;
  if (gameState !== 'playing') return;
  const now = Date.now();
  if (now - lastTiltMove < 400) return;
  const THRESH = 15;
  if (Math.abs(gamma) > Math.abs(beta)) {
    if (gamma >  THRESH) { pendingMove = { dc: 1, dr: 0 };  lastTiltMove = now; }
    if (gamma < -THRESH) { pendingMove = { dc: -1, dr: 0 }; lastTiltMove = now; }
  } else {
    if (beta >  THRESH) { pendingMove = { dc: 0, dr: 1 };  lastTiltMove = now; }
    if (beta < -THRESH) { pendingMove = { dc: 0, dr: -1 }; lastTiltMove = now; }
  }
}
window.addEventListener('deviceorientation', handleOrientation);
window.addEventListener('deviceorientationabsolute', handleOrientation);

const MODES = ['keys', 'swipe', 'tilt'];
const MODE_LABELS = { keys: '⌨ KEYS', swipe: '👆 SWIPE', tilt: '📱 TILT' };
modeBtn.textContent = MODE_LABELS[controlMode];

modeBtn.addEventListener('click', async () => {
  const next = MODES[(MODES.indexOf(controlMode) + 1) % MODES.length];
  if (next === 'tilt' && !tiltPermissionGranted) {
    tiltPermissionGranted = await requestTiltPermission();
    if (!tiltPermissionGranted) { setMessage('TILT NOT AVAILABLE'); return; }
  }
  controlMode = next;
  modeBtn.textContent = MODE_LABELS[controlMode];
  modeBtn.classList.toggle('tilt-active', controlMode === 'tilt');
  tiltIndicator.textContent = controlMode === 'tilt' ? 'TILT ACTIVE' : '';
  clearTimeout(tiltCheckTimer);
  if (controlMode === 'tilt') {
    tiltEventReceived = false;
    tiltCheckTimer = setTimeout(() => {
      if (controlMode === 'tilt' && !tiltEventReceived)
        tiltIndicator.textContent = 'TILT BLOCKED - CHECK BROWSER SETTINGS';
    }, 2000);
  }
});

// ─── HELP MODAL ──────────────────────────────────────────────────────────────
function openHelp() {
  helpOpen = true;
  helpModeHintBtn.textContent = modeBtn.textContent;
  modeBtn.classList.add('help-highlight');
  helpOverlay.classList.add('open');
}
function closeHelp() {
  helpOpen = false;
  modeBtn.classList.remove('help-highlight');
  helpOverlay.classList.remove('open');
}
helpBtn.addEventListener('click', openHelp);
document.getElementById('help-close').addEventListener('click', closeHelp);
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) closeHelp(); });

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
let nameChars = ['A','A','A'], nameCursor = 0;

function saveLeaderboard() { localStorage.setItem('frogger-leaderboard', JSON.stringify(leaderboard)); }
function qualifiesForLeaderboard(s) {
  return s > 0 && (leaderboard.length < 10 || s > leaderboard[leaderboard.length - 1].score);
}
function addToLeaderboard(name, s) {
  leaderboard.push({ name, score: s });
  leaderboard.sort((a, b) => b.score - a.score);
  if (leaderboard.length > 10) leaderboard.length = 10;
  saveLeaderboard();
}
function cycleNameChar(dir) {
  const i = NAME_CHARS.indexOf(nameChars[nameCursor]);
  nameChars[nameCursor] = NAME_CHARS[(i + dir + NAME_CHARS.length) % NAME_CHARS.length];
}
function advanceNameCursor(dir) {
  if (dir > 0 && nameCursor === 2) { confirmName(); return; }
  nameCursor = Math.max(0, Math.min(2, nameCursor + dir));
}
function confirmName() {
  const name = nameChars.join('').trimEnd() || '???';
  localStorage.setItem('frogger-last-name', name);
  addToLeaderboard(name, lastScore);
  gameState = 'highscore';
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function setMessage(t) { document.getElementById('message').textContent = t; }
function updateHUD() {
  document.getElementById('score-val').textContent = score;
  document.getElementById('lives-val').textContent = lives;
}

function showFloatingScore(pts, col, row) {
  floatingScores.push({ col, row, pts, timer: 80 });
}

// ─── FROG MOVEMENT ───────────────────────────────────────────────────────────
let frogFacing = 'up'; // for drawing

function moveFrog(dc, dr) {
  if (frog.dead) return;
  const nc = frog.col + dc;
  const nr = frog.row + dr;
  if (nc < 0 || nc >= COLS) return;
  if (nr < 0 || nr > 12) return;
  frog.col = nc;
  frog.row = nr;
  if (dr < 0) frogFacing = 'up';
  else if (dr > 0) frogFacing = 'down';
  else if (dc < 0) frogFacing = 'left';
  else frogFacing = 'right';

  if (dr < 0) { score += 10; updateHUD(); } // reward forward hops
}

// ─── UPDATE LANES ────────────────────────────────────────────────────────────
function updateLanes() {
  lanes.forEach(lane => {
    lane.objects.forEach(obj => {
      obj.x += lane.dir * lane.speed;
      // wrap around
      if (lane.dir > 0 && obj.x > COLS) obj.x -= COLS + obj.w + 1;
      if (lane.dir < 0 && obj.x < -(obj.w + 1)) obj.x += COLS + obj.w + 1;

      // turtle diving logic
      if (lane.type === 'turtle') {
        obj.diveTimer--;
        if (obj.diveTimer <= 0) {
          if (obj.diveState === 'up') {
            obj.diveState = 'diving'; obj.diveFrame = 0; obj.diveTimer = 40;
          } else if (obj.diveState === 'diving') {
            obj.diveState = 'under'; obj.diveFrame = 0; obj.diveTimer = 80;
          } else if (obj.diveState === 'under') {
            obj.diveState = 'rising'; obj.diveFrame = 0; obj.diveTimer = 40;
          } else {
            obj.diveState = 'up'; obj.diveFrame = 0;
            obj.diveTimer = Math.floor(Math.random() * 300) + 150;
          }
        }
        if (obj.diveState !== 'up') obj.diveFrame++;
      }
    });
  });
}

// ─── COLLISION & RIDE ────────────────────────────────────────────────────────
function getLaneAt(row) { return lanes.find(l => l.row === row) || null; }

function frogOnPlatform() {
  const row = frog.row;
  if (row < 1 || row > 5) return null; // not in river zone
  const lane = getLaneAt(row);
  if (!lane) return null;
  for (const obj of lane.objects) {
    if (lane.type === 'turtle' && obj.diveState === 'under') continue; // submerged
    if (frog.col >= obj.x - 0.5 && frog.col < obj.x + obj.w - 0.5) return lane;
  }
  return null;
}

function frogHitByCar() {
  const row = frog.row;
  if (row < 7 || row > 11) return false;
  const lane = getLaneAt(row);
  if (!lane) return false;
  const fc = frog.col + 0.5; // visual center matches drawFrog: frog.col * CELL + CELL/2
  for (const obj of lane.objects) {
    if (fc + 0.25 > obj.x + 0.1 && fc - 0.25 < obj.x + obj.w - 0.1) return true;
  }
  return false;
}

function getRideVelocity() {
  const row = frog.row;
  if (row < 1 || row > 5) return 0;
  const lane = getLaneAt(row);
  return lane ? lane.dir * lane.speed : 0;
}

function checkHomePad() {
  if (frog.row !== 0) return false;
  for (let i = 0; i < PAD_COLS.length; i++) {
    if (!homePads[i] && Math.abs(frog.col - PAD_COLS[i]) < 1.0) {
      return i;
    }
    // already filled
    if (homePads[i] && Math.abs(frog.col - PAD_COLS[i]) < 1.0) return -2; // occupied
  }
  return -1; // missed
}

function killFrog(reason) {
  if (frog.dead) return;
  if (DEBUG_HITBOXES) debugPaused = true;
  frog.dead = true;
  frog.deathFrame = 0;
  lives--;
  updateHUD();
  gameState = 'dying';
  setTimeout(() => {
    if (lives <= 0) {
      lastScore = score;
      gameState = 'gameover';
      setMessage('GAME OVER');
      setTimeout(() => {
        setMessage('');
        if (qualifiesForLeaderboard(lastScore)) {
          const saved = localStorage.getItem('frogger-last-name') || 'AAA';
          nameChars = saved.padEnd(3, ' ').slice(0, 3).split('');
          nameCursor = 0;
          gameState = 'nameentry';
        } else {
          gameState = 'highscore';
        }
      }, 2000);
    } else {
      setMessage(isMobile ? 'TAP TO CONTINUE' : 'PRESS SPACE TO CONTINUE');
    }
  }, 1000);
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────
function update() {
  updateLanes();

  if (pendingMove) {
    moveFrog(pendingMove.dc, pendingMove.dr);
    pendingMove = null;
  }

  // Apply ride velocity
  if (frog.row >= 1 && frog.row <= 5 && !frog.dead) {
    frog.col += getRideVelocity();
  }

  if (!frog.dead && gameState === 'playing') {
    // Timer
    timeLeft--;
    if (timeLeft <= 0) { killFrog('time'); return; }

    // Fell off screen while riding
    if ((frog.row >= 1 && frog.row <= 5) && (frog.col < -0.5 || frog.col > COLS - 0.5)) {
      killFrog('offscreen'); return;
    }

    // River check
    if (frog.row >= 1 && frog.row <= 5) {
      if (!frogOnPlatform()) { killFrog('drown'); return; }
    }

    // Car check
    if (frogHitByCar()) { killFrog('car'); return; }

    // Home pad check
    if (frog.row === 0) {
      const padIdx = checkHomePad();
      if (padIdx >= 0) {
        homePads[padIdx] = true;
        const timeBonus = Math.floor(timeLeft / 6);
        const pts = 50 + timeBonus;
        score += pts;
        updateHUD();
        showFloatingScore(pts, frog.col, frog.row);
        if (homePads.every(p => p)) {
          // All pads filled — level clear
          score += 1000;
          updateHUD();
          gameState = 'levelclear';
          setMessage(isMobile ? 'LEVEL CLEAR! TAP TO CONTINUE' : 'LEVEL CLEAR! PRESS SPACE');
        } else {
          resetFrog();
        }
      } else if (padIdx === -1 || padIdx === -2) {
        // Hit edge/water/occupied
        killFrog('home');
      }
    }
  }

  // Death animation tick
  if (frog.dead) frog.deathFrame++;

  floatingScores = floatingScores.filter(s => --s.timer > 0);
}

// ─── DRAW ────────────────────────────────────────────────────────────────────
function drawBackground() {
  // Home row
  ctx.fillStyle = '#1a1a00';
  ctx.fillRect(0, 0, canvas.width, CELL);

  // River rows 1-5
  ctx.fillStyle = '#000055';
  ctx.fillRect(0, CELL, canvas.width, CELL * 5);

  // Median row 6
  ctx.fillStyle = '#1a3300';
  ctx.fillRect(0, CELL * 6, canvas.width, CELL);

  // Road rows 7-11
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, CELL * 7, canvas.width, CELL * 5);
  // Road lines
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.setLineDash([20, 20]);
  for (let r = 7; r < 12; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * CELL + CELL / 2);
    ctx.lineTo(canvas.width, r * CELL + CELL / 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Safe zone row 12
  ctx.fillStyle = '#1a3300';
  ctx.fillRect(0, CELL * 12, canvas.width, CELL);

  // Row 13 (frog launch pad area - just below safe zone, invisible since we only have 14 rows)
}

function drawHomePads() {
  for (let i = 0; i < PAD_COLS.length; i++) {
    const cx = PAD_COLS[i] * CELL + CELL / 2;
    const cy = CELL / 2;
    // Lily pad base
    ctx.fillStyle = homePads[i] ? '#00AA00' : '#005500';
    ctx.shadowColor = homePads[i] ? '#00FF44' : '#007700';
    ctx.shadowBlur = homePads[i] ? 12 : 4;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Draw frog silhouette if filled
    if (homePads[i]) {
      ctx.fillStyle = '#00FF44';
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLanes() {
  lanes.forEach(lane => {
    lane.objects.forEach(obj => {
      const x = obj.x * CELL;
      const y = lane.row * CELL;

      if (lane.type === 'log') {
        ctx.fillStyle = '#8B4513';
        ctx.shadowColor = '#A0522D';
        ctx.shadowBlur = 4;
        ctx.fillRect(x + 2, y + 4, obj.w * CELL - 4, CELL - 8);
        // Wood grain
        ctx.strokeStyle = '#6B3410';
        ctx.lineWidth = 1;
        for (let i = 1; i < obj.w; i++) {
          ctx.beginPath();
          ctx.moveTo(x + i * CELL, y + 6);
          ctx.lineTo(x + i * CELL, y + CELL - 6);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;

      } else if (lane.type === 'turtle') {
        const alpha = obj.diveState === 'under' ? 0 :
                      obj.diveState === 'diving' ? 1 - obj.diveFrame / 40 :
                      obj.diveState === 'rising' ? obj.diveFrame / 40 : 1;
        ctx.globalAlpha = alpha;
        for (let t = 0; t < obj.w; t++) {
          const tx = x + t * CELL + CELL / 2;
          const ty = y + CELL / 2;
          // Shell
          ctx.fillStyle = '#2E8B57';
          ctx.shadowColor = '#3CB371';
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.ellipse(tx, ty, CELL * 0.38, CELL * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          // Shell pattern
          ctx.strokeStyle = '#1a5c35';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(tx - CELL*0.15, ty - CELL*0.15);
          ctx.lineTo(tx + CELL*0.15, ty - CELL*0.15);
          ctx.lineTo(tx + CELL*0.15, ty + CELL*0.15);
          ctx.lineTo(tx - CELL*0.15, ty + CELL*0.15);
          ctx.closePath(); ctx.stroke();
          // Head
          ctx.fillStyle = '#3CB371';
          ctx.beginPath();
          ctx.arc(tx + (lane.dir < 0 ? -CELL*0.35 : CELL*0.35), ty, CELL*0.12, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

      } else if (lane.type === 'car') {
        const colors = ['#FF4444','#4444FF','#FFAA00','#FF44FF','#44FFFF'];
        ctx.fillStyle = colors[(lane.row - 7) % colors.length];
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 6;
        ctx.fillRect(x + 2, y + 6, obj.w * CELL - 4, CELL - 12);
        // Windows
        ctx.fillStyle = 'rgba(180,220,255,0.7)';
        const ww = Math.min(obj.w * CELL * 0.25, 20);
        ctx.fillRect(x + 6, y + 9, ww, CELL - 18);
        ctx.fillRect(x + obj.w * CELL - 6 - ww, y + 9, ww, CELL - 18);
        ctx.shadowBlur = 0;
      }
    });
  });
}

function drawFrog() {
  if (frog.row < 0 || frog.row >= ROWS) return;
  const x = frog.col * CELL + CELL / 2;
  const y = frog.row * CELL + CELL / 2;

  if (frog.dead) {
    // Death flash/shrink
    const progress = Math.min(frog.deathFrame / 40, 1);
    const r = CELL * 0.35 * (1 - progress);
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = '#FF4444';
    ctx.shadowColor = '#FF0000';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    return;
  }

  const rotation = { up: -Math.PI/2, down: Math.PI/2, left: Math.PI, right: 0 }[frogFacing];

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.shadowColor = '#00FF44';
  ctx.shadowBlur = 8;

  // Body
  ctx.fillStyle = '#00CC33';
  ctx.beginPath();
  ctx.ellipse(0, 0, CELL * 0.3, CELL * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-CELL*0.15, -CELL*0.2, CELL*0.1, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( CELL*0.15, -CELL*0.2, CELL*0.1, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(-CELL*0.15, -CELL*0.22, CELL*0.05, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( CELL*0.15, -CELL*0.22, CELL*0.05, 0, Math.PI*2); ctx.fill();

  // Front legs
  ctx.fillStyle = '#009922';
  ctx.beginPath(); ctx.ellipse(-CELL*0.38, -CELL*0.1, CELL*0.12, CELL*0.08, -0.4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( CELL*0.38, -CELL*0.1, CELL*0.12, CELL*0.08,  0.4, 0, Math.PI*2); ctx.fill();

  // Back legs
  ctx.beginPath(); ctx.ellipse(-CELL*0.38, CELL*0.15, CELL*0.14, CELL*0.09, 0.4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( CELL*0.38, CELL*0.15, CELL*0.14, CELL*0.09, -0.4, 0, Math.PI*2); ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawTimerBar() {
  const barW = canvas.width - 20;
  const barH = 6;
  const barX = 10;
  const barY = ROWS * CELL - 8;
  const pct = timeLeft / timeMax;
  ctx.fillStyle = '#111';
  ctx.fillRect(barX, barY, barW, barH);
  const col = pct > 0.5 ? '#00FF44' : pct > 0.25 ? '#FFAA00' : '#FF4444';
  ctx.fillStyle = col;
  ctx.fillRect(barX, barY, barW * pct, barH);
}

function drawFloatingScores() {
  if (!floatingScores.length) return;
  ctx.save();
  ctx.font = 'bold 10px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFD700';
  floatingScores.forEach(s => {
    ctx.fillText(String(s.pts), s.col * CELL + CELL / 2, s.row * CELL + CELL / 2);
  });
  ctx.restore();
}

function drawLeaderboard() {
  const cx = canvas.width / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,10,0.92)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#00FF44';
  ctx.font = '14px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('HIGH SCORES', cx, 40);

  if (leaderboard.length === 0) {
    ctx.fillStyle = '#444466';
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.fillText('NO RECORDS YET', cx, 240);
  } else {
    ctx.fillStyle = '#444466';
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('#', 20, 80);
    ctx.fillText('NAME', 80, 80);
    ctx.textAlign = 'right';
    ctx.fillText('SCORE', canvas.width - 20, 80);

    leaderboard.forEach((entry, i) => {
      const y = 102 + i * 22;
      const isLast = lastScore > 0 && entry.score === lastScore &&
        i === leaderboard.findIndex(e => e.score === lastScore && e.name === entry.name);
      ctx.fillStyle = isLast ? '#FFD700' : (i % 2 === 0 ? '#FFFFFF' : '#AAAACC');
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}.`, 20, y);
      ctx.fillText(entry.name.padEnd(3, ' '), 80, y);
      ctx.textAlign = 'right';
      ctx.fillText(String(entry.score).padStart(6, '0'), canvas.width - 20, y);
    });
  }

  if (Math.floor(Date.now() / 550) % 2 === 0) {
    ctx.fillStyle = '#00FFFF';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(isMobile ? 'TAP TO PLAY' : 'PRESS SPACE TO PLAY', cx, canvas.height - 40);
  }

  ctx.restore();
}

function drawNameEntry() {
  const cx = canvas.width / 2;
  const slotY = 280;
  const slotSpacing = 64;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,10,0.92)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#FFD700';
  ctx.font = '12px "Press Start 2P", monospace';
  ctx.fillText('NEW HIGH SCORE!', cx, 100);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '16px "Press Start 2P", monospace';
  ctx.fillText(String(lastScore).padStart(6, '0'), cx, 140);

  ctx.fillStyle = '#888888';
  ctx.font = '9px "Press Start 2P", monospace';
  ctx.fillText('ENTER YOUR NAME', cx, 210);

  [-1, 0, 1].forEach((offset, i) => {
    const sx = cx + offset * slotSpacing;
    const active = i === nameCursor;
    ctx.fillStyle = active ? '#1a1a44' : '#0a0a22';
    ctx.fillRect(sx - 22, slotY - 24, 44, 48);
    ctx.strokeStyle = active ? '#FFD700' : '#333366';
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeRect(sx - 22, slotY - 24, 44, 48);
    ctx.fillStyle = active ? '#FFD700' : '#FFFFFF';
    ctx.font = '20px "Press Start 2P", monospace';
    ctx.fillText(nameChars[i], sx, slotY);
    const arrowColor = active ? '#FFD700' : '#333366';
    ctx.fillStyle = arrowColor;
    ctx.beginPath(); ctx.moveTo(sx, slotY-42); ctx.lineTo(sx-8,slotY-32); ctx.lineTo(sx+8,slotY-32); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx, slotY+42); ctx.lineTo(sx-8,slotY+32); ctx.lineTo(sx+8,slotY+32); ctx.closePath(); ctx.fill();
  });

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '9px "Press Start 2P", monospace';
  ctx.fillText(isMobile ? 'UP/DN:LETTER  LT/RT:MOVE  TAP:NEXT' : 'UP/DN: LETTER    LT/RT: MOVE    ENTER: OK', cx, canvas.height - 40);
  ctx.restore();
}

function drawDebugPauseOverlay() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '11px "Press Start 2P", monospace';
  ctx.fillStyle = '#FFD700';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PAUSED — SPACE/TAP TO RESUME', canvas.width / 2, canvas.height / 2);
  ctx.restore();
}

function drawHitboxes() {
  ctx.save();
  ctx.lineWidth = 2;

  // Car hitboxes (red fill + border)
  lanes.filter(l => l.type === 'car').forEach(lane => {
    lane.objects.forEach(obj => {
      const x = (obj.x + 0.1) * CELL;
      const y = lane.row * CELL + 4;
      const w = (obj.w - 0.2) * CELL;
      const h = CELL - 8;
      ctx.fillStyle = 'rgba(255,0,0,0.25)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#FF0000';
      ctx.strokeRect(x, y, w, h);
    });
  });

  // Platform (log/turtle) hitboxes (cyan)
  // frogOnPlatform checks: frog.col >= obj.x - 0.5 && frog.col < obj.x + obj.w - 0.5
  // = frog.col + 0.5 (visual center) is in [obj.x, obj.x + obj.w)
  lanes.filter(l => l.type === 'log' || l.type === 'turtle').forEach(lane => {
    lane.objects.forEach(obj => {
      if (lane.type === 'turtle' && obj.diveState === 'under') return;
      const x = obj.x * CELL;
      const y = lane.row * CELL + 4;
      const w = obj.w * CELL;
      const h = CELL - 8;
      ctx.fillStyle = 'rgba(0,255,255,0.15)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#00FFFF';
      ctx.strokeRect(x, y, w, h);
    });
  });

  // Frog hitbox (yellow) — center matches drawFrog: frog.col * CELL + CELL/2
  const fc = frog.col + 0.5;
  const fx = (fc - 0.25) * CELL;
  const fy = frog.row * CELL + 4;
  ctx.fillStyle = 'rgba(255,255,0,0.3)';
  ctx.fillRect(fx, fy, 0.5 * CELL, CELL - 8);
  ctx.strokeStyle = '#FFFF00';
  ctx.strokeRect(fx, fy, 0.5 * CELL, CELL - 8);

  ctx.restore();
}

function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawHomePads();
  drawLanes();
  drawFrog();
  drawTimerBar();
  drawFloatingScores();
  if (DEBUG_HITBOXES) drawHitboxes();
  if (debugPaused) drawDebugPauseOverlay();
  if (gameState === 'highscore') drawLeaderboard();
  if (gameState === 'nameentry') drawNameEntry();
}

// ─── GAME LOOP ────────────────────────────────────────────────────────────────
let lastTime = 0;

function loop(ts) {
  requestAnimationFrame(loop);
  const dt = ts - lastTime;
  if (dt < 14) return;
  lastTime = ts;

  if ((gameState === 'playing' || gameState === 'dying') && !helpOpen && !debugPaused) {
    update();
  }

  render();
}

// ─── START ────────────────────────────────────────────────────────────────────
document.fonts.ready.then(() => {
  try {
    resizeCanvas();
    initGame();
    requestAnimationFrame(loop);
  } catch(e) {
    logError('BOOT: ' + e.message);
  }
}).catch(e => logError('FONTS: ' + e.message));
