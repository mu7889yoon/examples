/**
 * Physics Engine
 * Manages Cannon.js physics simulation for dice rolling
 */

class PhysicsEngine {
  constructor() {
    this.world = null;
    this.diceBody = null;
    this.floorBody = null;
    this.dice = null;
    this.isRolling = false;
    this.restThreshold = 0.1; // Velocity threshold for rest detection
    this.restTime = 0; // Time the dice has been at rest
    this.restTimeRequired = 0.5; // Seconds required at rest to consider stopped
    this.rollStartTime = 0;
    this.maxRollTime = 10000; // 10 seconds timeout
    this.lastTime = 0;
  }

  /**
   * Initialize the Cannon.js physics world
   */
  init() {
    // Create physics world
    this.world = new CANNON.World();
    this.world.gravity.set(0, -9.82, 0); // Earth gravity
    this.world.broadphase = new CANNON.NaiveBroadphase();
    this.world.solver.iterations = 10;
    
    // Add damping to slow down objects over time
    this.world.defaultContactMaterial.friction = 0.3;
    this.world.defaultContactMaterial.restitution = 0.5;
    
    // Create floor
    this.createFloor();
  }

  /**
   * Create the physics body for the floor
   */
  createFloor() {
    const floorShape = new CANNON.Plane();
    this.floorBody = new CANNON.Body({
      mass: 0, // Static body
      shape: floorShape,
      material: new CANNON.Material()
    });
    
    // Rotate to be horizontal (plane faces up by default in Cannon.js)
    this.floorBody.quaternion.setFromAxisAngle(
      new CANNON.Vec3(1, 0, 0),
      -Math.PI / 2
    );
    
    this.world.addBody(this.floorBody);
  }

  /**
   * Create physics body for a dice
   * @param {Dice} dice - The dice object with mesh
   */
  createDiceBody(dice) {
    this.dice = dice;
    
    // Remove old body if exists
    if (this.diceBody) {
      this.world.removeBody(this.diceBody);
    }

    // Create appropriate shape based on dice type
    let shape;
    if (dice.type === 'd8') {
      // For octahedron, use a sphere approximation for simplicity
      // A proper octahedron would require ConvexPolyhedron
      shape = new CANNON.Sphere(1);
    } else {
      // Box shape for d6
      shape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
    }
    
    // Create body with mass
    this.diceBody = new CANNON.Body({
      mass: 1,
      shape: shape,
      material: new CANNON.Material()
    });
    
    // Set initial position above the floor
    this.diceBody.position.set(0, 5, 0);
    
    // Add damping to slow down rotation and movement
    this.diceBody.linearDamping = 0.3;
    this.diceBody.angularDamping = 0.3;
    
    this.world.addBody(this.diceBody);
    
    // Sync initial position with Three.js mesh
    this.syncMeshWithBody();
  }

  /**
   * Throw the dice with random force and torque
   */
  throwDice() {
    if (!this.diceBody) return;
    
    this.isRolling = true;
    this.restTime = 0;
    this.rollStartTime = Date.now();
    
    // Reset position and velocity
    this.diceBody.position.set(0, 5, 0);
    this.diceBody.velocity.set(0, 0, 0);
    this.diceBody.angularVelocity.set(0, 0, 0);
    this.diceBody.quaternion.set(0, 0, 0, 1);
    
    // Apply random initial force (throw)
    const force = new CANNON.Vec3(
      (Math.random() - 0.5) * 5,  // Random X force
      Math.random() * 2,           // Slight upward force
      (Math.random() - 0.5) * 5   // Random Z force
    );
    this.diceBody.applyImpulse(force, this.diceBody.position);
    
    // Apply random torque (spin)
    const torque = new CANNON.Vec3(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10
    );
    this.diceBody.angularVelocity.copy(torque);
  }

  /**
   * Update physics simulation
   * @param {number} deltaTime - Time since last update in seconds
   */
  update(deltaTime) {
    if (!this.world) return;
    
    // Step the physics world
    this.world.step(1 / 60, deltaTime, 3);
    
    // Sync Three.js mesh with physics body
    this.syncMeshWithBody();
    
    // Check for rest state if rolling
    if (this.isRolling) {
      this.checkRestState(deltaTime);
      this.checkTimeout();
    }
  }

  /**
   * Sync Three.js mesh position and rotation with physics body
   */
  syncMeshWithBody() {
    if (!this.dice || !this.dice.mesh || !this.diceBody) return;
    
    // Sync position
    this.dice.mesh.position.copy(this.diceBody.position);
    
    // Sync rotation
    this.dice.mesh.quaternion.copy(this.diceBody.quaternion);
  }

  /**
   * Check if dice is at rest
   * @param {number} deltaTime - Time since last check
   */
  checkRestState(deltaTime) {
    if (!this.diceBody) return;
    
    // Calculate total velocity (linear + angular)
    const linearSpeed = this.diceBody.velocity.length();
    const angularSpeed = this.diceBody.angularVelocity.length();
    const totalSpeed = linearSpeed + angularSpeed;
    
    // Check if below rest threshold
    if (totalSpeed < this.restThreshold) {
      this.restTime += deltaTime;
      
      // If at rest for required time, stop rolling
      if (this.restTime >= this.restTimeRequired) {
        this.stopRolling();
      }
    } else {
      // Reset rest timer if moving again
      this.restTime = 0;
    }
  }

  /**
   * Check if roll has exceeded maximum time
   */
  checkTimeout() {
    const elapsed = Date.now() - this.rollStartTime;
    
    if (elapsed > this.maxRollTime) {
      // Force stop after timeout
      this.forceStop();
    }
  }

  /**
   * Force the dice to stop (used for timeout)
   */
  forceStop() {
    if (!this.diceBody) return;
    
    // Zero out all velocities
    this.diceBody.velocity.set(0, 0, 0);
    this.diceBody.angularVelocity.set(0, 0, 0);
    
    // Ensure dice is on the floor
    if (this.diceBody.position.y < 0.5) {
      this.diceBody.position.y = 0.5;
    }
    
    this.stopRolling();
  }

  /**
   * Stop rolling and mark as at rest
   */
  stopRolling() {
    this.isRolling = false;
    this.restTime = 0;
    
    // Zero out velocities to ensure complete stop
    if (this.diceBody) {
      this.diceBody.velocity.set(0, 0, 0);
      this.diceBody.angularVelocity.set(0, 0, 0);
    }
  }

  /**
   * Check if dice is currently at rest
   * @returns {boolean} True if dice is at rest
   */
  isAtRest() {
    return !this.isRolling;
  }

  /**
   * Get the current result (upward facing value)
   * @returns {string|null} The face value or null if no dice
   */
  getResult() {
    if (!this.dice) return null;
    return this.dice.getCurrentFace();
  }

  /**
   * Reset the dice to initial position
   */
  reset() {
    if (this.diceBody) {
      this.diceBody.position.set(0, 5, 0);
      this.diceBody.velocity.set(0, 0, 0);
      this.diceBody.angularVelocity.set(0, 0, 0);
      this.diceBody.quaternion.set(0, 0, 0, 1);
    }
    
    this.isRolling = false;
    this.restTime = 0;
    
    this.syncMeshWithBody();
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.diceBody) {
      this.world.removeBody(this.diceBody);
      this.diceBody = null;
    }
    
    if (this.floorBody) {
      this.world.removeBody(this.floorBody);
      this.floorBody = null;
    }
    
    this.world = null;
    this.dice = null;
  }
}
