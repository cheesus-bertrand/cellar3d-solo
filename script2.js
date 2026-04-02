import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

// global state
let scene, camera, renderer, controls, raycaster, gui;
const mouse = new THREE.Vector2();
const cellars = [];
let allBottles = [];
let INTERSECTED_BOTTLE = null;

const worldGroup = new THREE.Group();
const wireMat = new THREE.MeshStandardMaterial({ metalness: 1.0, roughness: 0.1 });

// bottle shape logic
const createBottleGeometry = (radius, height) => {
    const pts = [];
    const rad = radius;
    const h = height;
    pts.push(new THREE.Vector2(0, 0));
    pts.push(new THREE.Vector2(rad, 0));
    pts.push(new THREE.Vector2(rad, h * 0.55));
    pts.push(new THREE.Vector2(rad * 0.9, h * 0.65));
    pts.push(new THREE.Vector2(rad * 0.3, h * 0.75));
    pts.push(new THREE.Vector2(rad * 0.3, h * 0.95));
    pts.push(new THREE.Vector2(rad * 0.35, h * 0.96));
    pts.push(new THREE.Vector2(rad * 0.35, h));
    pts.push(new THREE.Vector2(0, h));
    return new THREE.LatheGeometry(pts, 32);
};

// browser storage
function saveToLocalStorage() {
    const data = cellars.map(c => c.config);
    localStorage.setItem('wineCellarConfig', JSON.stringify(data));
}

class Cellar {
    constructor(id, name, savedConfig = null) {
        this.id = id;
        this.name = name;
        this.group = new THREE.Group();
        this.localLightGroup = new THREE.Group();
        
        cellars.push(this);

        // default settings
        this.config = savedConfig || {
            width: 10,
            height: 5,
            depth: 3,
            orientation: 'forward',
            lightIntensity: 250,
            posX: ((cellars.length - 1) * 12) - 6,
            posY: 0,
            posZ: 0,
            rotY: 0,
            bottle: { radius: 0.35, height: 2.5, hSpacing: 0.7, vSpacing: 0.5, zSpacing: 0.2 },
            shelf: { thickness: 0.03, wireDensity: 12 },
            colors: { bottle: 0x334433, shelf: 0xcccccc, highlight: 0xa12c44 }
        };

        this.folder = gui.addFolder(`Cellar: ${this.name}`);
        this.setupGUI();
        this.refresh();
        
        this.group.add(this.localLightGroup);
        worldGroup.add(this.group);
    }

    // menu controls
    setupGUI() {
        const onChange = () => { this.refresh(); saveToLocalStorage(); };
        const onTransform = () => { this.updateTransform(); saveToLocalStorage(); };

        this.folder.open();

        const structFolder = this.folder.addFolder('Structure');
        structFolder.add(this.config, 'orientation', ['upright', 'side', 'forward']).name('Orientation').onChange(onChange);
        structFolder.add(this.config, 'width', 1, 30, 1).name('Width').onChange(onChange);
        structFolder.add(this.config, 'height', 1, 20, 1).name('Height').onChange(onChange);
        structFolder.add(this.config, 'depth', 1, 10, 1).name('Depth').onChange(onChange);
        structFolder.close();

        const spacingFolder = this.folder.addFolder('Spacing & Sizing');
        spacingFolder.add(this.config.bottle, 'hSpacing', 0, 2).name('Horizontal').onChange(onChange);
        spacingFolder.add(this.config.bottle, 'vSpacing', 0, 2).name('Vertical').onChange(onChange);
        spacingFolder.add(this.config.bottle, 'zSpacing', 0, 2).name('Depth Buffer').onChange(onChange);
        spacingFolder.add(this.config.bottle, 'radius', 0.1, 1).name('Bottle Radius').onChange(onChange);
        spacingFolder.close();

        const styleFolder = this.folder.addFolder('Styles & Lights');
        styleFolder.addColor(this.config.colors, 'shelf').name('Shelf Color').onChange(onChange);
        styleFolder.addColor(this.config.colors, 'bottle').name('Bottle Color').onChange(onChange);
        styleFolder.add(this.config, 'lightIntensity', 0, 1000).name('Light Intensity').onChange(onChange);
        styleFolder.close();

        const moveFolder = this.folder.addFolder('Placement');
        moveFolder.add(this.config, 'posX', -100, 100).name('X').onChange(onTransform);
        moveFolder.add(this.config, 'posY', -20, 20).name('Y').onChange(onTransform);
        moveFolder.add(this.config, 'posZ', -100, 100).name('Z').onChange(onTransform);
        moveFolder.add(this.config, 'rotY', 0, Math.PI * 2).name('Rotate Y').onChange(onTransform);
        moveFolder.close();
    }

    // spatial updates
    updateTransform() {
        this.group.position.set(this.config.posX, this.config.posY, this.config.posZ);
        this.group.rotation.y = this.config.rotY;
    }

