// Run this in browser console to END THE CURRENT ROUND:

(function() {
  var params = new URLSearchParams(window.location.search);
  var sessionID = params.get('sessionID');
  var rgsUrl = params.get('rgs_url') || '';
  
  console.log('=== TEST END-ROUND ===');
  console.log('sessionID:', sessionID);
  console.log('rgsUrl:', rgsUrl);
  
  if (!rgsUrl || rgsUrl === 'null' || rgsUrl === '') {
    console.log('ERROR: No rgs_url - running in demo mode');
    return;
  }
  
  if (!sessionID || sessionID === 'null' || sessionID === '') {
    console.log('ERROR: No sessionID');
    return;
  }
  
  rgsUrl = rgsUrl.replace(/\/$/, '');
  var url = rgsUrl + '/wallet/end-round';
  
  console.log('POST', url);
  console.log('Body:', JSON.stringify({ sessionID: sessionID }));
  
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionID: sessionID })
  })
  .then(function(res) {
    console.log('HTTP Status:', res.status);
    return res.json();
  })
  .then(function(data) {
    console.log('Response:', data);
  })
  .catch(function(e) {
    console.log('Error:', e);
  });
})();