/**
 * Google Apps Script: WhatsApp Bot Dashboard
 * Multi-tab dashboard: Stats, Users (with search), Message Trail.
 * APIs: /dashboard/stats, /dashboard/users, /dashboard/conversations, /dashboard/messages
 */

const API_BASE = 'https://jmv0oz53r4.execute-api.ap-south-1.amazonaws.com/prod';
const STATS_URL = API_BASE + '/dashboard/stats';
const USERS_URL = API_BASE + '/dashboard/users';
const CONVERSATIONS_URL = API_BASE + '/dashboard/conversations';
const MESSAGES_URL = API_BASE + '/dashboard/messages';
const DEFAULT_LIMIT = 100;
const MESSAGES_LIMIT = 500;
const PAGINATION_KEY_PROP = 'dashboard_users_lastKey';

// Sheet names (tabs)
const SHEET_DASHBOARD = 'Dashboard';
const SHEET_USERS = 'Users';
const SHEET_SEARCH = 'Search User';
const SHEET_MESSAGE_TRAIL = 'Message Trail';

/**
 * Generic GET request to API.
 */
function apiGet(url) {
  var options = { method: 'get', muteHttpExceptions: true, headers: {} };
  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code !== 200) {
    return { success: false, error: 'HTTP ' + code, body: text };
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return { success: false, error: 'Invalid JSON', body: text };
  }
}

/**
 * Fetch dashboard stats. GET /dashboard/stats (no params).
 */
function fetchStatsFromAPI() {
  return apiGet(STATS_URL);
}

/**
 * Fetch users from API (one page).
 * GET /dashboard/users?limit=&lastKey=
 */
function fetchUsersFromAPI(limit, lastKey) {
  var url = USERS_URL + '?limit=' + (limit || DEFAULT_LIMIT);
  if (lastKey) {
    url += '&lastKey=' + encodeURIComponent(lastKey);
  }
  return apiGet(url);
}

/**
 * Fetch single user by mobile. GET /dashboard/users?mobile=
 */
function fetchUserByMobileFromAPI(mobile) {
  if (!mobile || String(mobile).trim() === '') return { success: false, error: 'Mobile required' };
  var url = USERS_URL + '?mobile=' + encodeURIComponent(String(mobile).trim());
  return apiGet(url);
}

/**
 * Fetch conversation state for a user. GET /dashboard/conversations?mobile=
 */
function fetchConversationFromAPI(mobile) {
  if (!mobile || String(mobile).trim() === '') return { success: false, error: 'Mobile required' };
  var url = CONVERSATIONS_URL + '?mobile=' + encodeURIComponent(String(mobile).trim());
  return apiGet(url);
}

/**
 * Fetch messages for a user. GET /dashboard/messages?mobile=&limit=&lastTimestamp=
 */
function fetchMessagesFromAPI(mobile, limit, lastTimestamp) {
  if (!mobile || String(mobile).trim() === '') return { success: false, error: 'Mobile required' };
  var url = MESSAGES_URL + '?mobile=' + encodeURIComponent(String(mobile).trim()) + '&limit=' + (limit || MESSAGES_LIMIT);
  if (lastTimestamp) {
    url += '&lastTimestamp=' + encodeURIComponent(lastTimestamp);
  }
  return apiGet(url);
}

/**
 * Format milliseconds timestamp to readable date-time string.
 */
function formatTimestamp(ms) {
  if (ms == null || ms === '') return '';
  var d = new Date(Number(ms));
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm');
}

/**
 * Flatten one user item into a row array matching header order.
 */
