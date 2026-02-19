/**
 * Flow runner: given state + user input + flow definition, evaluate current node and return response.
 * Node types: message (send text, go to next), menu (match options), condition (branch by when), action (update CRM/state, then next).
 * Message templates use {{name}}, {{city}}, etc. substituted from state.userProfile and stepData.
 * Memory: avoids large string duplication; reuses state object for updates.
 */
const {
  calculateAge,
  isValidDOB,
  isYes,
  isNo,
  getMenuOption,
  extractName,
  extractDOB,
  extractCity,
  isBangaloreFuzzy
} = require('./utils/helpers');

/**
 * Substitute {{var}} in template with values from profile and stepData.
 * @param {string} template - e.g. "Lovely to meet you, {{name}}!"
 * @param {object} profile - userProfile from state
 * @param {object} stepData - state.stepData
 * @returns {string}
 */
function substituteTemplate(template, profile = {}, stepData = {}) {
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (profile[key] !== undefined && profile[key] !== null) return String(profile[key]);
    if (stepData[key] !== undefined && stepData[key] !== null) return String(stepData[key]);
    return '';
  });
}

/**
 * Resolve message text: from flow.messages[key] or node.text, then substitute.
 */
function resolveMessage(flow, node, profile, stepData) {
  const messages = flow.messages || {};
  const text = node.messageKey ? (messages[node.messageKey] || node.messageKey) : (node.text || '');
  return substituteTemplate(text, profile, stepData);
}

/**
 * Evaluate condition "when" string against current state/profile/input.
 * Supports: crm_new, crm_lead, crm_registered, crm_activated, age_under_50, age_50_plus, city_bangalore, city_other, valid_dob, valid_name, valid_city.
 */
function evaluateCondition(when, state, userInput, userProfile) {
  const profile = state.userProfile || {};
  const stepData = state.stepData || {};
  const step = state.currentStep || '';

  switch (when) {
    case 'crm_new':
      return !userProfile || !userProfile.mobile;
    case 'crm_lead':
      return userProfile && (userProfile.status === 'lead' || (userProfile.ageValidated === false));
    case 'crm_registered':
      return userProfile && userProfile.status === 'registered';
    case 'crm_activated':
      return userProfile && userProfile.status === 'activated';
    case 'age_under_50':
      return (profile.age !== undefined && profile.age !== null && profile.age < 50) ||
        (stepData.age !== undefined && stepData.age < 50);
    case 'age_50_plus':
      return (profile.age !== undefined && profile.age !== null && profile.age >= 50) ||
        (stepData.age !== undefined && stepData.age >= 50);
    case 'city_bangalore':
      return isBangaloreFuzzy(profile.city || stepData.city || userInput);
    case 'city_other':
      return !isBangaloreFuzzy(profile.city || stepData.city || userInput);
    case 'missing_name':
      return !(profile.name || stepData.name);
    case 'missing_dob':
      return !(profile.dob || stepData.dob);
    case 'missing_city':
      return !(profile.city || stepData.city);
    case 'valid_name':
      return !!extractName(userInput);
    case 'valid_dob':
      return isValidDOB(extractDOB(userInput) || userInput);
    case 'valid_city':
      return !!extractCity(userInput) || (userInput && userInput.trim().length >= 2);
    default:
      return false;
  }
}

/**
 * Run one step of the flow. Modifies state in place where needed; returns response and next step.
 * @param {object} state - { mobile, conversationId, currentStep, flowState, userProfile, stepData }
 * @param {string} userInput - Raw user message
 * @param {object} userProfile - From CRM (getUserProfile)
 * @param {object} flow - Flow definition from loadFlow()
 * @returns {Promise<{ messages: Array<{ type: string, body: string }>, nextStep: string, updatedState: object, shouldEscalate?: boolean }>}
 */
