// 🔴 あなたのサーバーのアドレス（HTTPS/WSSが通るURL）に変更してください
const SERVER_URL = "https://nasty-days-bow.loca.lt"; // または "http://localhost:3000" (ローカルテスト時)
const socket = io(SERVER_URL);

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let myId = null;
let players = {};
let inkCanvas = document.createElement('canvas'); // 塗りを保持する裏画面
inkCanvas.width = canvas.width;
inkCanvas.height = canvas.height;
const inkCtx = inkCanvas.getContext('2d');

// キーボード入力管理
const keys = {};
window.addEventListener('keydown', (e) => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

// クリックでインク発射
canvas.addEventListener('mousedown', (e) => {
    if (!myId || !players[myId]) return;
    const rect = canvas.getBoundingClientRect();
    const targetX = e.clientX - rect.left;
    const targetY = e.clientY - rect.top;
    
    // サーバーに射撃イベント送信
    socket.emit('shoot', { x: targetX, y: targetY });
});

// --- Socket.io 受信イベント ---
socket.on('init', (data) => {
    myId = data.id;
    players = data.players;
    // 既存のインクを描画
    data.inkStrokes.forEach(drawInk);
});

socket.on('playerJoined', (data) => {
    players[data.id] = data.player;
});

socket.on('playerMoved', (data) => {
    if (players[data.id]) {
        players[data.id].x = data.x;
        players[data.id].y = data.y;
    }
});

socket.on('inkAdded', (stroke) => {
    drawInk(stroke);
});

socket.on('playerLeft', (id) => {
    delete players[id];
});

// インクを描画する関数
function drawInk(stroke) {
    inkCtx.fillStyle = stroke.color;
    inkCtx.beginPath();
    inkCtx.arc(stroke.x, stroke.y, stroke.radius, 0, Math.PI * 2);
    inkCtx.fill();
}

// プレイヤー移動処理
function handleInput() {
    if (!myId || !players[myId]) return;

    let moved = false;
    const speed = 4;
    const p = players[myId];

    if (keys['w'] || keys['arrowup']) { p.y -= speed; moved = true; }
    if (keys['s'] || keys['arrowdown']) { p.y += speed; moved = true; }
    if (keys['a'] || keys['arrowleft']) { p.x -= speed; moved = true; }
    if (keys['d'] || keys['arrowright']) { p.x += speed; moved = true; }

    if (moved) {
        socket.emit('move', { x: p.x, y: p.y });
    }
}

// 描画ループ
function gameLoop() {
    handleInput();

    // 画面クリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. 塗られたインクを描画
    ctx.drawImage(inkCanvas, 0, 0);

    // 2. 全プレイヤーを描画
    for (const id in players) {
        const p = players[id];
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        ctx.fill();

        // 枠線（自分は白色、他人は黒色）
        ctx.strokeStyle = (id === myId) ? '#FFFFFF' : '#000000';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
