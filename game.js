// 1. サーバー接続設定
const SERVER_URL = "https://old-impalas-brush.loca.lt";
const socket = io(SERVER_URL, {
    transports: ['websocket'],
    extraHeaders: {
        "Bypass-Tunnel-Reminder": "true"
    }
});

let myId = null;
const otherPlayers = {};

// 2. Three.js シーン・カメラ・レンダラー初期化
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 10, 100);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.y = 1.6;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ライト
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
scene.add(hemiLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(20, 40, 20);
scene.add(dirLight);

// 3. インクを描く床テクスチャの作成
const MAP_SIZE = 100;
const inkCanvas = document.createElement('canvas');
inkCanvas.width = 2048;
inkCanvas.height = 2048;
const inkCtx = inkCanvas.getContext('2d');
inkCtx.fillStyle = '#dcdcdc'; // 床の色
inkCtx.fillRect(0, 0, inkCanvas.width, inkCanvas.height);

const groundTexture = new THREE.CanvasTexture(inkCanvas);
const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
const groundMat = new THREE.MeshLambertMaterial({ map: groundTexture });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// 4. 操作設定 (PointerLock)
const controls = new THREE.PointerLockControls(camera, document.body);
const blocker = document.getElementById('blocker');

blocker.addEventListener('click', () => {
    controls.lock();
});

controls.addEventListener('lock', () => {
    blocker.style.display = 'none';
});

controls.addEventListener('unlock', () => {
    blocker.style.display = 'flex';
});

// キー操作
const move = { forward: false, backward: false, left: false, right: false };
document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') move.forward = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') move.backward = true;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') move.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') move.right = true;
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') move.forward = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') move.backward = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') move.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') move.right = false;
});

// 5. 照準からの射撃 (レイキャスト)
const raycaster = new THREE.Raycaster();
const centerPoint = new THREE.Vector2(0, 0);

window.addEventListener('mousedown', (e) => {
    if (!controls.isLocked) return;
    if (e.button === 0) {
        raycaster.setFromCamera(centerPoint, camera);
        const intersects = raycaster.intersectObject(ground);

        if (intersects.length > 0) {
            const hit = intersects[0].point;
            socket.emit('shoot', { x: hit.x, z: hit.z });
        }
    }
});

// インク塗り処理
function drawInkOnCanvas(x, z, color) {
    const u = ((x + MAP_SIZE / 2) / MAP_SIZE) * inkCanvas.width;
    const v = ((z + MAP_SIZE / 2) / MAP_SIZE) * inkCanvas.height;

    inkCtx.fillStyle = color;
    inkCtx.beginPath();
    inkCtx.arc(u, v, 40, 0, Math.PI * 2);
    inkCtx.fill();
    groundTexture.needsUpdate = true;
}

// 他プレイヤーの作成
function createPlayerMesh(color) {
    const geo = new THREE.CylinderGeometry(0.6, 0.6, 1.8, 16);
    const mat = new THREE.MeshLambertMaterial({ color: color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.9;
    scene.add(mesh);
    return mesh;
}

// 6. Socket通信受信
socket.on('init', (data) => {
    myId = data.id;
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

socket.on('inkAdded', (data) => {
    drawInkOnCanvas(data.x, data.z, data.color);
});

socket.on('playerLeft', (id) => {
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id]);
        delete otherPlayers[id];
    }
});

// 7. アニメーション＆移動ループ
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

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