    // rebuild scene
    refresh() {
        // clear gpu data
        this.group.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });

        // clean group
        const toRemove = [];
        this.group.children.forEach(child => {
            if (child !== this.localLightGroup) toRemove.push(child);
        });
        toRemove.forEach(child => this.group.remove(child));
        this.localLightGroup.clear();

        this.updateTransform();

        // sizing math
        const bDiam = this.config.bottle.radius * 2;
        const slotW = (this.config.orientation === 'side') ? this.config.bottle.height : bDiam;
        const slotH = (this.config.orientation === 'upright') ? this.config.bottle.height : bDiam;
        const slotD = (this.config.orientation === 'forward') ? this.config.bottle.height : bDiam;

        const shelfDepth = (this.config.depth * slotD) + (this.config.depth * this.config.bottle.zSpacing) + 0.5;
        const totalWidth = (slotW * this.config.width) + (this.config.bottle.hSpacing * (this.config.width - 1)) + 1;
        const totalHeight = (slotH + this.config.bottle.vSpacing + this.config.shelf.thickness) * this.config.height;

        const dim = { totalWidth, totalHeight, shelfDepth, slotW, slotH, slotD };

        this.createStructure(dim);
        this.createLighting(dim);
        updateRaycastList();
    }

    // local spot lights
    createLighting({ totalWidth, totalHeight, shelfDepth }) {
        const numLights = Math.max(1, Math.ceil(totalWidth / 8)); 
        for (let i = 0; i < numLights; i++) {
            let lightX = (numLights === 1) ? 0 : (i - (numLights - 1) / 2) * (totalWidth / numLights);
            const spotLight = new THREE.SpotLight(0xffffff, this.config.lightIntensity * 1.5, 60, Math.PI / 4, 0.5, 1);
            spotLight.position.set(lightX, totalHeight + 8, shelfDepth + 5);
            
            const target = new THREE.Object3D();
            target.position.set(lightX, totalHeight / 2, 0);
            
            spotLight.target = target;
            spotLight.castShadow = true;
            spotLight.shadow.mapSize.set(1024, 1024);
            
            this.localLightGroup.add(spotLight, target);
        }
    }

    // build meshes
    createStructure({ totalWidth, shelfDepth, slotW, slotH, slotD }) {
        const bottleGeoLocal = createBottleGeometry(this.config.bottle.radius, this.config.bottle.height);
        
        const cellarBottleMat = new THREE.MeshStandardMaterial({ 
            color: this.config.colors.bottle, 
            roughness: 0.1, 
            metalness: 0.5 
        });

        const localWireMat = wireMat.clone();
        localWireMat.color.setHex(this.config.colors.shelf);

        // loop layers
        for (let h = 0; h < this.config.height; h++) {
            const y = h * (slotH + this.config.bottle.vSpacing + this.config.shelf.thickness);
            
            // vertical wires
            const longWireGeo = new THREE.CylinderGeometry(this.config.shelf.thickness/1.5, this.config.shelf.thickness/1.5, shelfDepth, 8);
            for (let i = 0; i <= this.config.width; i++) {
                const wire = new THREE.Mesh(longWireGeo, localWireMat);
                wire.rotation.x = Math.PI / 2;
                wire.position.set(-(totalWidth/2) + (i * (totalWidth / this.config.width)), y, 0);
                wire.castShadow = true;
                this.group.add(wire);
            }

            // horizontal wires
            const transWireGeo = new THREE.CylinderGeometry(this.config.shelf.thickness/2, this.config.shelf.thickness/2, totalWidth, 8);
            const crossWireCount = Math.floor(shelfDepth * this.config.shelf.wireDensity);
            for (let j = 0; j <= crossWireCount; j++) {
                const wire = new THREE.Mesh(transWireGeo, localWireMat);
                wire.rotation.z = Math.PI / 2;
                wire.position.set(0, y + this.config.shelf.thickness/2, -(shelfDepth/2) + (j * (shelfDepth/crossWireCount)));
                wire.castShadow = true;
                this.group.add(wire);
            }

            // fill bottles
            for (let w = 0; w < this.config.width; w++) {
                for (let d = 0; d < this.config.depth; d++) {
                    const bottle = new THREE.Mesh(bottleGeoLocal, cellarBottleMat);
                    const xform = this.getBottleXform(w, h, d, y, totalWidth, shelfDepth, slotW, slotD);
                    
                    bottle.position.set(...xform.pos);
                    bottle.rotation.set(...xform.rot);
                    bottle.castShadow = bottle.receiveShadow = true;
                    
                    const invertedDepth = this.config.depth - d;
                    // interactive data
                    bottle.userData = { 
                        originalMaterial: cellarBottleMat,
                        highlightColor: this.config.colors.highlight,
                        cellarId: this.name,
                        row: h + 1, col: w + 1, depth: invertedDepth,
                        wineName: `Wine ${this.name}-R${h+1}C${w+1}D${invertedDepth}`,
                        vintage: `20${10 + h + w + d}`
                    };

                    this.group.add(bottle);
                }
            }
        }
    }

    // positioning helper
    getBottleXform(w, h, d, yBase, totalWidth, shelfDepth, slotW, slotD) {
        const zStart = -shelfDepth / 2 + 0.4;
        const xBase = -(totalWidth / 2) + 0.5;
        const out = { pos: [0, 0, 0], rot: [0, 0, 0] };

        if (this.config.orientation === 'forward') {
            out.pos = [xBase + this.config.bottle.radius + w * (slotW + this.config.bottle.hSpacing), yBase + this.config.shelf.thickness + this.config.bottle.radius, zStart + (d * (this.config.bottle.height + this.config.bottle.zSpacing))];
            out.rot = [Math.PI / 2, 0, 0];
        } else if (this.config.orientation === 'side') {
            out.pos = [xBase + w * (slotW + this.config.bottle.hSpacing), yBase + this.config.shelf.thickness + this.config.bottle.radius, zStart + (d * (slotD + this.config.bottle.zSpacing)) + this.config.bottle.radius];
            out.rot = [0, 0, -Math.PI / 2];
        } else {
            out.pos = [xBase + this.config.bottle.radius + w * (slotW + this.config.bottle.hSpacing), yBase + this.config.shelf.thickness, zStart + (d * (slotD + this.config.bottle.zSpacing)) + this.config.bottle.radius];
            out.rot = [0, 0, 0];
        }
        return out;
    }
}

