// 🔴 あなたの公開URL（localtunnelやngrokのURL）
const SERVER_URL = "https://mitspla38.loca.lt"; // ※適宜変更
const socket = io(SERVER_URL, {
    transports: ['websocket'],
    extraHeaders: { "Bypass-Tunnel-Reminder": "true" }
});

let myId = null;
let myColor = '#ff007f'; // 自分の初期色
const otherPlayers = {};
const bullets = []; // 飛んでいる弾のリスト

// --- 1. Three.js シーン ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 20, 120);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.6, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ライト
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
scene.add(hemiLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(30, 50, 30);
scene.add(dirLight);

// --- 2. 床とインクのテクスチャ (2048x2048) ---
const MAP_SIZE = 100;
const inkCanvas = document.createElement('canvas');
inkCanvas.width = 2048;
inkCanvas.height = 2048;
const inkCtx = inkCanvas.getContext('2d');

// 初期床（マス目グリッドを描画）
inkCtx.fillStyle = '#e0e0e0';
inkCtx.fillRect(0, 0, inkCanvas.width, inkCanvas.height);
inkCtx.strokeStyle = '#cccccc';
inkCtx.lineWidth = 4;
for (let i = 0; i <= 2048; i += 64) {
    inkCtx.beginPath(); inkCtx.moveTo(i, 0); inkCtx.lineTo(i, 2048); inkCtx.stroke();
    inkCtx.beginPath(); inkCtx.moveTo(0, i); inkCtx.lineTo(2048, i); inkCtx.stroke();
}

const groundTexture = new THREE.CanvasTexture(inkCanvas);
const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
const groundMat = new THREE.MeshLambertMaterial({ map: groundTexture });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2; // 地面に倒す
scene.add(ground);

// --- 3. 操作設定 (PointerLock) ---
const controls = new THREE.PointerLockControls(camera, document.body);
const blocker = document.getElementById('blocker');
blocker.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => blocker.style.display = 'none');
controls.addEventListener('unlock', () => blocker.style.display = 'flex');

const move = { forward: false, backward: false, left: false, right: false };
document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') move.forward = true;
    if (e.code === 'KeyS') move.backward = true;
    if (e.code === 'KeyA') move.left = true;
    if (e.code === 'KeyD') move.right = true;
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') move.forward = false;
    if (e.code === 'KeyS') move.backward = false;
    if (e.code === 'KeyA') move.left = false;
    if (e.code === 'KeyD') move.right = false;
});

// --- 4. 弾の生成と発射 ---
const bulletGeo = new THREE.SphereGeometry(0.3, 8, 8);

function spawnBullet(pos, dir, color) {
    const mat = new THREE.MeshBasicMaterial({ color: color });
    const mesh = new THREE.Mesh(bulletGeo, mat);
    mesh.position.copy(pos);
    scene.add(mesh);

    bullets.push({
        mesh: mesh,
        velocity: dir.clone().multiplyScalar(45), // 弾速
        color: color,
        alive: true
    });
}

// クリックで射撃
window.addEventListener('mousedown', (e) => {
    if (!controls.isLocked || e.button !== 0) return;

    // カメラの向いている方向を取得
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    // 銃口位置（カメラの少し前＆下）
    const pos = camera.position.clone().add(dir.clone().multiplyScalar(0.5));
    pos.y -= 0.2;

    // サーバーへ送信（全員に同期）
    socket.emit('shoot', {
        pos: { x: pos.x, y: pos.y, z: pos.z },
        dir: { x: dir.x, y: dir.y, z: dir.z },
        color: myColor
    });
});

// 床にインクを描く関数（飛び散り付き）
function drawInkOnCanvas(worldX, worldZ, color) {
    // 3D座標(-50〜50) を Canvas座標(0〜2048) に変換
    const u = ((worldX + MAP_SIZE / 2) / MAP_SIZE) * inkCanvas.width;
    const v = ((worldZ + MAP_SIZE / 2) / MAP_SIZE) * inkCanvas.height;

    inkCtx.fillStyle = color;
    
    // メインの塗り
    inkCtx.beginPath();
    inkCtx.arc(u, v, 45, 0, Math.PI * 2);
    inkCtx.fill();

    // 周りの飛び散り（スプラッシュ感）
    for (let i = 0; i < 4; i++) {
        const offsetU = u + (Math.random() - 0.5) * 60;
        const offsetV = v + (Math.random() - 0.5) * 60;
        const splashR = Math.random() * 15 + 5;
        inkCtx.beginPath();
        inkCtx.arc(offsetU, offsetV, splashR, 0, Math.PI * 2);
        inkCtx.fill();
    }

    groundTexture.needsUpdate = true; // テクスチャ更新
}

// 他プレイヤーの3Dモデル作成
function createPlayerMesh(color) {
    const group = new THREE.Group();
    // 体
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 1.6, 16),
        new THREE.MeshLambertMaterial({ color: color })
    );
    body.position.y = 0.8;
    group.add(body);
    scene.add(group);
    return group;
}

// --- 5. 通信受信 (Socket.io) ---
socket.on('init', (data) => {
    myId = data.id;
    if (data.players[myId]) myColor = data.players[myId].color;

    for (let id in data.players) {
        if (id !== myId) {
            otherPlayers[id] = createPlayerMesh(data.players[id].color);
        }
    }
    if (data.inkStrokes) {
        data.inkStrokes.forEach(s => drawInkOnCanvas(s.x, s.z, s.color));
    }
});

socket.on('playerJoined', (data) => {
    if (!otherPlayers[data.id] && data.id !== myId) {
        otherPlayers[data.id] = createPlayerMesh(data.player.color);
    }
});

socket.on('playerMoved', (data) => {
    if (otherPlayers[data.id]) {
        otherPlayers[data.id].position.x = data.x;
        otherPlayers[data.id].position.z = data.z;
    }
});

// 誰かが撃ったら弾を飛ばす
socket.on('bulletFired', (data) => {
    const pos = new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z);
    const dir = new THREE.Vector3(data.dir.x, data.dir.y, data.dir.z);
    spawnBullet(pos, dir, data.color);
});

// 地面のインク同期
socket.on('inkAdded', (data) => {
    drawInkOnCanvas(data.x, data.z, data.color);
});

socket.on('playerLeft', (id) => {
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id]);
        delete otherPlayers[id];
    }
});

// --- 6. メインゲームループ（弾道計算・移動） ---
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const gravity = 25.0; // 重力

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    // A. 弾の更新（弾道・着弾判定）
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.velocity.y -= gravity * delta; // 重力で落下
        b.mesh.position.addScaledVector(b.velocity, delta);

        // 地面(y <= 0)に着弾したか判定
        if (b.mesh.position.y <= 0.1) {
            drawInkOnCanvas(b.mesh.position.x, b.mesh.position.z, b.color);
            scene.remove(b.mesh);
            bullets.splice(i, 1);
        }
    }

    // B. プレイヤー移動
    if (controls.isLocked) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(move.forward) - Number(move.backward);
        direction.x = Number(move.right) - Number(move.left);
        direction.normalize();

        const speed = 70.0;
        if (move.forward || move.backward) velocity.z -= direction.z * speed * delta;
        if (move.left || move.right) velocity.x -= direction.x * speed * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        const pos = camera.position;
        socket.emit('move', { x: pos.x, z: pos.z });
    }

    prevTime = time;
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
