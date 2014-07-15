/**
 * Author: Cecylia Bocovich
 * Date: 15 July 2014
 *
 *
 */
(function() {
  // shares ID with EncryptFrame
  var id;
  // id of encrypt frame that triggered this dialog
  var parentID;
  //port to communicate with background page
  var port;

  var crx = typeof chrome !== 'undefined';
  var sendMessage;
  if (!crx) {
    // Firefox
    sendMessage = function(msg) {
      addon.postMessage(msg);
    };
    addon.on('message', messageListener);
  } else {
    // Chrome
    sendMessage = function(msg) {
      chrome.runtime.sendMessage(msg, messageListener);
    };
  }

  function init() {
    var qs = jQuery.parseQuerystring();
    parentID = qs.parent;
    id = qs.id;
    //name = 'welcome-' + id;

    port = mvelo.extension.connect({name: 'welcome-'+id});
    //port.onMessage.addListener(messageListener);

    $('#advancedBtn').click(onAdvanced);
    $('#getStartedBtn').click(onGetStarted);
    
    //port = mvelo.extension.connect({name: name});
    //port.onMessage.addListener(messageListener);
  }

  function onGetStarted() {
  //Ask user for information necessary to generate keys
  }

  function onAdvanced() {
  //send user to mailvelope generate key page
    port.postMessage({event: 'options-page', sender: name});
    //hide();

  }


  $(document).ready(init);

}());
