/**
 * Message Matching Utility
 * Matches user messages to intents and handles variations
 */

/**
 * Normalize text for matching
 * @param {string} text - Input text
 * @returns {string} Normalized text
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Check if message is a greeting (Hello, Hi, etc.)
 * @param {string} message - User message
 * @returns {boolean} True if greeting
 */
function isGreeting(message) {
  const normalized = normalizeText(message);
  const greetingPatterns = [
    'hello', 'hi', 'hey', 'hii', 'hiii', 'hey there', 'hi there',
    'good morning', 'good afternoon', 'good evening', 'gm', 'ga', 'ge',
    'namaste', 'namaskar', 'greetings', 'greeting'
  ];
  
  return greetingPatterns.some(pattern => normalized === pattern || normalized.startsWith(pattern + ' '));
}

/**
 * Check if message matches "Yes" intent
 * @param {string} message - User message
 * @returns {boolean} True if yes
 */
function isYes(message) {
  const normalized = normalizeText(message);
  const yesPatterns = [
    'yes', 'y', 'ya', 'yeah', 'yep', 'ok', 'okay', 'sure', 'alright',
    'correct', 'right', 'absolutely', 'definitely', 'of course',
    'i want', 'i would like', 'please', 'go ahead', 'continue',
    'proceed', 'lets go', 'lets do it', 'sounds good'
  ];
  
  return yesPatterns.some(pattern => normalized.includes(pattern));
}

/**
 * Check if message matches "No" intent
 * @param {string} message - User message
 * @returns {boolean} True if no
 */
function isNo(message) {
  const normalized = normalizeText(message);
  const noPatterns = [
    'no', 'n', 'nah', 'nope', 'not', 'dont', "don't", 'never',
    'skip', 'cancel', 'exit', 'stop', 'quit', 'not interested',
    'not now', 'maybe later', 'no thanks', 'no thank you'
  ];
  
  return noPatterns.some(pattern => normalized.includes(pattern));
}

/**
 * Extract menu option from message
 * @param {string} message - User message
 * @returns {number|null} Option number (1-4) or null
 */
function getMenuOption(message) {
  const normalized = normalizeText(message);
  
  // Direct number match
  const numberMatch = normalized.match(/^(\d+)/);
  if (numberMatch) {
    const num = parseInt(numberMatch[1]);
    if (num >= 1 && num <= 4) return num;
  }
  
  // Text pattern matching
  const patterns = {
    1: ['holiday', 'holidays', 'travel', 'trip', 'tour', 'vacation', 'one', '1st', 'first'],
    2: ['event', 'events', 'activity', 'activities', 'two', '2nd', 'second'],
    3: ['health', 'wellness', 'care', 'medical', 'doctor', 'three', '3rd', 'third'],
    4: ['community', 'group', 'social', 'connect', 'four', '4th', 'fourth']
  };
  
  for (const [option, keywords] of Object.entries(patterns)) {
    if (keywords.some(keyword => normalized.includes(keyword))) {
      return parseInt(option);
    }
  }
  
  return null;
}

/**
 * Extract name from message
 * @param {string} message - User message
 * @returns {string|null} Extracted name or null
 */
function extractName(message) {
  if (!message || typeof message !== 'string') return null;
  
  const trimmed = message.trim();
  
  // Basic validation: name should be at least 2 characters
  if (trimmed.length < 2) return null;
  
  // Remove common prefixes/suffixes
  const cleaned = trimmed
    .replace(/^(my name is|i am|i'm|this is|name is|i am called|call me)\s+/i, '')
    .trim();
  
  // Name should not be too long (reasonable limit)
  if (cleaned.length > 100) return null;
  
  // Name should contain at least one letter
  if (!/[a-zA-Z]/.test(cleaned)) return null;
  
  return cleaned || null;
}

/**
 * Extract DOB from message
 * @param {string} message - User message
 * @returns {string|null} DOB in DD-MM-YYYY format or null
 */
function extractDOB(message) {
  if (!message || typeof message !== 'string') return null;
  
  const trimmed = message.trim();
  
  // Pattern: DD-MM-YYYY or DD/MM/YYYY
  const patterns = [
    /(\d{2})[-/](\d{2})[-/](\d{4})/,  // DD-MM-YYYY or DD/MM/YYYY
    /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/  // D-M-YYYY or D/M/YYYY
  ];
  
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];
      
      // Basic validation
      const dayNum = parseInt(day);
      const monthNum = parseInt(month);
      const yearNum = parseInt(year);
      
      if (dayNum >= 1 && dayNum <= 31 && 
          monthNum >= 1 && monthNum <= 12 && 
          yearNum >= 1900 && yearNum <= new Date().getFullYear()) {
        return `${day}-${month}-${year}`;
      }
    }
  }
  
  return null;
}

