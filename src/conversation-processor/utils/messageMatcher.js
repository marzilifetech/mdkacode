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
  
  // Exclude common greetings and short words that are not names
  const excludedWords = [
    'hello', 'hi', 'hey', 'hii', 'hiii', 'hey there', 'hi there',
    'good morning', 'good afternoon', 'good evening', 'gm', 'ga', 'ge',
    'namaste', 'namaskar', 'greetings', 'greeting',
    'yes', 'y', 'ya', 'yeah', 'yep', 'ok', 'okay', 'sure',
    'no', 'n', 'nah', 'nope', 'thanks', 'thank you'
  ];
  
  const normalized = trimmed.toLowerCase();
  if (excludedWords.includes(normalized)) {
    return null; // Don't treat greetings as names
  }
  
  // Patterns to extract name from various formats
  const namePatterns = [
    // "Hello My Name is Mayank" or "Hi My Name is Mayank"
    /(?:hello|hi|hey|greetings?|namaste|namaskar)[\s,]*my[\s]+name[\s]+is[\s]+([a-zA-Z\s]+)/i,
    // "My Name is Mayank" or "Name is Mayank"
    /(?:my[\s]+)?name[\s]+is[\s]+([a-zA-Z\s]+)/i,
    // "I am Mayank" or "I'm Mayank"
    /i[\s']*am[\s]+([a-zA-Z\s]+)/i,
    // "This is Mayank" or "Call me Mayank"
    /(?:this[\s]+is|call[\s]+me|i[\s]+am[\s]+called)[\s]+([a-zA-Z\s]+)/i,
    // "I am called Mayank"
    /i[\s]+am[\s]+called[\s]+([a-zA-Z\s]+)/i
  ];
  
  // Try to match patterns
  for (const pattern of namePatterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Clean up the name (remove extra words that might have been captured)
      const cleaned = name.split(/\s+/).slice(0, 3).join(' ').trim(); // Max 3 words
      
      // Don't treat excluded words as names even if extracted
      if (excludedWords.includes(cleaned.toLowerCase())) {
        continue;
      }
      
      // Validation
      if (cleaned.length >= 2 && cleaned.length <= 100 && /[a-zA-Z]/.test(cleaned)) {
        return cleaned;
      }
    }
  }
  
  // Fallback: if message doesn't match patterns but looks like a name
  // (e.g., just "Mayank" or "Hello Mayank")
  const simplePattern = /(?:hello|hi|hey)[\s,]+([a-zA-Z\s]{2,50})/i;
  const simpleMatch = trimmed.match(simplePattern);
  if (simpleMatch && simpleMatch[1]) {
    const name = simpleMatch[1].trim();
    // Don't treat excluded words as names
    if (!excludedWords.includes(name.toLowerCase()) && 
        name.length >= 2 && name.length <= 50 && /[a-zA-Z]/.test(name)) {
      return name;
    }
  }
  
  // If no pattern matches, check if entire message is a reasonable name
  // BUT exclude common greetings and short responses
  if (!excludedWords.includes(normalized) && 
      trimmed.length >= 2 && trimmed.length <= 50 && /^[a-zA-Z\s]+$/.test(trimmed)) {
    // Additional check: if it's a single word and looks like a greeting, don't treat as name
    const words = trimmed.split(/\s+/);
    if (words.length === 1 && excludedWords.includes(normalized)) {
      return null;
    }
    return trimmed;
  }
  
  return null;
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

/**
 * Extract parent/relative details from referral message
 * Expected format: "Name: [name], Mobile: [mobile], City: [city]"
 * or variations like "My parent name is X, phone is Y, city is Z"
 * @param {string} message - User message with parent details
 * @returns {object|null} Object with parentName, parentMobile, parentCity or null
 */
function extractParentDetails(message) {
  if (!message || typeof message !== 'string') return null;
  
  const trimmed = message.trim();
  const result = {
    parentName: null,
    parentMobile: null,
    parentCity: null
  };
  
  // Pattern 1: "Name: X, Mobile: Y, City: Z" or "Name: X Mobile: Y City: Z"
  const pattern1 = /(?:name|parent[\s]+name|name[\s]+is)[\s]*:?[\s]*([a-zA-Z\s]{2,50})[\s,]+(?:mobile|phone|number|contact)[\s]*:?[\s]*([\d\s\+\-]{10,15})[\s,]+(?:city|location)[\s]*:?[\s]*([a-zA-Z\s]{2,50})/i;
  const match1 = trimmed.match(pattern1);
  if (match1) {
    result.parentName = match1[1].trim();
    result.parentMobile = match1[2].trim().replace(/\s+/g, '');
    result.parentCity = match1[3].trim();
    return result;
  }
  
  // Pattern 1b: More flexible - any order
  const pattern1b = /(?:name|parent[\s]+name)[\s]*:?[\s]*([a-zA-Z\s]{2,50})/i;
  const pattern1c = /(?:mobile|phone|number|contact)[\s]*:?[\s]*([\d\s\+\-]{10,15})/i;
  const pattern1d = /(?:city|location)[\s]*:?[\s]*([a-zA-Z\s]{2,50})/i;
  
  const nameMatch = trimmed.match(pattern1b);
  const mobileMatch = trimmed.match(pattern1c);
  const cityMatch = trimmed.match(pattern1d);
  
  if (nameMatch) result.parentName = nameMatch[1].trim();
  if (mobileMatch) result.parentMobile = mobileMatch[1].trim().replace(/\s+/g, '');
  if (cityMatch) result.parentCity = cityMatch[1].trim();
  
  // Pattern 2: Extract mobile number (10 digits, may have +91 or country code) - standalone
  if (!result.parentMobile) {
    const mobilePattern = /(?:\+91|91)?[\s\-]?(\d{10})/;
    const mobileMatch2 = trimmed.match(mobilePattern);
    if (mobileMatch2) {
      result.parentMobile = mobileMatch2[1];
    }
  }
  
  // Pattern 3: Extract name (before mobile or after "name is")
  if (!result.parentName) {
    const namePatterns = [
      /(?:name|parent[\s]+name)[\s]*:?[\s]+is[\s]+([a-zA-Z\s]{2,50})/i,
      /([a-zA-Z\s]{2,50})[\s,]+(?:mobile|phone|number)/i,
      /^([a-zA-Z\s]{2,50})[\s,]+/i // Name at start
    ];
    for (const pattern of namePatterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) {
        const extracted = match[1].trim();
        // Don't treat common words as names
        if (!['name', 'mobile', 'phone', 'city', 'location'].includes(extracted.toLowerCase())) {
          result.parentName = extracted;
          break;
        }
      }
    }
  }
  
  // Pattern 4: Extract city
  if (!result.parentCity) {
    const cityPatterns = [
      /(?:city|location)[\s]*:?[\s]+is[\s]+([a-zA-Z\s]{2,50})/i,
      /(?:city|location)[\s]*:?[\s]*([a-zA-Z\s]{2,50})/i
    ];
    for (const pattern of cityPatterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) {
        result.parentCity = match[1].trim();
        break;
      }
    }
  }
  
  // If we got at least one field, return what we have
  if (result.parentMobile || result.parentName || result.parentCity) {
    return result;
  }
  
  return null;
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
  extractParentDetails,
  matchMessageIntent,
  shouldEscalate
};

