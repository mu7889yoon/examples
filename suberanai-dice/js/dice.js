/**
 * Dice Model
 * Manages 3D dice model (d6) with custom face values
 */

class Dice {
  /**
   * @param {string[]} faceValues - Array of face values (6 elements)
   */
  constructor(faceValues) {
    this.faceValues = faceValues || this.getDefaultFaceValues();
    this.mesh = null;
    this.geometry = null;
    this.material = null;
  }

  /**
   * Get default face values
   * @returns {string[]} Default face values
   */
  getDefaultFaceValues() {
    // Order: Right(+X), Left(-X), Top(+Y), Bottom(-Y), Front(+Z), Back(-Z)
    return ['右', '左', '上', '下', '前', '後'];
  }

  /**
   * Create the 3D mesh for the dice
   * @returns {THREE.Mesh} The dice mesh
   */
  createMesh() {
    // Use RoundedBoxGeometry for better control
    // Parameters: width, height, depth, segments, radius
    const params = { width: 1, height: 1, depth: 1, radius: 0.1 };
    this.geometry = this.createRoundedBoxGeometry(
      params.width, 
      params.height, 
      params.depth, 
      params.radius
    );
    
    const materials = this.createFaceMaterials();
    this.mesh = new THREE.Mesh(this.geometry, materials);

    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    return this.mesh;
  }

  /**
   * Create a rounded box geometry with proper face ordering
   * @param {number} width - Width of the box
   * @param {number} height - Height of the box
   * @param {number} depth - Depth of the box
   * @param {number} radius - Radius of the rounded edges
   * @returns {THREE.BufferGeometry} Rounded box geometry
   */
  createRoundedBoxGeometry(width, height, depth, radius) {
    const geometry = new THREE.BoxGeometry(width, height, depth, 10, 10, 10);
    
    // Apply edge rounding by modifying vertices
    const positionAttribute = geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    
    for (let i = 0; i < positionAttribute.count; i++) {
      vertex.fromBufferAttribute(positionAttribute, i);
      
      // Calculate distance from center on each axis
      const dx = Math.abs(vertex.x) - (width / 2 - radius);
      const dy = Math.abs(vertex.y) - (height / 2 - radius);
      const dz = Math.abs(vertex.z) - (depth / 2 - radius);
      
      // If vertex is in corner/edge region, round it
      if (dx > 0 || dy > 0 || dz > 0) {
        const cornerDist = Math.sqrt(
          Math.max(0, dx) ** 2 + 
          Math.max(0, dy) ** 2 + 
          Math.max(0, dz) ** 2
        );
        
        if (cornerDist > 0) {
          const scale = (cornerDist - radius) / cornerDist;
          
          if (dx > 0) vertex.x = Math.sign(vertex.x) * (width / 2 - radius + Math.max(0, dx) * scale);
          if (dy > 0) vertex.y = Math.sign(vertex.y) * (height / 2 - radius + Math.max(0, dy) * scale);
          if (dz > 0) vertex.z = Math.sign(vertex.z) * (depth / 2 - radius + Math.max(0, dz) * scale);
        }
      }
      
      positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    
    geometry.computeVertexNormals();
    
    return geometry;
  }

  /**
   * Create materials with face textures
   * @returns {THREE.Material[]} Array of materials for each face
   */
  createFaceMaterials() {
    const materials = [];
    
    // BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z
    // Which corresponds to: Right, Left, Top, Bottom, Front, Back
    // We want: face values [0]=Right, [1]=Left, [2]=Top, [3]=Bottom, [4]=Front, [5]=Back
    for (let i = 0; i < 6; i++) {
      const texture = this.createFaceTexture(this.faceValues[i] || String(i + 1));
      const material = new THREE.MeshPhysicalMaterial({
        map: texture,
        color: 0xffffff, // White base to show texture properly
        metalness: 0.2,
        roughness: 0.15,
        transparent: true,
        opacity: 0.95,
        reflectivity: 0.8,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        emissive: 0x111111, // Slight glow to make text visible
        emissiveIntensity: 0.3
      });
      materials.push(material);
    }

    return materials;
  }

  /**
   * Create a texture for a single face with text
   * @param {string} text - Text to render on the face
   * @returns {THREE.CanvasTexture} Texture with rendered text
   */
  createFaceTexture(text) {
    const canvas = document.createElement('canvas');
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Fill with black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    // Draw white text - dynamically adjust font size to fit
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Start with a large font size and reduce until text fits
    let fontSize = 180;
    const maxWidth = size * 0.9; // 90% of canvas width for padding
    
    do {
      ctx.font = `bold ${fontSize}px Arial`;
      const metrics = ctx.measureText(text);
      
      if (metrics.width <= maxWidth) {
        break;
      }
      
      fontSize -= 5;
    } while (fontSize > 20);
    
    ctx.fillText(text, size / 2, size / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Update face values and regenerate textures
   * @param {string[]} values - New face values
   */
  updateFaceValues(values) {
    this.faceValues = values;
    
    if (this.mesh) {
      // Dispose old materials
      if (Array.isArray(this.mesh.material)) {
        this.mesh.material.forEach(mat => {
          if (mat.map) mat.map.dispose();
          mat.dispose();
        });
      }
      // Create new materials
      this.mesh.material = this.createFaceMaterials();
    }
  }

  /**
   * Get the current upward-facing face value
   * @returns {string} The value of the upward-facing face
   */
  getCurrentFace() {
    if (!this.mesh) return null;

    const upVector = new THREE.Vector3(0, 1, 0);
    const faceNormals = this.getFaceNormals();
    
    let maxDot = -Infinity;
    let faceIndex = 0;

    // Find which face normal is most aligned with the up vector
    faceNormals.forEach((normal, index) => {
      const worldNormal = normal.clone().applyQuaternion(this.mesh.quaternion);
      const dot = worldNormal.dot(upVector);
      
      if (dot > maxDot) {
        maxDot = dot;
        faceIndex = index;
      }
    });

    return this.faceValues[faceIndex];
  }

  /**
   * Get face normals for the dice geometry
   * @returns {THREE.Vector3[]} Array of face normal vectors
   */
  getFaceNormals() {
    // Box has 6 faces - order matches material array
    // Material order: Right, Left, Top, Bottom, Front, Back
    return [
      new THREE.Vector3(1, 0, 0),   // Right (face 0)
      new THREE.Vector3(-1, 0, 0),  // Left (face 1)
      new THREE.Vector3(0, 1, 0),   // Top (face 2)
      new THREE.Vector3(0, -1, 0),  // Bottom (face 3)
      new THREE.Vector3(0, 0, 1),   // Front (face 4)
      new THREE.Vector3(0, 0, -1)   // Back (face 5)
    ];
  }

  /**
   * Reset dice position and rotation
   */
  reset() {
    if (this.mesh) {
      this.mesh.position.set(0, 5, 0);
      this.mesh.rotation.set(0, 0, 0);
    }
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.geometry) {
      this.geometry.dispose();
    }
    
    if (this.mesh && this.mesh.material) {
      if (Array.isArray(this.mesh.material)) {
        this.mesh.material.forEach(mat => {
          if (mat.map) mat.map.dispose();
          mat.dispose();
        });
      } else {
        if (this.mesh.material.map) this.mesh.material.map.dispose();
        this.mesh.material.dispose();
      }
    }
  }
}
