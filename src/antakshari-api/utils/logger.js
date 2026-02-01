/**
 * Structured logger for Antakshari API.
 * Every important step and value is logged as JSON for request tracing.
 * @param {string} event - Event name (e.g. team_created, profile_updated)
 * @param {object} data - Key-value data (requestId, mobile, teamId, ref, etc.)
 */
function log(event, data = {}) {
  const line = { event, ...data, ts: new Date().toISOString() };
  console.log(JSON.stringify(line));
}

module.exports = {
  log
};
