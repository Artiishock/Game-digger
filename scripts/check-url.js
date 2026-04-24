// Get sessionID and rgs_url from game's stored values:

// First try to get from window or game store if available
console.log('=== GET RGS PARAMS ===');

// Method 1: Check if game has stored these
var gameEl = document.getElementById('root');
console.log('Root element:', gameEl);

// Method 2: Check what the game actually uses - look at game store or console
// The best way is to check the fetch calls the game makes

// Let's create a simple fetch test from console that uses the game's base_url
// Look at actual URL in browser address bar:
// If URL is like: https://something.cdn.stake-engine.com/game/version/index.html?sessionID=xxx&rgs_url=xxx

var url = window.location.href;
console.log('Full URL:', url);

// Parse from URL
var match = url.match(/rgs_url=([^&]+)/);
var rgsUrl = match ? match[1] : null;
console.log('rgs_url from URL:', rgsUrl);

var match2 = url.match(/sessionID=([^&]+)/);
var sessionId = match2 ? match2[1] : null;
console.log('sessionID from URL:', sessionId);

// Test play (should work):
if (rgsUrl && sessionId) {
  var base = rgsUrl.indexOf('http') === 0 ? rgsUrl : 'https://' + rgsUrl;
  console.log('Testing POST to:', base + '/wallet/end-round');
  
  fetch(base + '/wallet/end-round', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({sessionID: sessionId})
  }).then(function(r) { return r.json(); })
  .then(function(d) { console.log('SUCCESS:', d); })
  .catch(function(e) { console.log('ERROR:', e); });
}
else {
  console.log('Missing params - cannot test');
}