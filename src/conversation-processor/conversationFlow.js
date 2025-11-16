const { getMessage } = require('./utils/messages');
const { calculateAge, isValidDOB, extractMessageText } = require('./utils/helpers');
const { getUserProfile, saveUserProfile, getLatestConversationState, saveConversationState, createEscalation } = require('./utils/dynamodb');
const { matchMessageIntent, shouldEscalate, extractName, extractDOB, extractCity, getMenuOption, isYes, isNo, isGreeting } = require('./utils/messageMatcher');

// Environment variables
const USER_PROFILE_TABLE = process.env.USER_PROFILE_TABLE_NAME;
const CONVERSATION_STATE_TABLE = process.env.CONVERSATION_STATE_TABLE_NAME;
const ESCALATION_TABLE = process.env.ESCALATION_TABLE_NAME;

/**
 * Process conversation flow based on current step and user input
 * @param {object} messageData - Incoming message data
 * @returns {Promise<object>} Response data with next step and message
 */
async function processConversationFlow(messageData) {
  const { mobile, waNumber, messageText, timestamp } = messageData;
  const now = Date.now();
  
  // Step 1: CRM Lookup (Pre-check)
  const userProfile = await getUserProfile(USER_PROFILE_TABLE, mobile);
  const isExistingUser = userProfile && userProfile.status === 'active';
  
  // Step 2: Get or create conversation state
  let conversationState = await getLatestConversationState(CONVERSATION_STATE_TABLE, mobile);
  
  // Check if this is first message (no conversation state exists)
  const isFirstMessage = !conversationState;
  
  // If existing user and no active conversation, start at registered step
  if (isExistingUser && !conversationState) {
    conversationState = {
      mobile,
      conversationId: `conv_${now}_${mobile.slice(-4)}`,
      currentStep: 'registered',
      flowState: 'registered',
      userProfile: {
        name: userProfile.name,
        dob: userProfile.dob,
        city: userProfile.city,
        age: userProfile.age,
        mobile,
        waNumber
      },
      stepData: {},
      lastInteraction: now,
      createdAt: now
    };
    
    // Save new conversation state
    await saveConversationState(CONVERSATION_STATE_TABLE, conversationState);
    
    // Check if message is a greeting (Hello, Hi)
    if (isGreeting(messageText)) {
      return {
        nextStep: 'registered',
        flowState: 'registered',
        responseMessage: getMessage('initialGreeting')
      };
    }
    
    return {
      nextStep: 'registered',
      flowState: 'registered',
      responseMessage: getMessage('welcomeBack')
    };
  } else if (!conversationState) {
    // New user - start from greeting
    conversationState = {
      mobile,
      conversationId: `conv_${now}_${mobile.slice(-4)}`,
      currentStep: 'greeting',
      flowState: 'new',
      userProfile: {
        mobile,
        waNumber
      },
      stepData: {},
      lastInteraction: now,
      createdAt: now
    };
    
    // Save new conversation state
    await saveConversationState(CONVERSATION_STATE_TABLE, conversationState);
    
    // Always show full greeting for first message
    return {
      nextStep: 'greeting',
      flowState: 'new',
      responseMessage: getMessage('initialGreeting')
    };
  }
  
  // Update last interaction
  conversationState.lastInteraction = now;
  conversationState.updatedAt = now;
  
  // Process based on current step
  const result = await processStep(conversationState, messageText, messageData);
  
  // Update conversation state
  conversationState.currentStep = result.nextStep;
  conversationState.flowState = result.flowState || conversationState.flowState;
  if (result.stepData) {
    conversationState.stepData = { ...conversationState.stepData, ...result.stepData };
  }
  if (result.userProfile) {
    conversationState.userProfile = { ...conversationState.userProfile, ...result.userProfile };
  }
  
  // Save updated state
  await saveConversationState(CONVERSATION_STATE_TABLE, conversationState);
  
  // Handle registration completion
  if (result.shouldRegister && conversationState.userProfile.age >= 50) {
    await registerUser(conversationState);
  }
  
  // Handle escalation
  if (result.shouldEscalate) {
    await createEscalation(ESCALATION_TABLE, {
      mobile,
      waNumber,
      conversationId: conversationState.conversationId,
      userProfile: conversationState.userProfile,
      userMessage: messageText,
      escalationReason: result.escalationReason || 'unknown_option',
      step: conversationState.currentStep
    });
  }
  
  return {
    responseMessage: result.responseMessage,
    conversationState,
    escalationId: result.escalationId
  };
}