function itemToRow(item) {
  var i = item.interactions || {};
  var p = item.preferences || {};
  return [
    item.name || '',
    item.city || '',
    item.mobile || '',
    formatTimestamp(item.createdAt),
    formatTimestamp(item.registrationDate),
    item.status || '',
    item.source || '',
    item.profileType || '',
    item.dob || '',
    item.age != null ? item.age : '',
    item.ageEligible === true ? 'Yes' : (item.ageEligible === false ? 'No' : ''),
    item.waNumber || '',
    item.savedBy || '',
    i.totalMessages != null ? i.totalMessages : '',
    i.escalations != null ? i.escalations : '',
    formatTimestamp(i.lastMessageDate),
    p.health === true ? 'Yes' : (p.health === false ? 'No' : ''),
    p.holidays === true ? 'Yes' : (p.holidays === false ? 'No' : ''),
    p.community === true ? 'Yes' : (p.community === false ? 'No' : ''),
    p.events === true ? 'Yes' : (p.events === false ? 'No' : ''),
    formatTimestamp(item.updatedAt)
  ];
}

/**
 * Header row (same order as itemToRow).
 */
function getHeaders() {
  return [
    'Name',
    'City',
    'Phone Number',
    'Created At',
    'Registration Date',
    'Status',
    'Source',
    'Profile Type',
    'DOB',
    'Age',
    'Age Eligible',
    'WA Number',
    'Saved By',
    'Total Messages',
    'Escalations',
    'Last Message Date',
    'Preference Health',
    'Preference Holidays',
    'Preference Community',
    'Preference Events',
    'Updated At'
  ];
}

/**
 * Ensure dashboard sheets exist (Dashboard, Users, Search User, Message Trail).
 */
function ensureDashboardSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = [SHEET_DASHBOARD, SHEET_USERS, SHEET_SEARCH, SHEET_MESSAGE_TRAIL];
  for (var i = 0; i < names.length; i++) {
    if (!ss.getSheetByName(names[i])) {
      ss.insertSheet(names[i], i);
    }
  }
  // Move Dashboard to first position if not already
  var dashboard = ss.getSheetByName(SHEET_DASHBOARD);
  if (dashboard && ss.getSheets()[0].getName() !== SHEET_DASHBOARD) {
    ss.setActiveSheet(dashboard);
    ss.moveActiveSheet(0);
  }
  // Message Trail: show instruction in A1 if sheet is empty
  var trailSheet = ss.getSheetByName(SHEET_MESSAGE_TRAIL);
  if (trailSheet && trailSheet.getLastRow() === 0) {
    trailSheet.getRange('A1').setValue('Mobile (10 digits or with country code):');
    trailSheet.getRange('A1').setFontWeight('bold');
  }
}

/**
 * Refresh stats and write to Dashboard sheet.
 */
function refreshStats() {
  ensureDashboardSheets();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DASHBOARD);
  if (!sheet) return;
  sheet.clear();

  var result = fetchStatsFromAPI();
  if (!result.success) {
    sheet.getRange(1, 1).setValue('Error: ' + (result.error || 'Unknown'));
    return;
  }
  var data = result.data;
  if (!data) {
    sheet.getRange(1, 1).setValue('No stats data.');
    return;
  }

  var tz = Session.getScriptTimeZone() || 'Asia/Kolkata';
  var updated = data.timestamp ? Utilities.formatDate(new Date(data.timestamp), tz, 'dd-MMM-yyyy HH:mm') : '';

  var statsRows = [
    ['WhatsApp Bot – Dashboard', ''],
    ['', ''],
    ['Metric', 'Value'],
    ['Total users', data.totalUsers != null ? data.totalUsers : ''],
    ['Eligible users (50+)', data.eligibleUsers != null ? data.eligibleUsers : ''],
    ['Active conversations', data.activeConversations != null ? data.activeConversations : ''],
    ['Pending escalations', data.pendingEscalations != null ? data.pendingEscalations : ''],
    ['Messages (last 24h)', data.messagesLast24h != null ? data.messagesLast24h : ''],
    ['', ''],
    ['Last updated', updated]
  ];
  for (var r = 0; r < statsRows.length; r++) {
    sheet.getRange(r + 1, 1).setValue(statsRows[r][0]);
    sheet.getRange(r + 1, 2).setValue(statsRows[r][1] !== undefined ? statsRows[r][1] : '');
  }
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sheet.getRange(3, 1, 3, 2).setFontWeight('bold');
  sheet.getRange(1, 1, statsRows.length, 2).setHorizontalAlignment('left');
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  SpreadsheetApp.getUi().alert('Dashboard stats updated.');
}

