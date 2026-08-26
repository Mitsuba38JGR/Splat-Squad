// 🔴 あなたの公開URL（localtunnelやngrokのURL）に変更してください
const SERVER_URL = "https://nasty-days-bow.loca.lt"; 
const socket = io(SERVER_URL);

let myId = null;
const otherPlayers = {}; // 他プレイヤーの3Dメッシュ管理

// --- 1. Three.js シーン設定 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // 青空
scene.fog = new THREE.Fog(0x87ceeb, 10, 100);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.y = 1.6; // 目線の高さ (1.6m)

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ライト
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
scene.add(hemiLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(20, 40, 20);
scene.add(dirLight);

// --- 2. 床とインクのテクスチャ設定 ---
const MAP_SIZE = 100;
const inkCanvas = document.createElement('canvas');
inkCanvas.width = 2048;
inkCanvas.height = 2048;
const inkCtx = inkCanvas.getContext('2d');
inkCtx.fillStyle = '#cccccc'; // 初期床色（グレー）
inkCtx.fillRect(0, 0, inkCanvas.width, inkCanvas.height);

const groundTexture = new THREE.CanvasTexture(inkCanvas);
const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
const groundMat = new THREE.MeshLambertMaterial({ map: groundTexture });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2; // 地面に水平にする
scene.add(ground);

// --- 3. FPS コントロール (PointerLock) ---
const controls = new THREE.PointerLockControls(camera, document.body);
const blocker = document.getElementById('blocker');

blocker.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => blocker.style.display = 'none');
controls.addEventListener('unlock', () => blocker.style.display = 'flex');

// 移動キー管理
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

// --- 4. 射撃（照準の中心に向けてレイキャスト） ---
const raycaster = new THREE.Raycaster();
const centerPoint = new THREE.Vector2(0, 0); // 画面中央

window.addEventListener('mousedown', (e) => {
    if (!controls.isLocked) return;
    if (e.button === 0) { // 左クリック
        raycaster.setFromCamera(centerPoint, camera);
        const intersects = raycaster.intersectObject(ground);

        if (intersects.length > 0) {
            const hit = intersects[0].point;
            // サーバーへ塗りを送信
            socket.emit('shoot', { x: hit.x, z: hit.z });
        }
    }
});

// 床にインクを描く関数
function drawInkOnCanvas(x, z, color) {
    // 3D座標(-50〜50) を Canvas座標(0〜2048) に変換
    const u = ((x + MAP_SIZE / 2) / MAP_SIZE) * inkCanvas.width;
    const v = ((z + MAP_SIZE / 2) / MAP_SIZE) * inkCanvas.height;

    inkCtx.fillStyle = color;
    inkCtx.beginPath();
    inkCtx.arc(u, v, 30, 0, Math.PI * 2); // インクの円を描く
    inkCtx.fill();
    groundTexture.needsUpdate = true; // テクスチャ再描画フラグ
}

// 他プレイヤーの3Dモデル（簡易カプセル）を作成
function createPlayerMesh(color) {
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16);
    const mat = new THREE.MeshLambertMaterial({ color: color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.9;
    scene.add(mesh);
    return mesh;
}

// --- 5. 通信処理 (Socket.io) ---
socket.on('init', (data) => {
    myId = data.id;
    // 既存プレイヤー生成
    for (let id in data.players) {
        if (id !== myId) {
            otherPlayers[id] = createPlayerMesh(data.players[id].color);
        }
    }
    // 既存インク描画
    data.inkStrokes.forEach(s => drawInkOnCanvas(s.x, s.z, s.color));
});

socket.on('playerJoined', (data) => {
    otherPlayers[data.id] = createPlayerMesh(data.player.color);
});

socket.on('playerMoved', (data) => {
    if (otherPlayers[data.id]) {
        otherPlayers[data.id].position.x = data.x;
        otherPlayers[data.id].position.z = data.z;
    }
});

socket.on('inkAdded', (data) => {
    drawInkOnCanvas(data.x, data.z, data.color);
});

socket.on('playerLeft', (id) => {
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id]);
        delete otherPlayers[id];
    }
});

// --- 6. メインゲームループ ---
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    if (controls.isLocked) {
        // 移動計算
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(move.forward) - Number(move.backward);
        direction.x = Number(move.right) - Number(move.left);
        direction.normalize();

        const speed = 60.0;
        if (move.forward || move.backward) velocity.z -= direction.z * speed * delta;
        if (move.left || move.right) velocity.x -= direction.x * speed * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        // サーバーに自分の位置を送信
        const pos = camera.position;
        socket.emit('move', { x: pos.x, z: pos.z });
    }

    prevTime = time;
    renderer.render(scene, camera);
}

// 画面リサイズ対応
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
