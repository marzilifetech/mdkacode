const { getMessage } = require('./utils/messages');
const { calculateAge, isValidDOB, extractMessageText } = require('./utils/helpers');
const { getUserProfile, saveUserProfile, updateUserProfile, getLatestConversationState, saveConversationState, createEscalation } = require('./utils/dynamodb');
const { matchMessageIntent, shouldEscalate, extractName, extractDOB, extractCity, extractParentDetails, getMenuOption, isYes, isNo, isGreeting } = require('./utils/messageMatcher');

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
  
  console.log(JSON.stringify({
    message: 'User profile check',
    mobile,
    isExistingUser,
    hasUserProfile: !!userProfile,
    userName: userProfile?.name || null,
    userStatus: userProfile?.status || null
  }));
  
  // Step 2: Get or create conversation state
  let conversationState = await getLatestConversationState(CONVERSATION_STATE_TABLE, mobile);
  
  console.log(JSON.stringify({
    message: 'Conversation state check',
    mobile,
    hasConversationState: !!conversationState,
    currentStep: conversationState?.currentStep || null,
    hasNameInState: !!conversationState?.userProfile?.name
  }));
  
  // If existing user is in any collection step, move them to registered immediately
  if (isExistingUser && conversationState && 
      ['greeting', 'collect_name', 'collect_dob', 'collect_city'].includes(conversationState.currentStep)) {
    conversationState.currentStep = 'registered';
    conversationState.flowState = 'registered';
    conversationState.userProfile = {
      name: userProfile.name,
      dob: userProfile.dob,
      city: userProfile.city,
      age: userProfile.age,
      mobile,
      waNumber
    };
    await saveConversationState(CONVERSATION_STATE_TABLE, conversationState);
    
    return {
      nextStep: 'registered',
      flowState: 'registered',
      responseMessage: getMessage('welcomeBack', userProfile.name),
      conversationState
    };
  }
  
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
    
    // For existing users, always show welcome back message with community link
    return {
      nextStep: 'registered',
      flowState: 'registered',
      responseMessage: getMessage('welcomeBack', userProfile.name)
    };
  } else if (isExistingUser && conversationState && conversationState.currentStep === 'greeting') {
    // If existing user somehow ended up in greeting step, move them to registered
    conversationState.currentStep = 'registered';
    conversationState.flowState = 'registered';
    conversationState.userProfile = {
      name: userProfile.name,
      dob: userProfile.dob,
      city: userProfile.city,
      age: userProfile.age,
      mobile,
      waNumber
    };
    await saveConversationState(CONVERSATION_STATE_TABLE, conversationState);
    
    return {
      nextStep: 'registered',
      flowState: 'registered',
      responseMessage: getMessage('welcomeBack', userProfile.name)
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
  
  // Process based on current step - pass userProfile info to prevent asking existing users for details
  const result = await processStep(conversationState, messageText, messageData, isExistingUser, userProfile);
  
  // Update conversation state
  conversationState.currentStep = result.nextStep;
  conversationState.flowState = result.flowState || conversationState.flowState;
  if (result.stepData) {
    conversationState.stepData = { ...conversationState.stepData, ...result.stepData };
  }
  if (result.userProfile) {
    // For existing users, always preserve complete profile from database - never overwrite with incomplete data
    if (isExistingUser && userProfile) {
      // Only merge non-profile fields (like mobile, waNumber) from result, but keep DB profile data
      conversationState.userProfile = {
        mobile: result.userProfile.mobile || conversationState.userProfile.mobile || mobile,
        waNumber: result.userProfile.waNumber || conversationState.userProfile.waNumber || waNumber,
        name: userProfile.name, // Always from DB
        dob: userProfile.dob,   // Always from DB
        city: userProfile.city, // Always from DB
        age: userProfile.age    // Always from DB
      };
    } else {
      // For new users, merge result with existing state, ensuring mobile and waNumber are preserved
      conversationState.userProfile = {
        mobile: conversationState.userProfile?.mobile || mobile,
        waNumber: conversationState.userProfile?.waNumber || waNumber,
        ...conversationState.userProfile,
        ...result.userProfile
      };
    }
  } else if (isExistingUser && userProfile && conversationState.userProfile) {
    // Ensure existing user profile is always complete in conversation state
    conversationState.userProfile = {
      ...conversationState.userProfile,
      name: userProfile.name,
      dob: userProfile.dob,
      city: userProfile.city,
      age: userProfile.age
    };
  } else if (!conversationState.userProfile) {
    // Ensure userProfile exists with at least mobile
    conversationState.userProfile = {
      mobile,
      waNumber
    };
  } else {
    // Ensure mobile and waNumber are always set
    conversationState.userProfile.mobile = conversationState.userProfile.mobile || mobile;
    conversationState.userProfile.waNumber = conversationState.userProfile.waNumber || waNumber;
  }
  
  // Save updated state
  await saveConversationState(CONVERSATION_STATE_TABLE, conversationState);
  
  // Handle registration completion - Save ALL users regardless of age
  // shouldRegister is set when all details (name, DOB, city) are collected
  if (result.shouldRegister) {
    // Get age from result or conversation state
    const userAge = result.userProfile?.age || conversationState.userProfile?.age;
    
    // Check for referral details in stepData
    const referralDetails = conversationState.stepData?.referralDetails || result.stepData?.referralDetails;
    
    console.log(JSON.stringify({
      message: '🔍 Registration check',
      shouldRegister: result.shouldRegister,
      userAge: userAge,
      isExistingUser: isExistingUser,
      hasMobile: !!conversationState.userProfile?.mobile,
      hasName: !!conversationState.userProfile?.name,
      hasDOB: !!conversationState.userProfile?.dob,
      hasCity: !!conversationState.userProfile?.city,
      hasReferralDetails: !!referralDetails,
      referralDetails: referralDetails,
      stepData: conversationState.stepData,
      resultStepData: result.stepData,
      conversationStateProfile: conversationState.userProfile,
      resultProfile: result.userProfile
    }));
    
    // Register ALL users (regardless of age) if they don't already exist
    if (!isExistingUser && userAge !== null && userAge !== undefined) {
      console.log(JSON.stringify({
        message: '🔄 Triggering user registration',
        mobile: conversationState.userProfile.mobile,
        name: conversationState.userProfile.name,
        age: userAge,
        ageEligible: userAge >= 50,
        dob: conversationState.userProfile.dob,
        city: conversationState.userProfile.city
      }));
      
      // Ensure conversation state has all required fields before registering
      if (!conversationState.userProfile.mobile || !conversationState.userProfile.name || 
          !conversationState.userProfile.dob || !conversationState.userProfile.city) {
        console.error(JSON.stringify({
          message: '❌ Cannot register - missing required fields in conversation state',
          mobile: conversationState.userProfile.mobile,
          name: conversationState.userProfile.name,
          dob: conversationState.userProfile.dob,
          city: conversationState.userProfile.city
        }));
      } else {
        try {
          await registerUser(conversationState);
          console.log(JSON.stringify({
            message: '✅ Registration completed successfully',
            mobile: conversationState.userProfile.mobile
          }));
        } catch (error) {
          console.error(JSON.stringify({
            message: '❌ Registration failed - CRITICAL ERROR',
            mobile: conversationState.userProfile.mobile,
            name: conversationState.userProfile.name,
            error: error.message,
            stack: error.stack,
            userProfile: conversationState.userProfile
          }));
          // Don't throw - we still want to send the response message
          // But log the error so we know registration failed
        }
      }
    } else {
      console.log(JSON.stringify({
        message: '⏭️ Skipping registration',
        reason: isExistingUser ? 'user already exists' : (userAge === null || userAge === undefined ? 'age not set' : 'unknown'),
        mobile: conversationState.userProfile?.mobile,
        name: conversationState.userProfile?.name
      }));
    }
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
    
    // Increment escalations count
    if (isExistingUser && userProfile) {
      try {
        await updateUserProfile(USER_PROFILE_TABLE, mobile, {
          interactions: { escalations: 1 }
        });
      } catch (error) {
        console.error(JSON.stringify({
          message: '❌ Failed to update escalations count',
          mobile,
          error: error.message
        }));
      }
    }
  }
  
  // Update user preferences if menu option was selected
  if (result.updatePreference && isExistingUser && userProfile) {
    try {
      await updateUserProfile(USER_PROFILE_TABLE, mobile, {
        preferences: result.updatePreference
      });
      console.log(JSON.stringify({
        message: '✅ Updated user preference',
        mobile,
        preference: result.updatePreference
      }));
    } catch (error) {
      console.error(JSON.stringify({
        message: '❌ Failed to update preference',
        mobile,
        error: error.message
      }));
    }
  }
  
  // Update interactions: increment totalMessages and update lastMessageDate
  if (isExistingUser && userProfile) {
    try {
      await updateUserProfile(USER_PROFILE_TABLE, mobile, {
        interactions: {
          totalMessages: 1, // Increment by 1
          lastMessageDate: now
        }
      });
    } catch (error) {
      console.error(JSON.stringify({
        message: '❌ Failed to update interactions',
        mobile,
        error: error.message
      }));
    }
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
 * @param {boolean} isExistingUser - Whether user exists in database
 * @param {object} dbUserProfile - User profile from database (if exists)
 * @returns {Promise<object>} Processing result
 */
async function processStep(state, messageText, messageData, isExistingUser = false, dbUserProfile = null) {
  const { currentStep, userProfile, stepData } = state;
  const name = userProfile.name || 'there';
  
  // If existing user is in collection steps, immediately move to registered
  if (isExistingUser && dbUserProfile && 
      ['greeting', 'collect_name', 'collect_dob', 'collect_city'].includes(currentStep)) {
    return {
      nextStep: 'registered',
      flowState: 'registered',
      userProfile: {
        name: dbUserProfile.name,
        dob: dbUserProfile.dob,
        city: dbUserProfile.city,
        age: dbUserProfile.age,
        mobile: state.userProfile.mobile,
        waNumber: state.userProfile.waNumber
      },
      responseMessage: getMessage('welcomeBack', dbUserProfile.name)
    };
  }
  
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
      isFirstMessage,
      isExistingUser
    }));
    
    // If existing user sends greeting, show welcome back instead of asking for details
    if (isExistingUser && dbUserProfile) {
      return {
        nextStep: 'registered',
        flowState: 'registered',
        userProfile: {
          name: dbUserProfile.name,
          dob: dbUserProfile.dob,
          city: dbUserProfile.city,
          age: dbUserProfile.age,
          mobile: state.userProfile.mobile,
          waNumber: state.userProfile.waNumber
        },
        responseMessage: getMessage('welcomeBack', dbUserProfile.name)
      };
    }
    
    // Try to extract name from greeting (e.g., "Hello My Name is Mayank")
    // Only extract if the message contains name-related keywords, not simple greetings
    const hasNameKeywords = /(?:my[\s]+name|name[\s]+is|i[\s]+am|i'm|this[\s]+is|call[\s]+me)/i.test(messageText);
    const extractedName = hasNameKeywords ? extractName(messageText) : null;
    
    if (extractedName && currentStep === 'greeting' && extractedName.length > 2) {
      // Validate that extracted name is not a greeting word
      const normalizedName = extractedName.toLowerCase();
      const isGreetingWord = ['hello', 'hi', 'hey', 'yes', 'no', 'ok', 'okay'].includes(normalizedName);
      
      if (!isGreetingWord) {
        console.log(JSON.stringify({
          message: 'Name extracted from greeting',
          extractedName,
          originalMessage: messageText
        }));
        
        // If we're in greeting step and name is found, move to DOB collection
        return {
          nextStep: 'collect_dob',
          flowState: 'collecting',
          stepData: {
            collectDetails: {
              name: extractedName
            }
          },
          userProfile: {
            name: extractedName
          },
          responseMessage: getMessage('askDOB', extractedName)
        };
      }
    }
    
    // If greeting detected and not existing user, show full greeting message
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
      return processGreeting(messageText, intent, isExistingUser, dbUserProfile);
    
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
      return processRegistered(messageText, state, intent, isExistingUser, dbUserProfile);
    
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
 * @param {string} messageText - User message
 * @param {object} intent - Matched intent
 * @param {boolean} isExistingUser - Whether user exists in database
 * @param {object} dbUserProfile - User profile from database (if exists)
 */
function processGreeting(messageText, intent, isExistingUser = false, dbUserProfile = null) {
  // If existing user sends greeting, show welcome back instead
  if (isExistingUser && dbUserProfile) {
    return {
      nextStep: 'registered',
      flowState: 'registered',
      userProfile: {
        name: dbUserProfile.name,
        dob: dbUserProfile.dob,
        city: dbUserProfile.city,
        age: dbUserProfile.age
      },
      responseMessage: getMessage('welcomeBack', dbUserProfile.name)
    };
  }
  
  // If user sends greeting (Hello, Hi), show full greeting message
  if (intent.intent === 'greeting' || isGreeting(messageText)) {
    // Only try to extract name if message contains name-related keywords
    const hasNameKeywords = /(?:my[\s]+name|name[\s]+is|i[\s]+am|i'm|this[\s]+is|call[\s]+me)/i.test(messageText);
    const extractedName = hasNameKeywords ? extractName(messageText) : null;
    
    // If name is found in greeting, skip name collection and go to DOB
    if (extractedName && extractedName.length > 2) {
      // Validate that extracted name is not a greeting word
      const normalizedName = extractedName.toLowerCase();
      const isGreetingWord = ['hello', 'hi', 'hey', 'yes', 'no', 'ok', 'okay'].includes(normalizedName);
      
      if (!isGreetingWord) {
        console.log(JSON.stringify({
          message: 'Name extracted from greeting in processGreeting',
          extractedName,
          originalMessage: messageText
        }));
        
        return {
          nextStep: 'collect_dob',
          flowState: 'collecting',
          stepData: {
            collectDetails: {
              name: extractedName
            }
          },
          userProfile: {
            name: extractedName
          },
          responseMessage: getMessage('askDOB', extractedName)
        };
      }
    }
    
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
    // Try to extract name even if not a clear greeting, but only if it has name keywords
    const hasNameKeywords = /(?:my[\s]+name|name[\s]+is|i[\s]+am|i'm|this[\s]+is|call[\s]+me)/i.test(messageText);
    const extractedName = hasNameKeywords ? extractName(messageText) : null;
    
    if (extractedName && extractedName.length > 2) {
      const normalizedName = extractedName.toLowerCase();
      const isGreetingWord = ['hello', 'hi', 'hey', 'yes', 'no', 'ok', 'okay'].includes(normalizedName);
      
      if (!isGreetingWord) {
        console.log(JSON.stringify({
          message: 'Name extracted from non-greeting message',
          extractedName,
          originalMessage: messageText
        }));
        
        return {
          nextStep: 'collect_dob',
          flowState: 'collecting',
          stepData: {
            collectDetails: {
              name: extractedName
            }
          },
          userProfile: {
            name: extractedName
          },
          responseMessage: getMessage('askDOB', extractedName)
        };
      }
    }
    
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
  
  // Always register users after collecting all details (name, DOB, city)
  // Use ageEligible boolean to identify if age >= 50
  if (age < 50) {
    // User under 50 - still register them, but show age message
    return {
      nextStep: 'age_under_50',
      flowState: 'collecting',
      stepData: updatedStepData,
      userProfile: {
        ...state.userProfile,
        city
      },
      shouldRegister: true, // Register all users regardless of age
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
    // User declined to provide referral - still register them
    return {
      nextStep: 'completed',
      flowState: 'completed',
      responseMessage: getMessage('referralThankYou'),
      shouldRegister: true // Register user even if they declined referral
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
  // Extract parent/relative details from message
  const parentDetails = extractParentDetails(messageText);
  
  console.log(JSON.stringify({
    message: '📋 Processing referral details',
    originalMessage: messageText,
    extractedDetails: parentDetails
  }));
  
  // Store parent details in stepData for later registration
  // Always store referralDetails, even if extraction failed (store raw message)
  const referralData = parentDetails || {
    rawMessage: messageText // Store raw message if extraction fails
  };
  
  const stepData = {
    ...state.stepData,
    referralDetails: referralData
  };
  
  console.log(JSON.stringify({
    message: '💾 Storing referral details in stepData',
    referralDetails: referralData,
    stepDataKeys: Object.keys(stepData),
    hasParentName: !!referralData.parentName,
    hasParentMobile: !!referralData.parentMobile,
    hasParentCity: !!referralData.parentCity
  }));
  
  return {
    nextStep: 'completed',
    flowState: 'completed',
    stepData: stepData,
    responseMessage: getMessage('referralThankYou'),
    shouldEscalate: true,
    escalationReason: 'referral_submitted',
    shouldRegister: true // Register the user (child) who provided referral
  };
}

/**
 * Process registered user menu selection
 */
function processRegistered(messageText, state, intent, isExistingUser = false, dbUserProfile = null) {
  // If existing user sends a greeting, greet them with their name
  if (isGreeting(messageText)) {
    const userName = dbUserProfile?.name || state.userProfile?.name || 'there';
    return {
      nextStep: 'registered',
      flowState: 'registered',
      responseMessage: getMessage('welcomeBack', userName)
    };
  }
  
  // Use intent matcher to get menu option
  const option = intent.data.option || getMenuOption(messageText);
  
  if (!option) {
    // If no clear option, check if it's a help request
    if (shouldEscalate(messageText)) {
      const userName = state.userProfile?.name || dbUserProfile?.name || 'there';
      return {
        nextStep: 'human_escalation',
        flowState: 'completed',
        responseMessage: getMessage('humanEscalation', userName),
        shouldEscalate: true,
        escalationReason: 'unknown_option'
      };
    }
    
    return {
      nextStep: 'registered',
      responseMessage: getMessage('invalidMenuOption')
    };
  }
  
  // Update user preference based on selected option
  let preferenceUpdate = null;
  switch (option) {
    case 1:
      preferenceUpdate = { holidays: true };
      return {
        nextStep: 'holidays',
        responseMessage: getMessage('holidays'),
        updatePreference: preferenceUpdate
      };
    case 2:
      preferenceUpdate = { events: true };
      return {
        nextStep: 'events',
        responseMessage: getMessage('events', state.userProfile.city || 'your city'),
        updatePreference: preferenceUpdate
      };
    case 3:
      preferenceUpdate = { health: true };
      return {
        nextStep: 'health',
        responseMessage: getMessage('health'),
        updatePreference: preferenceUpdate
      };
    case 4:
      preferenceUpdate = { community: true };
      return {
        nextStep: 'community',
        responseMessage: getMessage('community'),
        updatePreference: preferenceUpdate
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
  
  // Validate required fields before saving
  if (!userProfile.mobile || !userProfile.name || !userProfile.dob || !userProfile.city || !userProfile.age) {
    console.error(JSON.stringify({
      message: '❌ Cannot register user - missing required fields',
      mobile: userProfile.mobile,
      hasName: !!userProfile.name,
      hasDOB: !!userProfile.dob,
      hasCity: !!userProfile.city,
      hasAge: !!userProfile.age
    }));
    throw new Error('Cannot register user: missing required fields');
  }
  
  // Calculate age eligibility
  const ageEligible = userProfile.age >= 50;
  
  // Get parent/referral details if available (for users under 50 who provided referral)
  const referralDetails = conversationState.stepData?.referralDetails;
  const savedBy = referralDetails?.parentMobile || null;
  
  console.log(JSON.stringify({
    message: '📝 Registering user in CRM',
    mobile: userProfile.mobile,
    name: userProfile.name,
    age: userProfile.age,
    ageEligible: ageEligible,
    city: userProfile.city,
    dob: userProfile.dob,
    savedBy: savedBy,
    hasReferralDetails: !!referralDetails,
    referralDetails: referralDetails,
    stepDataKeys: conversationState.stepData ? Object.keys(conversationState.stepData) : [],
    hasReferralInfo: !!(referralDetails && (referralDetails.parentName || referralDetails.parentMobile || referralDetails.parentCity))
  }));
  
  const profile = {
    mobile: userProfile.mobile,
    name: userProfile.name,
    dob: userProfile.dob,
    city: userProfile.city,
    age: userProfile.age,
    ageEligible: ageEligible, // Boolean: true if age >= 50, false otherwise
    waNumber: userProfile.waNumber || userProfile.mobile,
    savedBy: savedBy, // Mobile number of parent/relative who referred them (if applicable)
    registrationDate: now,
    status: 'active',
    source: 'WhatsApp Bot',
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
  
  // Add parent details if available
  if (referralDetails && (referralDetails.parentName || referralDetails.parentMobile || referralDetails.parentCity)) {
    profile.referralInfo = {
      parentName: referralDetails.parentName || null,
      parentMobile: referralDetails.parentMobile || null,
      parentCity: referralDetails.parentCity || null,
      rawMessage: referralDetails.rawMessage || null
    };
    
    console.log(JSON.stringify({
      message: '📝 Including parent/referral details in registration',
      parentName: referralDetails.parentName,
      parentMobile: referralDetails.parentMobile,
      parentCity: referralDetails.parentCity
    }));
  }
  
  try {
    await saveUserProfile(USER_PROFILE_TABLE, profile);
    
    console.log(JSON.stringify({
      message: '✅ User registered successfully',
      mobile: userProfile.mobile,
      name: userProfile.name,
      table: USER_PROFILE_TABLE
    }));
  } catch (error) {
    console.error(JSON.stringify({
      message: '❌ Failed to register user',
      mobile: userProfile.mobile,
      name: userProfile.name,
      error: error.message,
      stack: error.stack
    }));
    throw error; // Re-throw to ensure we know registration failed
  }
}

module.exports = {
  processConversationFlow
};