/**
 * Clear Users sheet and write users (first page). Saves lastEvaluatedKey for "Load next page".
 */
function refreshUsers() {
  ensureDashboardSheets();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (!sheet) return;
  sheet.clear();
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(PAGINATION_KEY_PROP);

  var result = fetchUsersFromAPI(DEFAULT_LIMIT, null);
  if (!result.success) {
    sheet.getRange(1, 1).setValue('Error: ' + (result.error || 'Unknown') + (result.body ? '\n' + result.body : ''));
    return;
  }

  var data = result.data;
  if (!data || !data.items) {
    sheet.getRange(1, 1).setValue('No data or invalid response.');
    return;
  }

  var headers = getHeaders();
  var userRows = [headers];
  for (var i = 0; i < data.items.length; i++) {
    userRows.push(itemToRow(data.items[i]));
  }

  var lastKey = data.lastEvaluatedKey || null;
  if (lastKey) {
    props.setProperty(PAGINATION_KEY_PROP, lastKey);
  }

  for (var r = 0; r < userRows.length; r++) {
    sheet.getRange(r + 1, 1, 1, headers.length).setValues([userRows[r]]);
  }
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  SpreadsheetApp.getUi().alert('Loaded ' + data.items.length + ' users.' + (lastKey ? ' Use "Load next page" for more.' : ''));
}

/**
 * Append next page of users to Users sheet using stored lastKey.
 */
function loadNextPage() {
  ensureDashboardSheets();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (!sheet) return;
  var props = PropertiesService.getScriptProperties();
  var lastKey = props.getProperty(PAGINATION_KEY_PROP);
  if (!lastKey) {
    SpreadsheetApp.getUi().alert('No next page. Use "Refresh users" to load from the start.');
    return;
  }

  var result = fetchUsersFromAPI(DEFAULT_LIMIT, lastKey);
  if (!result.success) {
    SpreadsheetApp.getUi().alert('Error: ' + (result.error || 'Unknown'));
    return;
  }

  var data = result.data;
  if (!data || !data.items || data.items.length === 0) {
    props.deleteProperty(PAGINATION_KEY_PROP);
    SpreadsheetApp.getUi().alert('No more users.');
    return;
  }

  var headers = getHeaders();
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    lastRow = 1;
  }

  for (var i = 0; i < data.items.length; i++) {
    var oneRow = itemToRow(data.items[i]);
    lastRow++;
    sheet.getRange(lastRow, 1, 1, headers.length).setValues([oneRow]);
  }

  var newLastKey = data.lastEvaluatedKey || null;
  if (newLastKey) {
    props.setProperty(PAGINATION_KEY_PROP, newLastKey);
  } else {
    props.deleteProperty(PAGINATION_KEY_PROP);
  }

  SpreadsheetApp.getUi().alert('Added ' + data.items.length + ' users.' + (newLastKey ? '' : ' No more pages.'));
}

/**
 * Search for a user by mobile and show result on Search User sheet.
 */
