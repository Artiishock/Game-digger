// Simple test - paste this in console:
// (Make sure you're on the game page first!)

var url = window.location.href;
var u = url.match(/rgs_url=([^&]+)/);
var s = url.match(/sessionID=([^&]+)/);

if (!u || !s) {
  console.log('URL params not found in address bar');
} else {
  var rgsUrl = decodeURIComponent(u[1]);
  var sessionID = s[1];
  console.log('rgs_url:', rgsUrl);
  console.log('sessionID:', sessionID);
  
  var base = rgsUrl.indexOf('http') === 0 ? rgsUrl : 'https://' + rgsUrl;
  var endpoint = base + '/wallet/end-round';
  
  console.log('POST', endpoint);
  console.log('Body:', JSON.stringify({sessionID: sessionID}));
  
  fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sessionID: sessionID})
  }).then(function(r) { return r.json(); })
  .then(function(d) { console.log('Response:', d); })
  .catch(function(e) { console.log('Error:', e); });
}