/**
 * Process message based on current step
 * @param {object} state - Current conversation state
 * @param {string} messageText - User message text
 * @param {object} messageData - Full message data
 * @returns {Promise<object>} Processing result
 */
async function processStep(state, messageText, messageData) {
  const { currentStep, userProfile, stepData } = state;
  const name = userProfile.name || 'there';
  
  // Check if message should be escalated (contains help/support keywords)
  if (shouldEscalate(messageText) && currentStep !== 'human_escalation') {
    return {
      nextStep: 'human_escalation',
      flowState: 'completed',
      responseMessage: getMessage('humanEscalation', name),
      shouldEscalate: true,
      escalationReason: 'explicit_request'
    };
  }
  
  // Check if this is first message in conversation (no previous interaction or long gap)
  const isFirstMessage = !state.lastInteraction || 
    (Date.now() - state.lastInteraction) > (24 * 60 * 60 * 1000); // 24 hours gap
  
  // Check if message is a greeting - handle it specially (works from any step)
  if (isGreeting(messageText)) {
    console.log(JSON.stringify({
      message: 'Greeting detected',
      currentStep,
      messageText,
      isFirstMessage
    }));
    
    // If greeting detected, always show full greeting message and reset to greeting step
    return {
      nextStep: 'greeting',
      flowState: 'collecting',
      responseMessage: getMessage('initialGreeting')
    };
  }
  
  // Use message matcher to understand intent
  const intent = matchMessageIntent(messageText, currentStep, isFirstMessage);
  
  console.log(JSON.stringify({
    message: 'Message intent matched',
    currentStep,
    messageText,
    intent: intent.intent,
    confidence: intent.confidence,
    isFirstMessage
  }));
  
  switch (currentStep) {
    case 'pre_check':
    case 'greeting':
      return processGreeting(messageText, intent);
    
    case 'collect_name':
      return processCollectName(messageText, state, intent);
    
    case 'collect_dob':
      return processCollectDOB(messageText, state, intent);
    
    case 'collect_city':
      return await processCollectCity(messageText, state, intent);
    
    case 'age_under_50':
      return processAgeUnder50(messageText, state, intent);
    
    case 'referral_collect':
      return processReferralCollect(messageText, state);
    
    case 'registered':
      return processRegistered(messageText, state, intent);
    
    case 'holidays':
      return processHolidays(messageText, state, intent);
    
    case 'events':
      return processEvents(messageText, state, intent);
    
    case 'health':
      return processHealth(messageText, state, intent);
    
    case 'community':
      return processCommunity(messageText, state, intent);
    
    case 'human_escalation':
    case 'completed':
      return {
        nextStep: 'completed',
        flowState: 'completed',
        responseMessage: getMessage('closing', name)
      };
    
    default:
      // Unknown step - escalate
      return {
        nextStep: 'human_escalation',
        flowState: 'completed',
        responseMessage: getMessage('humanEscalation', name),
        shouldEscalate: true,
        escalationReason: 'unknown_step'
      };
  }
}

/**
 * Process greeting step
 */
function processGreeting(messageText, intent) {
  // If user sends greeting (Hello, Hi), show full greeting message
  if (intent.intent === 'greeting' || isGreeting(messageText)) {
    return {
      nextStep: 'greeting',
      flowState: 'collecting',
      responseMessage: getMessage('initialGreeting')
    };
  } else if (intent.intent === 'yes' || isYes(messageText)) {
    return {
      nextStep: 'collect_name',
      flowState: 'collecting',
      responseMessage: getMessage('askName')
    };
  } else if (intent.intent === 'no' || isNo(messageText)) {
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('closing', 'there')
    };
  } else {
    return {
      nextStep: 'greeting',
      responseMessage: getMessage('invalidResponse')
    };
  }
}

