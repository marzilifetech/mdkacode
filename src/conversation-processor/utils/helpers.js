/**
 * Helper utility functions
 */

/**
 * Calculate age from date of birth (DD-MM-YYYY format)
 * @param {string} dob - Date of birth in DD-MM-YYYY format
 * @returns {number|null} Age in years or null if invalid
 */
function calculateAge(dob) {
  try {
    const [day, month, year] = dob.split('-').map(Number);
    if (!day || !month || !year) return null;
    
    const birthDate = new Date(year, month - 1, day);
    const today = new Date();
    
    if (birthDate > today) return null; // Future date
    
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Error calculating age',
      dob,
      error: error.message
    }));
    return null;
  }
}

/**
 * Validate date of birth format (DD-MM-YYYY)
 * @param {string} dob - Date of birth string
 * @returns {boolean} True if valid format
 */
function isValidDOB(dob) {
  if (!dob || typeof dob !== 'string') return false;
  
  const pattern = /^(\d{2})-(\d{2})-(\d{4})$/;
  if (!pattern.test(dob)) return false;
  
  const [day, month, year] = dob.split('-').map(Number);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > new Date().getFullYear()) {
    return false;
  }
  
  const date = new Date(year, month - 1, day);
  return date.getDate() === day && date.getMonth() === month - 1 && date.getFullYear() === year;
}

/**
 * Normalize user input (trim, lowercase for comparison)
 * @param {string} input - User input
 * @returns {string} Normalized input
 */
function normalizeInput(input) {
  if (!input || typeof input !== 'string') return '';
  return input.trim().toLowerCase();
}

/**
 * Check if input is "yes"
 * @param {string} input - User input
 * @returns {boolean} True if yes
 */
function isYes(input) {
  const normalized = normalizeInput(input);
  return ['yes', 'y', 'ya', 'yeah', 'yep', 'ok', 'okay', 'sure'].includes(normalized);
}

/**
 * Check if input is "no"
 * @param {string} input - User input
 * @returns {boolean} True if no
 */
function isNo(input) {
  const normalized = normalizeInput(input);
  return ['no', 'n', 'nah', 'nope', 'not'].includes(normalized);
}

/**
 * Check if input is a menu option (1-4)
 * @param {string} input - User input
 * @returns {number|null} Option number or null
 */
function getMenuOption(input) {
  const normalized = normalizeInput(input);
  const option = parseInt(normalized.trim());
  if (option >= 1 && option <= 4) {
    return option;
  }
  
  // Check for emoji or text
  if (normalized.includes('holiday') || normalized.includes('1')) return 1;
  if (normalized.includes('event') || normalized.includes('2')) return 2;
  if (normalized.includes('health') || normalized.includes('3')) return 3;
  if (normalized.includes('community') || normalized.includes('4')) return 4;
  
  return null;
}

/**
 * Generate conversation ID
 * @param {string} mobile - Mobile number
 * @returns {string} Conversation ID
 */
function generateConversationId(mobile) {
  return `conv_${Date.now()}_${mobile.slice(-4)}`;
}

/**
 * Extract text from message (handles different message types)
 * @param {object} messageData - Message data from payload
 * @returns {string} Message text
 */
function extractMessageText(messageData) {
  if (messageData.text) {
    return messageData.text;
  }
  if (messageData.type === 'image' && messageData.image && messageData.image.caption) {
    return messageData.image.caption;
  }
  return '';
}

module.exports = {
  calculateAge,
  isValidDOB,
  normalizeInput,
  isYes,
  isNo,
  getMenuOption,
  generateConversationId,
  extractMessageText
};

