/**
 * Message templates for conversation flow
 */

const MESSAGES = {
  // Pre-check: Welcome back for existing users
  welcomeBack: (name) => 
    `Hi *${name}*! 👋\n\nWelcome back to Marzi! Our team will contact you at the earliest.\n\nIn the meantime, feel free to explore our community:\n\n🔗 Join our WhatsApp Community: https://chat.whatsapp.com/HxjCgifvxwh7jWoetYQi2z\n\nHere's what you can explore:\n\n1️⃣ Marzi Holidays\n2️⃣ Marzi Events\n3️⃣ Marzi Health\n4️⃣ Marzi Community\n\n👉 Reply with the *number (1–4)*.`,

  // Step 1: Greeting
  greeting: () =>
    "Hi, I'm *Marzi Support*, your friend from Marzi — India's most trusted community for people above 50 to live happier, healthier and more connected lives.\n\nWould you like to know more about what we do?\n👉 Reply *Yes* to continue or *No* to exit.",
  
  // Initial Greeting (for Hello/First Message)
  initialGreeting: () =>
    "Hi, I'm *Marzi Support*, your friend from Marzi — India's most trusted community for people above 50 to live happier, healthier and more connected lives.\n\nWould you like to know more about what we do?\n👉 Reply *Yes* to continue or *No* to exit.",

  // Step 2: Collect Details
  askName: () =>
    "What's your full name?",

  askDOB: (name) =>
    `Lovely to meet you, *${name}* 😊\nPlease share your Date of Birth (DD-MM-YYYY).`,

  askCity: (name) =>
    `Thanks, *${name}*!\nWhich city do you live in?`,

  // Step 3: Age Validation
  ageUnder50: (name) =>
    `Thanks, *${name}*!\nMarzi is a community specially for people aged 50+.\nWould you like to share contact details of a parent or relative who may benefit?\n👉 Reply *Yes* or *No*`,

  referralCollect: () =>
    "Please share their *Name*, *Mobile Number*, and *City*.\nOur team will reach out soon. Thank you for spreading the joy!",

  referralThankYou: () =>
    "Thank you for reaching out. Stay connected through our social media pages!",

  // Step 4: Registration
  registrationComplete: (name) =>
    `Perfect, *${name}*! You're now registered with Marzi! 🎉\n\nHere's what you can explore:\n\n1️⃣ Marzi Holidays\n2️⃣ Marzi Events\n3️⃣ Marzi Health\n4️⃣ Marzi Community\n\n👉 Reply with the *number (1–4)*.`,

  // Step 5: Predefined Responses
  holidays: () =>
    "Marzi Holidays are senior-friendly trips designed with comfort, safety & fun.\n\nWould you like to see our upcoming tours? (Yes/No)",

  holidaysYes: () =>
    "Great! I'm connecting you with our travel team. Here's our WhatsApp Travel Group: [LINK]\n\nOur team will reach out to you shortly!",

  holidaysNo: () =>
    "No problem! Here's our WhatsApp Travel Group link: [LINK]\n\nFeel free to join and explore our upcoming tours.",

  events: (city) =>
    `Our events bring people together — music, movies, walks, workshops.\n\nWould you like to view upcoming events in *${city}*? (Yes/No)`,

  eventsYes: (city) =>
    `Perfect! I'm connecting you with our events team for *${city}*. Here's our WhatsApp Events Group:\n\n🔗 https://chat.whatsapp.com/HxjCgifvxwh7jWoetYQi2z\n\nOur team will reach out to you shortly!`,

  eventsNo: () =>
    "No problem! Here's our WhatsApp Events Group link:\n\n🔗 https://chat.whatsapp.com/HxjCgifvxwh7jWoetYQi2z\n\nFeel free to join and explore upcoming events.",

  health: () =>
    "Our wellness plans blend yoga, nutrition & physiotherapy to manage pain naturally.\n\nWould you like a Care Manager to call you? (Yes/No)",

  healthYes: () =>
    "Perfect! I've requested a Care Manager to call you. Our support number is: [SUPPORT_NUMBER]\n\nOur team will reach out to you shortly!",

  healthNo: () =>
    "No problem! Here's our support number: [SUPPORT_NUMBER]\n\nFeel free to reach out anytime.",

  community: () =>
    "Marzi is a growing family of 10,000+ seniors connecting through stories & purpose.\n\nWould you like to join our WhatsApp Community? (Yes/No)",

  communityYes: () =>
    "Wonderful! Here's our WhatsApp Community link:\n\n🔗 https://chat.whatsapp.com/HxjCgifvxwh7jWoetYQi2z\n\nWelcome to the Marzi family! 🎉",

  communityNo: () =>
    "No problem! Here's our WhatsApp Community link if you change your mind:\n\n🔗 https://chat.whatsapp.com/HxjCgifvxwh7jWoetYQi2z\n\nFeel free to join anytime!",

  // Step 6: Human Escalation
  humanEscalation: (name) =>
    `That's a great question, *${name}*.\nLet me connect you to our Support Team.`,

  // Step 7: Closing
  closing: (name) =>
    `It was lovely chatting with you, *${name}*. Wishing you lots of Marzi moments ahead!`,

  // Error messages
  invalidResponse: () =>
    "I didn't understand that. Could you please reply with the options provided?",

  invalidDOB: () =>
    "Please share your Date of Birth in DD-MM-YYYY format (e.g., 15-06-1965).",

  invalidMenuOption: () =>
    "Please reply with a number from 1-4 to select an option."
};

/**
 * Get message template
 * @param {string} key - Message key
 * @param {...any} args - Arguments for template
 * @returns {string} Formatted message
 */
function getMessage(key, ...args) {
  const template = MESSAGES[key];
  if (!template) {
    console.error(JSON.stringify({
      message: 'Message template not found',
      key
    }));
    return MESSAGES.invalidResponse();
  }
  return typeof template === 'function' ? template(...args) : template;
}

module.exports = {
  getMessage,
  MESSAGES
};