/**
 * Process name collection
 */
function processCollectName(messageText, state, intent) {
  // Use extracted name from intent matcher if available, otherwise use raw text
  const name = intent.data.name || extractName(messageText) || messageText.trim();
  
  if (!name || name.length < 2) {
    return {
      nextStep: 'collect_name',
      responseMessage: 'Please provide your full name.'
    };
  }
  
  return {
    nextStep: 'collect_dob',
    flowState: 'collecting',
    stepData: {
      collectDetails: {
        name
      }
    },
    userProfile: {
      name
    },
    responseMessage: getMessage('askDOB', name)
  };
}

/**
 * Process DOB collection
 */
function processCollectDOB(messageText, state, intent) {
  // Use extracted DOB from intent matcher if available
  const dob = intent.data.dob || extractDOB(messageText) || messageText.trim();
  
  if (!isValidDOB(dob)) {
    return {
      nextStep: 'collect_dob',
      responseMessage: getMessage('invalidDOB')
    };
  }
  
  const age = calculateAge(dob);
  if (age === null) {
    return {
      nextStep: 'collect_dob',
      responseMessage: getMessage('invalidDOB')
    };
  }
  
  return {
    nextStep: 'collect_city',
    flowState: 'collecting',
    stepData: {
      collectDetails: {
        ...state.stepData.collectDetails,
        dob: dob,
        age
      }
    },
    userProfile: {
      ...state.userProfile,
      dob: dob,
      age
    },
    responseMessage: getMessage('askCity', state.userProfile.name)
  };
}

/**
 * Process city collection
 */
async function processCollectCity(messageText, state, intent) {
  // Use extracted city from intent matcher if available
  const city = intent.data.city || extractCity(messageText) || messageText.trim();
  
  if (!city || city.length < 2) {
    return {
      nextStep: 'collect_city',
      responseMessage: 'Please provide your city name.'
    };
  }
  
  const updatedStepData = {
    collectDetails: {
      ...state.stepData.collectDetails,
      city,
      completed: true
    }
  };
  
  // Immediately validate age after collecting city
  const age = state.userProfile.age;
  const name = state.userProfile.name;
  
  if (age < 50) {
    return {
      nextStep: 'age_under_50',
      flowState: 'collecting',
      stepData: updatedStepData,
      userProfile: {
        ...state.userProfile,
        city
      },
      responseMessage: getMessage('ageUnder50', name)
    };
  } else {
    // Age >= 50, proceed to registration
    return {
      nextStep: 'registered',
      flowState: 'registered',
      stepData: updatedStepData,
      userProfile: {
        ...state.userProfile,
        city
      },
      shouldRegister: true,
      responseMessage: getMessage('registrationComplete', name)
    };
  }
}

/**
 * Process age validation
 */
function processAgeValidation(state) {
  const age = state.userProfile.age;
  const name = state.userProfile.name;
  
  if (age < 50) {
    return {
      nextStep: 'age_under_50',
      flowState: 'collecting',
      responseMessage: getMessage('ageUnder50', name)
    };
  } else {
    // Age >= 50, proceed to registration
    return {
      nextStep: 'registered',
      flowState: 'registered',
      shouldRegister: true,
      responseMessage: getMessage('registrationComplete', name)
    };
  }
}

/**
 * Process age under 50 response
 */
function processAgeUnder50(messageText, state, intent) {
  if (intent.intent === 'yes' || isYes(messageText)) {
    return {
      nextStep: 'referral_collect',
      flowState: 'collecting',
      responseMessage: getMessage('referralCollect')
    };
  } else if (intent.intent === 'no' || isNo(messageText)) {
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('referralThankYou')
    };
  } else {
    return {
      nextStep: 'age_under_50',
      responseMessage: getMessage('invalidResponse')
    };
  }
}

/**
 * Process referral collection
 */
