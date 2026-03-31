import * as THREE from './node_modules/three/build/three.module.js';
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';
import { GUI } from './node_modules/three/examples/jsm/libs/lil-gui.module.min.js';

// config
const urlParams = new URLSearchParams(window.location.search);
const CONFIG = {
    width: parseInt(urlParams.get('width')) || 10,
    height: parseInt(urlParams.get('height')) || 5,
    depth: parseInt(urlParams.get('depth')) || 3,
    lightIntensity: parseFloat(urlParams.get('lightIntensity')) || 250,
    orientation: 'forward', 
    bottle: { radius: 0.35, height: 2.5, hSpacing: 0.7, vSpacing: 0.5, zSpacing: 0.2 },
    shelf: { thickness: 0.1 },
    colors: { bottle: 0x334433, shelf: 0x8B4513, room: 0x181818, highlight: 0xa12c44 }
};

let scene, camera, renderer, controls, raycaster;
const mouse = new THREE.Vector2();
const textureLoader = new THREE.TextureLoader();
let bottles = [];
let shelves = [];
let roomPlanes = [];
let activeLights = []; // track lights/targets for cleanup
let INTERSECTED_BOTTLE = null;

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.room);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    refreshScene();

    const gui = new GUI();
    const configFolder = gui.addFolder('Cellar Configuration');
    configFolder.add(CONFIG, 'orientation', ['upright', 'side', 'forward']).name('Orientation').onChange(refreshScene);
    configFolder.add(CONFIG, 'width', 1, 30, 1).name('Width').onChange(refreshScene);
    configFolder.add(CONFIG, 'height', 1, 20, 1).name('Height').onChange(refreshScene);
    configFolder.add(CONFIG, 'depth', 1, 10, 1).name('Depth').onChange(refreshScene);

    const spacingFolder = gui.addFolder('Spacing');
    spacingFolder.add(CONFIG.bottle, 'hSpacing', 0, 2).name('Horizontal').onChange(refreshScene);
    spacingFolder.add(CONFIG.bottle, 'vSpacing', 0, 2).name('Vertical').onChange(refreshScene);
    spacingFolder.add(CONFIG.bottle, 'zSpacing', 0, 2).name('Depth Buffer').onChange(refreshScene);

    const actionFolder = gui.addFolder('Bottle Actions');
    const bottleActions = {
        logInfo: () => {
            if (INTERSECTED_BOTTLE) {
                console.log("Bottle Data:", INTERSECTED_BOTTLE.userData);
                alert(`Bottle: ${INTERSECTED_BOTTLE.userData.wineName}\nVintage: ${INTERSECTED_BOTTLE.userData.vintage}\nPosition: R${INTERSECTED_BOTTLE.userData.row} C${INTERSECTED_BOTTLE.userData.col} D${INTERSECTED_BOTTLE.userData.depth}`);
            } else {
                alert("No bottle selected!");
            }
        }
    };
    actionFolder.add(bottleActions, 'logInfo').name('Show Details');

    raycaster = new THREE.Raycaster();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onWindowResize);
}

function refreshScene() {
    // cleanup everything inc lighting
    bottles.forEach(b => scene.remove(b));
    shelves.forEach(s => scene.remove(s));
    roomPlanes.forEach(p => scene.remove(p));
    
    activeLights.forEach(l => {
        if(l.target) scene.remove(l.target);
        scene.remove(l);
    });
    
    bottles = [];
    shelves = [];
    roomPlanes = [];
    activeLights = [];

    // dimensions logic
    const bDiam = CONFIG.bottle.radius * 2;
    const slotW = (CONFIG.orientation === 'side') ? CONFIG.bottle.height : bDiam;
    const slotH = (CONFIG.orientation === 'upright') ? CONFIG.bottle.height : bDiam;
    const slotD = (CONFIG.orientation === 'forward') ? CONFIG.bottle.height : bDiam;

    const shelfDepth = (CONFIG.depth * slotD) + (CONFIG.depth * CONFIG.bottle.zSpacing) + 0.5;
    const totalWidth = (slotW * CONFIG.width) + (CONFIG.bottle.hSpacing * (CONFIG.width - 1)) + 1;
    const totalHeight = (slotH + CONFIG.bottle.vSpacing + CONFIG.shelf.thickness) * CONFIG.height;

    const dim = { totalWidth, totalHeight, shelfDepth, slotW, slotH, slotD };

    createRoom(dim);
    createCellarStructure(dim);
    createLighting(dim);

    camera.position.set(0, totalHeight / 2 + 2, shelfDepth + 8);
    controls.target.set(0, totalHeight / 2, 0);
    controls.update();
}

function createLighting({ totalWidth, totalHeight, shelfDepth }) {
    // ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.1);
    scene.add(ambient);
    activeLights.push(ambient);

    // distributed spotlights
    const numLights = Math.max(1, Math.ceil(totalWidth / 8)); 
    
    for (let i = 0; i < numLights; i++) {
        // calc position so they are centered
        let lightX = (numLights === 1) ? 0 : (i - (numLights - 1) / 2) * (totalWidth / numLights);

        const spotLight = new THREE.SpotLight(0xffddaa, CONFIG.lightIntensity, 50, Math.PI / 4, 0.5, 1.5);
        spotLight.position.set(lightX, totalHeight + 6, shelfDepth + 4);
        
        const target = new THREE.Object3D();
        target.position.set(lightX, totalHeight / 2, 0);
        scene.add(target);
        spotLight.target = target;

        spotLight.castShadow = true;
        spotLight.shadow.mapSize.set(1024, 1024);
        spotLight.shadow.bias = -0.001;

        scene.add(spotLight);
        activeLights.push(spotLight);
    }

    // directional fill
    const fill = new THREE.DirectionalLight(0xffffff, 0.15);
    fill.position.set(5, 10, 10);
    scene.add(fill);
    activeLights.push(fill);
}