/**
 * Extract city from message
 * @param {string} message - User message
 * @returns {string|null} City name or null
 */
function extractCity(message) {
  if (!message || typeof message !== 'string') return null;
  
  const trimmed = message.trim();
  
  // Remove common prefixes
  const cleaned = trimmed
    .replace(/^(i live in|i am from|i am in|city is|my city is|located in|based in)\s+/i, '')
    .trim();
  
  // Basic validation
  if (cleaned.length < 2 || cleaned.length > 100) return null;
  
  // Should contain at least one letter
  if (!/[a-zA-Z]/.test(cleaned)) return null;
  
  return cleaned || null;
}

/**
 * Match message to conversation step intent
 * @param {string} message - User message
 * @param {string} currentStep - Current conversation step
 * @param {boolean} isFirstMessage - Whether this is the first message from user
 * @returns {object} Match result with intent and extracted data
 */
function matchMessageIntent(message, currentStep, isFirstMessage = false) {
  const normalized = normalizeText(message);
  
  const result = {
    intent: null,
    data: {},
    confidence: 0
  };
  
  // Check for greeting on first message or when in greeting step
  if (isFirstMessage || currentStep === 'pre_check' || currentStep === 'greeting') {
    if (isGreeting(message)) {
      result.intent = 'greeting';
      result.confidence = 0.95;
      return result;
    }
  }
  
  switch (currentStep) {
    case 'pre_check':
    case 'greeting':
      if (isYes(message)) {
        result.intent = 'yes';
        result.confidence = 0.9;
      } else if (isNo(message)) {
        result.intent = 'no';
        result.confidence = 0.9;
      } else if (isGreeting(message)) {
        result.intent = 'greeting';
        result.confidence = 0.95;
      } else {
        result.intent = 'unknown';
        result.confidence = 0.1;
      }
      break;
    
    case 'collect_name':
      const name = extractName(message);
      if (name) {
        result.intent = 'provide_name';
        result.data = { name };
        result.confidence = 0.8;
      } else {
        result.intent = 'invalid';
        result.confidence = 0.2;
      }
      break;
    
    case 'collect_dob':
      const dob = extractDOB(message);
      if (dob) {
        result.intent = 'provide_dob';
        result.data = { dob };
        result.confidence = 0.9;
      } else {
        result.intent = 'invalid';
        result.confidence = 0.2;
      }
      break;
    
    case 'collect_city':
      const city = extractCity(message);
      if (city) {
        result.intent = 'provide_city';
        result.data = { city };
        result.confidence = 0.8;
      } else {
        result.intent = 'invalid';
        result.confidence = 0.2;
      }
      break;
    
    case 'age_under_50':
      if (isYes(message)) {
        result.intent = 'yes';
        result.confidence = 0.9;
      } else if (isNo(message)) {
        result.intent = 'no';
        result.confidence = 0.9;
      } else {
        result.intent = 'unknown';
        result.confidence = 0.1;
      }
      break;
    
    case 'registered':
      const option = getMenuOption(message);
      if (option) {
        result.intent = 'menu_option';
        result.data = { option };
        result.confidence = 0.9;
      } else {
        result.intent = 'unknown';
        result.confidence = 0.1;
      }
      break;
    
    case 'holidays':
    case 'events':
    case 'health':
    case 'community':
      if (isYes(message)) {
        result.intent = 'yes';
        result.confidence = 0.9;
      } else if (isNo(message)) {
        result.intent = 'no';
        result.confidence = 0.9;
      } else {
        result.intent = 'unknown';
        result.confidence = 0.1;
      }
      break;
    
    default:
      result.intent = 'unknown';
      result.confidence = 0.1;
  }
  
  return result;
}

/**
 * Check if message contains keywords that might need human escalation
 * @param {string} message - User message
 * @returns {boolean} True if should escalate
 */
function shouldEscalate(message) {
  const normalized = normalizeText(message);
  
  const escalationKeywords = [
    'help', 'support', 'agent', 'human', 'person', 'talk to',
    'complaint', 'issue', 'problem', 'error', 'wrong', 'not working',
    'urgent', 'emergency', 'asap', 'immediately', 'now',
    'cancel', 'refund', 'money', 'payment', 'price', 'cost', 'fee',
    'contact', 'phone', 'number', 'call me', 'speak with'
  ];
  
  return escalationKeywords.some(keyword => normalized.includes(keyword));
}

module.exports = {
  normalizeText,
  isGreeting,
  isYes,
  isNo,
  getMenuOption,
  extractName,
  extractDOB,
  extractCity,
  matchMessageIntent,
  shouldEscalate
};