function processReferralCollect(messageText, state) {
  // Simple parsing - in production, use NLP or structured input
  // For now, just acknowledge and escalate
  return {
    nextStep: 'completed',
    flowState: 'completed',
    responseMessage: getMessage('referralThankYou'),
    shouldEscalate: true,
    escalationReason: 'referral_submitted'
  };
}

/**
 * Process registered user menu selection
 */
function processRegistered(messageText, state, intent) {
  // Use intent matcher to get menu option
  const option = intent.data.option || getMenuOption(messageText);
  
  if (!option) {
    // If no clear option, check if it's a help request
    if (shouldEscalate(messageText)) {
      return {
        nextStep: 'human_escalation',
        flowState: 'completed',
        responseMessage: getMessage('humanEscalation', state.userProfile.name || 'there'),
        shouldEscalate: true,
        escalationReason: 'unknown_option'
      };
    }
    
    return {
      nextStep: 'registered',
      responseMessage: getMessage('invalidMenuOption')
    };
  }
  
  switch (option) {
    case 1:
      return {
        nextStep: 'holidays',
        responseMessage: getMessage('holidays')
      };
    case 2:
      return {
        nextStep: 'events',
        responseMessage: getMessage('events', state.userProfile.city || 'your city')
      };
    case 3:
      return {
        nextStep: 'health',
        responseMessage: getMessage('health')
      };
    case 4:
      return {
        nextStep: 'community',
        responseMessage: getMessage('community')
      };
    default:
      return {
        nextStep: 'registered',
        responseMessage: getMessage('invalidMenuOption')
      };
  }
}

/**
 * Process holidays flow
 */
function processHolidays(messageText, state, intent) {
  if (intent.intent === 'yes' || isYes(messageText)) {
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('holidaysYes'),
      shouldEscalate: true,
      escalationReason: 'holidays_interest'
    };
  } else if (intent.intent === 'no' || isNo(messageText)) {
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('holidaysNo')
    };
  } else {
    return {
      nextStep: 'holidays',
      responseMessage: getMessage('invalidResponse')
    };
  }
}

/**
 * Process events flow
 */
function processEvents(messageText, state, intent) {
  const city = state.userProfile.city || 'your city';
  
  if (intent.intent === 'yes' || isYes(messageText)) {
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('eventsYes', city),
      shouldEscalate: true,
      escalationReason: 'events_interest'
    };
  } else if (intent.intent === 'no' || isNo(messageText)) {
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('eventsNo')
    };
  } else {
    return {
      nextStep: 'events',
      responseMessage: getMessage('invalidResponse')
    };
  }
}

/**
 * Process health flow
 */
function processHealth(messageText, state, intent) {
  if (intent.intent === 'yes' || isYes(messageText)) {
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('healthYes'),
      shouldEscalate: true,
      escalationReason: 'health_callback_request'
    };
  } else if (intent.intent === 'no' || isNo(messageText)) {
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('healthNo')
    };
  } else {
    return {
      nextStep: 'health',
      responseMessage: getMessage('invalidResponse')
    };
  }
}

/**
 * Process community flow
 */
function processCommunity(messageText, state, intent) {
  if (intent.intent === 'yes' || isYes(messageText)) {
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('communityYes')
    };
  } else if (intent.intent === 'no' || isNo(messageText)) {
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('communityNo')
    };
  } else {
    return {
      nextStep: 'community',
      responseMessage: getMessage('invalidResponse')
    };
  }
}

/**
 * Register user in CRM
 */
async function registerUser(conversationState) {
  const { userProfile } = conversationState;
  const now = Date.now();
  
  const profile = {
    mobile: userProfile.mobile,
    name: userProfile.name,
    dob: userProfile.dob,
    city: userProfile.city,
    age: userProfile.age,
    waNumber: userProfile.waNumber,
    registrationDate: now,
    status: 'active',
    preferences: {
      holidays: false,
      events: false,
      health: false,
      community: false
    },
    interactions: {
      totalMessages: 0,
      lastMessageDate: now,
      escalations: 0
    },
    createdAt: now,
    updatedAt: now
  };
  
  await saveUserProfile(USER_PROFILE_TABLE, profile);
}

module.exports = {
  processConversationFlow
};