// setup engine
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x181818);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    
    // mobile check
    if (window.innerWidth < window.innerHeight) {
        camera.position.set(0, 15, 45); 
        camera.fov = 80;
    } else {
        camera.position.set(0, 15, 35);
        camera.fov = 75;
    }
    camera.updateProjectionMatrix();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 5, 0); 

    scene.add(worldGroup);
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(1000, 1000), 
        new THREE.MeshStandardMaterial({color: 0x111111, roughness: 0.2})
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.05;
    floor.receiveShadow = true;
    scene.add(floor);

    gui = new GUI();
    const globalActions = {
        addCellar: (passedConfig = null) => {
            let finalConfig = null;
            if (!passedConfig && cellars.length > 0) {
                const lastCellar = cellars[cellars.length - 1];
                finalConfig = JSON.parse(JSON.stringify(lastCellar.config));
                finalConfig.posX += 12; 
            } else if (passedConfig) {
                finalConfig = passedConfig;
            }
            const name = `Cellar_${cellars.length + 1}`;
            new Cellar(cellars.length, name, finalConfig);
            saveToLocalStorage();
        },
        resetAll: () => {
            if (confirm("Are you sure? This will delete all cellars and reset the app.")) {
                localStorage.removeItem('wineCellarConfig');
                location.reload();
            }
        }
    };

    gui.add(globalActions, 'addCellar').name('＋ Add New Cellar');

    // restore state
    const saved = localStorage.getItem('wineCellarConfig');
    if (saved) {
        const configs = JSON.parse(saved);
        configs.forEach(conf => globalActions.addCellar(conf));
    } else {
        globalActions.addCellar();
    }

    gui.add(globalActions, 'resetAll').name('⚠ Reset All');

    raycaster = new THREE.Raycaster();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onWindowResize);
}

// sync bottles
function updateRaycastList() {
    allBottles = [];
    cellars.forEach(c => {
        c.group.children.forEach(child => {
            if (child.userData && child.userData.wineName) allBottles.push(child);
        });
    });
}

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

// handle window
function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    
    if (aspect < 1) { 
        camera.position.z = 45; 
        camera.fov = 80;
    } else {
        camera.position.z = 35; 
        camera.fov = 75;
    }

    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// render loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // logic start
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(allBottles);
    const infoDiv = document.getElementById('bottleInfo');

    if (intersects.length > 0) {
        const target = intersects[0].object;
        if (INTERSECTED_BOTTLE !== target) {
            if (INTERSECTED_BOTTLE) INTERSECTED_BOTTLE.material = INTERSECTED_BOTTLE.userData.originalMaterial;
            
            INTERSECTED_BOTTLE = target;
            const highlightMat = INTERSECTED_BOTTLE.userData.originalMaterial.clone();
            highlightMat.color.setHex(INTERSECTED_BOTTLE.userData.highlightColor);
            INTERSECTED_BOTTLE.material = highlightMat;

            // update ui
            if (infoDiv) {
                infoDiv.innerHTML = `
                    <strong>Cellar:</strong> ${target.userData.cellarId}<br>
                    <strong>Pos:</strong> R${target.userData.row} C${target.userData.col} D${target.userData.depth}<br>
                    <strong>Wine:</strong> ${target.userData.wineName}<br>
                    <strong>Vintage:</strong> ${target.userData.vintage}
                `;
                infoDiv.classList.add('active');
            }
        }
    } else if (INTERSECTED_BOTTLE) {
        INTERSECTED_BOTTLE.material = INTERSECTED_BOTTLE.userData.originalMaterial;
        INTERSECTED_BOTTLE = null;
        if (infoDiv) infoDiv.classList.remove('active');
    }
    renderer.render(scene, camera);
}

// run app
init();
animate();