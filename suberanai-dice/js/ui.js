/**
 * UI Controller
 * Manages user interface interactions and coordinates between components
 */

class UIController {
  /**
   * @param {SceneManager} sceneManager - The 3D scene manager
   * @param {PhysicsEngine} physicsEngine - The physics engine
   * @param {SettingsManager} settingsManager - The settings manager
   */
  constructor(sceneManager, physicsEngine, settingsManager) {
    this.sceneManager = sceneManager;
    this.physicsEngine = physicsEngine;
    this.settingsManager = settingsManager;
    
    this.currentDice = null;
    
    // DOM elements
    this.elements = {
      rollBtn: document.getElementById('roll-btn'),
      settingsBtn: document.getElementById('settings-btn'),
      settingsModal: document.getElementById('settings-modal'),
      closeSettings: document.getElementById('close-settings'),
      saveSettings: document.getElementById('save-settings'),
      faceInputsContainer: document.getElementById('face-inputs-container'),
      resultDisplay: document.getElementById('result-display'),
      resultValue: document.getElementById('result-value'),
      rollAgainBtn: document.getElementById('roll-again-btn')
    };
  }

  /**
   * Initialize the UI controller and set up event handlers
   */
  init() {
    // Create initial dice
    this.createDice();
    
    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Set up all event handlers
   */
  setupEventHandlers() {
    // Roll button
    this.elements.rollBtn.addEventListener('click', () => {
      this.rollDice();
    });
    
    // Settings button
    this.elements.settingsBtn.addEventListener('click', () => {
      this.showSettings();
    });
    
    // Close settings
    this.elements.closeSettings.addEventListener('click', () => {
      this.hideSettings();
    });
    
    // Save settings
    this.elements.saveSettings.addEventListener('click', () => {
      this.saveSettingsAndClose();
    });
    
    // Roll again button
    this.elements.rollAgainBtn.addEventListener('click', () => {
      this.hideResult();
      this.enableRollButton();
    });
    
    // Close modal when clicking outside
    this.elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.elements.settingsModal) {
        this.hideSettings();
      }
    });
  }

  /**
   * Create a new dice
   */
  createDice() {
    // Remove old dice from scene
    if (this.currentDice && this.currentDice.mesh) {
      this.sceneManager.removeObject(this.currentDice.mesh);
      this.currentDice.dispose();
    }
    
    // Load face values
    const faceValues = this.settingsManager.loadFaceValues();
    
    // Create new dice
    this.currentDice = new Dice(faceValues);
    const mesh = this.currentDice.createMesh();
    
    // Add to scene
    this.sceneManager.addObject(mesh);
    
    // Create physics body
    this.physicsEngine.createDiceBody(this.currentDice);
  }

  /**
   * Roll the dice
   */
  rollDice() {
    // Disable roll button during animation
    this.disableRollButton();
    
    // Hide any previous result
    this.hideResult();
    
    // Throw the dice
    this.physicsEngine.throwDice();
    
    // Wait for dice to stop, then show result
    this.waitForResult();
  }

  /**
   * Wait for dice to stop rolling and show result
   */
  waitForResult() {
    const checkInterval = setInterval(() => {
      if (this.physicsEngine.isAtRest()) {
        clearInterval(checkInterval);
        
        // Get result
        const result = this.physicsEngine.getResult();
        
        // Show result
        this.showResult(result);
      }
    }, 100); // Check every 100ms
  }

  /**
   * Show the settings modal
   */
  showSettings() {
    // Generate face input fields
    this.updateFaceInputs();
    
    // Show modal
    this.elements.settingsModal.classList.remove('hidden');
  }

  /**
   * Hide the settings modal
   */
  hideSettings() {
    this.elements.settingsModal.classList.add('hidden');
  }

  /**
   * Update face input fields
   */
  updateFaceInputs() {
    const container = this.elements.faceInputsContainer;
    container.innerHTML = '';
    
    // Load current face values
    const faceValues = this.settingsManager.loadFaceValues();
    const faceCount = 6;
    
    // Create input field for each face
    for (let i = 0; i < faceCount; i++) {
      const faceGroup = document.createElement('div');
      faceGroup.className = 'face-input-group';
      
      const label = document.createElement('label');
      label.textContent = `面 ${i + 1}:`;
      label.htmlFor = `face-${i}`;
      
      const input = document.createElement('input');
      input.type = 'text';
      input.id = `face-${i}`;
      input.className = 'face-input';
      input.value = faceValues[i] || String(i + 1);
      input.placeholder = String(i + 1);
      input.maxLength = 30; // Allow up to 30 characters
      
      faceGroup.appendChild(label);
      faceGroup.appendChild(input);
      container.appendChild(faceGroup);
    }
  }

  /**
   * Save settings and close modal
   */
  saveSettingsAndClose() {
    // Collect face values from inputs
    const inputs = this.elements.faceInputsContainer.querySelectorAll('.face-input');
    const faceValues = [];
    
    inputs.forEach(input => {
      const value = input.value.trim();
      // Use default (face number) if empty
      faceValues.push(value || input.placeholder);
    });
    
    // Save to settings
    this.settingsManager.saveFaceValues(faceValues);
    
    // Update current dice with new values
    this.currentDice.updateFaceValues(faceValues);
    
    // Close modal
    this.hideSettings();
  }

  /**
   * Show the result display
   * @param {string} value - The result value to display
   */
  showResult(value) {
    this.elements.resultValue.textContent = value;
    this.elements.resultDisplay.classList.remove('hidden');
  }

  /**
   * Hide the result display
   */
  hideResult() {
    this.elements.resultDisplay.classList.add('hidden');
  }

  /**
   * Enable the roll button
   */
  enableRollButton() {
    this.elements.rollBtn.disabled = false;
    this.elements.rollBtn.textContent = '投げる';
  }

  /**
   * Disable the roll button
   */
  disableRollButton() {
    this.elements.rollBtn.disabled = true;
    this.elements.rollBtn.textContent = '投げています...';
  }
}