function createRoom({ totalWidth, totalHeight, shelfDepth }) {
    const roomSize = Math.max(totalWidth, shelfDepth) * 5;
    const wallHeight = totalHeight + 15;

    const applyTexture = (path, repeatX, repeatY) => {
        const tex = textureLoader.load(path);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        tex.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
    };

    const floorMat = applyTexture('./textures/floor2.avif', roomSize / 4, roomSize / 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomSize, roomSize), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    scene.add(floor);
    roomPlanes.push(floor);

    const wallMat = applyTexture('./textures/blackbrick.avif', roomSize / 4, wallHeight / 4);
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize, wallHeight), wallMat);
    backWall.position.set(0, wallHeight / 2, -shelfDepth / 2 - 0.1);
    backWall.receiveShadow = true;
    scene.add(backWall);
    roomPlanes.push(backWall);
}

function createCellarStructure({ totalWidth, shelfDepth, slotW, slotH, slotD }) {
    const bottleGeo = new THREE.CylinderGeometry(CONFIG.bottle.radius, CONFIG.bottle.radius, CONFIG.bottle.height, 32);
    const shelfMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.shelf, roughness: 0.6 });

    for (let h = 0; h < CONFIG.height; h++) {
        const y = h * (slotH + CONFIG.bottle.vSpacing + CONFIG.shelf.thickness);
        
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(totalWidth, CONFIG.shelf.thickness, shelfDepth), shelfMat);
        shelf.position.set(0, y + CONFIG.shelf.thickness / 2, 0);
        shelf.receiveShadow = true;
        shelf.castShadow = true;
        scene.add(shelf);
        shelves.push(shelf);

        for (let w = 0; w < CONFIG.width; w++) {
            for (let d = 0; d < CONFIG.depth; d++) {
                const bottle = new THREE.Mesh(bottleGeo, new THREE.MeshStandardMaterial({ color: CONFIG.colors.bottle, roughness: 0.3, metalness: 0.2 }));
                
                let xPos, yPos, zPos;
                const zStart = -shelfDepth / 2 + 0.4;

                if (CONFIG.orientation === 'forward') {
                    xPos = (-(totalWidth / 2) + 0.5 + CONFIG.bottle.radius) + w * (slotW + CONFIG.bottle.hSpacing);
                    yPos = y + CONFIG.shelf.thickness + CONFIG.bottle.radius;
                    zPos = zStart + (d * (CONFIG.bottle.height + CONFIG.bottle.zSpacing)) + CONFIG.bottle.height/2;
                    bottle.rotation.x = Math.PI / 2;
                } else if (CONFIG.orientation === 'side') {
                    xPos = (-(totalWidth / 2) + 0.5 + CONFIG.bottle.height / 2) + w * (slotW + CONFIG.bottle.hSpacing);
                    yPos = y + CONFIG.shelf.thickness + CONFIG.bottle.radius;
                    zPos = zStart + (d * (slotD + CONFIG.bottle.zSpacing)) + CONFIG.bottle.radius;
                    bottle.rotation.z = Math.PI / 2; 
                } else {
                    xPos = (-(totalWidth / 2) + 0.5 + CONFIG.bottle.radius) + w * (slotW + CONFIG.bottle.hSpacing);
                    yPos = y + CONFIG.shelf.thickness + CONFIG.bottle.height / 2;
                    zPos = zStart + (d * (slotD + CONFIG.bottle.zSpacing)) + CONFIG.bottle.radius;
                }

                bottle.position.set(xPos, yPos, zPos);
                bottle.castShadow = true;
                bottle.receiveShadow = true;
                
                const userFacingDepthIndex = CONFIG.depth - 1;
                const invertedDepthMetadata = userFacingDepthIndex - d + 1;

                bottle.userData = { 
                    originalColor: CONFIG.colors.bottle,
                    row: h + 1, col: w + 1, depth: invertedDepthMetadata,
                    wineName: `Wine R${h+1}C${w+1}D${invertedDepthMetadata}`,
                    vintage: `20${10 + h + w + d}`
                };

                scene.add(bottle);
                bottles.push(bottle);
            }
        }
    }
}

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(bottles);
    const infoDiv = document.getElementById('bottleInfo');

    if (intersects.length > 0) {
        const target = intersects[0].object;
        if (INTERSECTED_BOTTLE !== target) {
            if (INTERSECTED_BOTTLE) INTERSECTED_BOTTLE.material.color.setHex(INTERSECTED_BOTTLE.userData.originalColor);
            INTERSECTED_BOTTLE = target;
            INTERSECTED_BOTTLE.material.color.setHex(CONFIG.colors.highlight);

            if (infoDiv) {
                infoDiv.style.display = 'block';
                infoDiv.innerHTML = `
                    <strong>Bottle:</strong> Row ${target.userData.row}, Col ${target.userData.col}, Depth ${target.userData.depth}<br>
                    <strong>Wine:</strong> ${target.userData.wineName}<br>
                    <strong>Vintage:</strong> ${target.userData.vintage}
                `;
            }
        }
    } else if (INTERSECTED_BOTTLE) {
        INTERSECTED_BOTTLE.material.color.setHex(INTERSECTED_BOTTLE.userData.originalColor);
        INTERSECTED_BOTTLE = null;
        if (infoDiv) infoDiv.style.display = 'none';
    }

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}