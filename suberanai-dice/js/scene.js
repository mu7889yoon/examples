/**
 * Scene Manager
 * Manages the Three.js 3D environment including scene, camera, renderer, lighting, and floor
 */

class SceneManager {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.floor = null;
    this.animationId = null;
    this.animationCallbacks = [];
  }

  /**
   * Initialize the Three.js scene, camera, renderer, lighting, and floor
   */
  init() {
    // Create scene with darker casino-like background
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    // Create camera - top-down view like looking down at a casino table
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.camera.position.set(0, 12, 4);
    this.camera.lookAt(0, 0, 0);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Create green carpet floor
    this.createFloor();

    // Setup lighting
    this.setupLighting();

    // Setup resize handler
    window.addEventListener('resize', () => this.resize());

    // Start animation loop
    this.startAnimationLoop();
  }

  /**
   * Create the green carpet-like floor plane with texture
   */
  createFloor() {
    const floorGeometry = new THREE.PlaneGeometry(20, 20);
    
    // Create a canvas texture for carpet-like appearance
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Base green color
    ctx.fillStyle = '#1a4d0f';
    ctx.fillRect(0, 0, 512, 512);
    
    // Add noise/texture for carpet feel
    for (let i = 0; i < 10000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const brightness = Math.random() * 40 - 20;
      const green = Math.min(255, Math.max(0, 77 + brightness));
      ctx.fillStyle = `rgb(26, ${green}, 15)`;
      ctx.fillRect(x, y, 2, 2);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    
    const floorMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0x1a4d0f,
      roughness: 0.95,
      metalness: 0.0
    });
    
    this.floor = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0;
    this.floor.receiveShadow = true;
    
    this.scene.add(this.floor);
  }

  /**
   * Setup ambient and directional lighting
   */
  setupLighting() {
    // Ambient light for overall illumination - brighter
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(ambientLight);

    // Main directional light from above
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    
    // Configure shadow properties
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    
    this.scene.add(directionalLight);

    // Add point lights for better illumination from multiple angles
    const pointLight1 = new THREE.PointLight(0xffffff, 0.8, 50);
    pointLight1.position.set(-5, 8, 5);
    this.scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xffffff, 0.8, 50);
    pointLight2.position.set(5, 8, -5);
    this.scene.add(pointLight2);

    // Add hemisphere light for softer overall lighting
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    this.scene.add(hemisphereLight);
  }

  /**
   * Start the animation loop using requestAnimationFrame
   */
  startAnimationLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      
      // Execute all registered animation callbacks
      this.animationCallbacks.forEach(callback => callback());
      
      // Render the scene
      this.render();
    };
    
    animate();
  }

  /**
   * Stop the animation loop
   */
  stopAnimationLoop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Register a callback to be executed on each animation frame
   * @param {Function} callback - Function to call on each frame
   */
  onAnimationFrame(callback) {
    this.animationCallbacks.push(callback);
  }

  /**
   * Remove a registered animation callback
   * @param {Function} callback - Function to remove
   */
  removeAnimationCallback(callback) {
    const index = this.animationCallbacks.indexOf(callback);
    if (index > -1) {
      this.animationCallbacks.splice(index, 1);
    }
  }

  /**
   * Add a 3D object to the scene
   * @param {THREE.Object3D} mesh - Three.js object to add
   */
  addObject(mesh) {
    this.scene.add(mesh);
  }

  /**
   * Remove a 3D object from the scene
   * @param {THREE.Object3D} mesh - Three.js object to remove
   */
  removeObject(mesh) {
    this.scene.remove(mesh);
  }

  /**
   * Render the scene
   */
  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Handle window resize events
   */
  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    
    // Update camera aspect ratio
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    
    // Update renderer size
    this.renderer.setSize(width, height);
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.stopAnimationLoop();
    
    // Remove renderer from DOM
    if (this.renderer && this.renderer.domElement) {
      this.container.removeChild(this.renderer.domElement);
    }
    
    // Dispose of renderer
    if (this.renderer) {
      this.renderer.dispose();
    }
    
    // Remove resize listener
    window.removeEventListener('resize', this.resize);
  }
}