function searchUserByMobile() {
  ensureDashboardSheets();
  var ui = SpreadsheetApp.getUi();
  var mobile = ui.prompt('Search user by mobile', 'Enter 10-digit mobile (e.g. 9936142128) or with country code (e.g. 919936142128)', ui.ButtonSet.OK_CANCEL);
  if (mobile.getSelectedButton() !== ui.Button.OK) return;
  var num = (mobile.getResponseText() || '').trim().replace(/\s/g, '');
  if (!num) {
    ui.alert('Please enter a mobile number.');
    return;
  }
  if (!/^\d+$/.test(num)) {
    ui.alert('Mobile should contain only digits.');
    return;
  }
  if (num.length === 10) {
    num = '91' + num;
  }

  var result = fetchUserByMobileFromAPI(num);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SEARCH);
  if (!sheet) return;
  sheet.clear();

  if (!result.success) {
    sheet.getRange(1, 1).setValue('Error: ' + (result.error || 'Unknown'));
    return;
  }
  var user = result.data;
  if (!user || (typeof user === 'object' && user.mobile === undefined && !user.name)) {
    sheet.getRange(1, 1).setValue('User not found for mobile: ' + num);
    return;
  }

  var i = user.interactions || {};
  var p = user.preferences || {};
  var searchData = [
    ['Search result: ' + num, ''],
    ['', ''],
    ['Name', user.name || ''],
    ['City', user.city || ''],
    ['Mobile', user.mobile || ''],
    ['WA Number', user.waNumber || ''],
    ['DOB', user.dob || ''],
    ['Age', user.age != null ? user.age : ''],
    ['Age eligible', user.ageEligible === true ? 'Yes' : 'No'],
    ['Status', user.status || ''],
    ['Source', user.source || ''],
    ['Created at', formatTimestamp(user.createdAt)],
    ['Updated at', formatTimestamp(user.updatedAt)],
    ['Registration date', formatTimestamp(user.registrationDate)],
    ['', ''],
    ['Interactions', ''],
    ['Total messages', i.totalMessages != null ? i.totalMessages : ''],
    ['Escalations', i.escalations != null ? i.escalations : ''],
    ['Last message', formatTimestamp(i.lastMessageDate)],
    ['', ''],
    ['Preferences', ''],
    ['Health', p.health ? 'Yes' : 'No'],
    ['Holidays', p.holidays ? 'Yes' : 'No'],
    ['Community', p.community ? 'Yes' : 'No'],
    ['Events', p.events ? 'Yes' : 'No']
  ];
  var numRows = searchData.length;
  for (var r = 0; r < numRows; r++) {
    var pair = searchData[r];
    sheet.getRange(r + 1, 1).setValue(pair[0] !== undefined ? pair[0] : '');
    sheet.getRange(r + 1, 2).setValue(pair[1] !== undefined ? pair[1] : '');
  }
  sheet.getRange(1, 1).setFontWeight('bold');
  sheet.getRange(1, 1, numRows, 2).setHorizontalAlignment('left');
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  ui.alert('Result shown on "' + SHEET_SEARCH + '" tab.');
}

/**
 * Fetch message trail for mobile in Message Trail sheet (cell B1) and display conversation + messages.
 */