async function runFlow(state, userInput, userProfile, flow) {
  const nodes = flow.nodes || {};
  let currentStep = state.currentStep || flow.start || 'start';
  const outMessages = [];
  let shouldEscalate = false;
  const updatedState = { ...state, userProfile: state.userProfile || {}, stepData: state.stepData || {} };
  const profile = updatedState.userProfile;
  const stepData = updatedState.stepData;

  let node = nodes[currentStep];
  if (!node) {
    const flowStart = flow.start || 'start';
    if (flowStart !== currentStep && nodes[flowStart]) {
      console.warn(JSON.stringify({ event: 'flow_step_reset', staleStep: currentStep, resetTo: flowStart }));
      currentStep = flowStart;
      updatedState.currentStep = flowStart;
      updatedState.flowState = flowStart;
      node = nodes[currentStep];
    }
    if (!node) {
      outMessages.push({ type: 'text', body: 'Sorry, something went wrong. Please try again later.' });
      return { messages: outMessages, nextStep: currentStep, updatedState };
    }
  }

  const input = (userInput || '').trim();

  switch (node.type) {
    case 'message': {
      const nextNode = nodes[node.next];
      if (nextNode && nextNode.type === 'action' && input) {
        updatedState.currentStep = node.next;
        node = nextNode;
      } else {
        const body = resolveMessage(flow, node, profile, stepData);
        if (body) outMessages.push({ type: 'text', body });
        updatedState.currentStep = node.next || currentStep;
        break;
      }
    }
    case 'action': {
      let actionSucceeded = false;
      if (node.action === 'save_name' && input) {
        const name = extractName(input);
        if (name) {
          profile.name = name;
          stepData.name = name;
          actionSucceeded = true;
        }
      }
      if (node.action === 'save_dob' && input) {
        const dob = extractDOB(input) || (isValidDOB(input.trim()) ? input.trim() : null);
        if (dob) {
          profile.dob = stepData.dob = dob;
          const age = calculateAge(dob);
          if (age !== null) {
            stepData.age = age;
            profile.age = age;
          }
          actionSucceeded = true;
        }
      }
      if (node.action === 'save_city' && input) {
        const raw = extractCity(input) || input.trim();
        if (raw && raw.length >= 2) {
          const city = isBangaloreFuzzy(raw) ? 'Bengaluru' : raw;
          profile.city = stepData.city = city;
          if (isBangaloreFuzzy(raw)) profile.area = stepData.area = null;
          actionSucceeded = true;
        }
      }
      if (node.action === 'save_area' && input) {
        const area = input.trim();
        if (area) {
          profile.area = stepData.area = area;
          actionSucceeded = true;
        }
      }
      if (node.action === 'save_referral_name' && input) {
        const name = extractName(input) || input.trim();
        if (name && name.length >= 2) {
          stepData.referral_name = name;
          actionSucceeded = true;
        }
      }
      if (node.action === 'save_referral_mobile' && input) {
        const m = String(input).replace(/\D/g, '');
        if (m.length >= 10) {
          stepData.referral_mobile = m;
          actionSucceeded = true;
        }
      }
      if (node.action === 'save_referral_city' && input) {
        const city = extractCity(input) || input.trim();
        if (city) {
          stepData.referral_city = city;
          actionSucceeded = true;
          if (stepData.referral_name && stepData.referral_mobile) {
            shouldEscalate = true;
            updatedState.referralEscalation = {
              referralName: stepData.referral_name,
              referralMobile: stepData.referral_mobile,
              referralCity: stepData.referral_city
            };
          }
        }
      }
      if (node.action === 'referral_end') {
        shouldEscalate = true;
        updatedState.referralEscalation = {
          referralName: stepData.referral_name,
          referralMobile: stepData.referral_mobile,
          referralCity: stepData.referral_city
        };
      }
      if (node.action === 'escalate_support') {
        shouldEscalate = true;
        updatedState.supportEscalation = true;
      }
      if (node.action === 'referral_end') {
        actionSucceeded = true;
      }
      if (actionSucceeded) {
        updatedState.currentStep = node.next || currentStep;
        let nextNode = nodes[updatedState.currentStep];
        if (nextNode && nextNode.type === 'message') {
          const body = resolveMessage(flow, nextNode, profile, stepData);
          if (body) outMessages.push({ type: 'text', body });
        } else if (nextNode && nextNode.type === 'condition') {
          const conditions = nextNode.conditions || [];
          let next = nextNode.defaultNext || updatedState.currentStep;
          for (const c of conditions) {
            if (evaluateCondition(c.when, updatedState, input, userProfile)) {
              next = c.next;
              break;
            }
          }
          updatedState.currentStep = next;
          const targetNode = nodes[next];
          if (targetNode && (targetNode.type === 'message' || targetNode.type === 'menu')) {
            const body = resolveMessage(flow, targetNode, profile, stepData);
            if (body) outMessages.push({ type: 'text', body });
            if (targetNode.next) updatedState.currentStep = targetNode.next;
          }
        }
      } else {
        const retryKey = node.retryMessageKey || node.messageKey;
        if (retryKey) {
          const messages = flow.messages || {};
          const body = substituteTemplate(messages[retryKey] || retryKey, profile, stepData);
          if (body) outMessages.push({ type: 'text', body: `Could you please try again? ${body}` });
        } else {
          outMessages.push({ type: 'text', body: 'Could you please provide that again?' });
        }
      }
      break;
    }
    case 'menu': {
      const options = node.options || [];
      let matchedNext = node.defaultNext || null;
      if (options.length > 0) {
        const choice = getMenuOption(input);
        if (choice !== null) {
          const opt = options.find(o => o.value === choice || o.value === String(choice) || o.label === String(choice));
          if (opt) matchedNext = opt.next;
        }
        if (isYes(input)) matchedNext = matchedNext || (options.find(o => o.value === 'yes') || {}).next;
        if (isNo(input)) matchedNext = matchedNext || (options.find(o => o.value === 'no') || {}).next;
      }
      if (matchedNext) {
        const targetNode = nodes[matchedNext];
        if (targetNode && targetNode.type === 'message' && targetNode.next) {
          const body = resolveMessage(flow, targetNode, profile, stepData);
          if (body) outMessages.push({ type: 'text', body });
          updatedState.currentStep = targetNode.next;
        } else if (targetNode && targetNode.type === 'action' && targetNode.next) {
          if (targetNode.action === 'escalate_support') {
            shouldEscalate = true;
            updatedState.supportEscalation = true;
          }
          const nextNode = nodes[targetNode.next];
          if (nextNode && nextNode.type === 'message') {
            const body = resolveMessage(flow, nextNode, profile, stepData);
            if (body) outMessages.push({ type: 'text', body });
          }
          updatedState.currentStep = targetNode.next;
        } else if (targetNode && targetNode.type === 'menu') {
          const body = resolveMessage(flow, targetNode, profile, stepData);
          if (body) outMessages.push({ type: 'text', body });
          updatedState.currentStep = matchedNext;
        } else {
          const body = resolveMessage(flow, node, profile, stepData);
          if (body) outMessages.push({ type: 'text', body });
          updatedState.currentStep = matchedNext || node.next || currentStep;
        }
      } else {
        const body = resolveMessage(flow, node, profile, stepData);
        if (body) outMessages.push({ type: 'text', body });
        updatedState.currentStep = node.next || currentStep;
      }
      break;
    }
    case 'condition': {
      const conditions = node.conditions || [];
      let next = node.defaultNext || currentStep;
      for (const c of conditions) {
        if (evaluateCondition(c.when, updatedState, input, userProfile)) {
          next = c.next;
          break;
        }
      }
      updatedState.currentStep = next;
      // Send the target node's message (e.g. check_crm -> hook_intro sends hook_namaste)
      const nextNode = nodes[next];
      if (nextNode && (nextNode.type === 'message' || nextNode.type === 'menu')) {
        const body = resolveMessage(flow, nextNode, profile, stepData);
        if (body) outMessages.push({ type: 'text', body });
        // Advance to that node's next so we don't re-send same message (e.g. hook_intro -> hook_ask_yes_no)
        if (nextNode.next) updatedState.currentStep = nextNode.next;
      } else if (node.messageKey) {
        const body = resolveMessage(flow, node, profile, stepData);
        if (body) outMessages.push({ type: 'text', body });
      }
      break;
    }
    default: {
      const body = resolveMessage(flow, node, profile, stepData);
      if (body) outMessages.push({ type: 'text', body });
      updatedState.currentStep = node.next || currentStep;
    }
  }

  updatedState.lastInteraction = Date.now();
  updatedState.flowState = updatedState.currentStep;
  const out = {
    messages: outMessages,
    nextStep: updatedState.currentStep,
    updatedState,
    shouldEscalate
  };
  if (updatedState.referralEscalation) out.referralEscalation = updatedState.referralEscalation;
  if (updatedState.supportEscalation) out.supportEscalation = updatedState.supportEscalation;
  return out;
}

module.exports = { runFlow, substituteTemplate, resolveMessage, evaluateCondition };