function fetchMessageTrail() {
  ensureDashboardSheets();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MESSAGE_TRAIL);
  if (!sheet) return;
  var mobile = (sheet.getRange('B1').getValue() || '').toString().trim().replace(/\s/g, '');
  if (!mobile) {
    sheet.getRange('A1').setValue('Mobile (10 digits or with country code):');
    sheet.getRange('B1').setValue('');
    SpreadsheetApp.getUi().alert('Enter mobile number in cell B1, then run "Fetch message trail" again.');
    return;
  }
  if (!/^\d+$/.test(mobile)) {
    SpreadsheetApp.getUi().alert('Mobile in B1 should contain only digits.');
    return;
  }
  if (mobile.length === 10) {
    mobile = '91' + mobile;
  }

  sheet.clear();
  sheet.getRange('A1').setValue('Mobile (10 digits or with country code):');
  sheet.getRange('B1').setValue(mobile);

  var convResult = fetchConversationFromAPI(mobile);
  var msgResult = fetchMessagesFromAPI(mobile, MESSAGES_LIMIT, null);

  var row = 2;
  if (!convResult.success) {
    sheet.getRange(row, 1).setValue('Conversation: Error - ' + (convResult.error || 'Unknown'));
    row += 2;
  } else {
    var conv = convResult.data;
    if (!conv) {
      sheet.getRange(row, 1).setValue('Conversation: No state found.');
      row += 2;
    } else {
      sheet.getRange(row, 1).setValue('Conversation state');
      sheet.getRange(row, 1).setFontWeight('bold');
      row++;
      var lines = [
        ['Conversation ID', conv.conversationId || ''],
        ['Flow state', conv.flowState || ''],
        ['Current step', conv.currentStep || ''],
        ['Last interaction', formatTimestamp(conv.lastInteraction)],
        ['Created at', formatTimestamp(conv.createdAt)],
        ['Updated at', formatTimestamp(conv.updatedAt)]
      ];
      var stepData = conv.stepData || {};
      var collect = stepData.collectDetails || {};
      var referral = stepData.referralDetails || {};
      lines.push(['— Step: collectDetails', '']);
      lines.push(['  Name', collect.name || '']);
      lines.push(['  City', collect.city || '']);
      lines.push(['  DOB', collect.dob || '']);
      lines.push(['  Age', collect.age != null ? collect.age : '']);
      lines.push(['  Completed', collect.completed ? 'Yes' : 'No']);
      lines.push(['— Step: referralDetails', '']);
      lines.push(['  Parent mobile', referral.parentMobile || '']);
      lines.push(['  Parent name', referral.parentName || '']);
      lines.push(['  Parent city', referral.parentCity || '']);
      var profile = conv.userProfile || {};
      lines.push(['— User profile (snapshot)', '']);
      lines.push(['  Name', profile.name || '']);
      lines.push(['  Mobile', profile.mobile || '']);
      lines.push(['  City', profile.city || '']);
      lines.push(['  DOB', profile.dob || '']);
      lines.push(['  Age', profile.age != null ? profile.age : '']);
      for (var l = 0; l < lines.length; l++) {
        sheet.getRange(row, 1).setValue(lines[l][0]);
        sheet.getRange(row, 2).setValue(lines[l][1]);
        row++;
      }
      row++;
    }
  }

  if (!msgResult.success) {
    sheet.getRange(row, 1).setValue('Messages: Error - ' + (msgResult.error || 'Unknown'));
    row += 2;
  } else {
    var msgData = msgResult.data;
    var items = (msgData && msgData.items) ? msgData.items : [];
    sheet.getRange(row, 1).setValue('Message trail (' + items.length + ' messages)');
    sheet.getRange(row, 1).setFontWeight('bold');
    row++;
    sheet.getRange(row, 1, row, 4).setValues([['Time', 'Direction', 'Content', 'Message ID']]);
    sheet.getRange(row, 1, row, 4).setFontWeight('bold');
    row++;
    for (var m = 0; m < items.length; m++) {
      var it = items[m];
      var dir = (it.direction || it.type || '').toLowerCase();
      var content = it.text || it.body || it.content || it.message || JSON.stringify(it);
      if (content && content.length > 200) {
        content = content.substring(0, 200) + '…';
      }
      sheet.getRange(row, 1).setValue(formatTimestamp(it.timestamp));
      sheet.getRange(row, 2).setValue(dir);
      sheet.getRange(row, 3).setValue(content);
      sheet.getRange(row, 4).setValue(it.messageId || it.id || '');
      row++;
    }
  }

  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  SpreadsheetApp.getUi().alert('Message trail loaded. See "' + SHEET_MESSAGE_TRAIL + '" tab.');
}

/**
 * Add custom menu when spreadsheet opens. Ensures all dashboard tabs exist.
 */
function onOpen() {
  ensureDashboardSheets();
  SpreadsheetApp.getUi()
    .createMenu('Dashboard')
    .addItem('Refresh stats', 'refreshStats')
    .addSeparator()
    .addItem('Refresh users', 'refreshUsers')
    .addItem('Load next page', 'loadNextPage')
    .addItem('Search user by mobile', 'searchUserByMobile')
    .addSeparator()
    .addItem('Fetch message trail', 'fetchMessageTrail')
    .addToUi();
}
