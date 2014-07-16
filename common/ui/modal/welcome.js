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

/*  var crx = typeof chrome !== 'undefined';
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
*/
  function init() {
    var qs = jQuery.parseQuerystring();
    parentID = qs.parent;
    id = qs.id;
    //name = 'welcome-' + id;

    port = mvelo.extension.connect({name: 'welcome-'+id});
    //port.onMessage.addListener(messageListener);

    $('#advancedBtn').click(onAdvanced);
    $('#getStartedBtn').click(onGetStarted);
    $('#genKeySubmit').click(onGenerateKey);
    $('#genKeyClear').click(onClear);

    $('#infoForm').hide();
    
    //port = mvelo.extension.connect({name: name});
    //port.onMessage.addListener(messageListener);
  }

  function onGetStarted() {
  //Ask user for information necessary to generate keys
    //window.location.href="#infoForm";
    $('.info-text').hide();
    $('#initialBtns').hide();
    $('#infoForm').show();
  }

  function onAdvanced() {
  //send user to mailvelope generate key page
    port.postMessage({event: 'options-page', sender: name});
  }

  function onGenerateKey() {
    validateEmail(function() {
      $('body').addClass('busy');
      $('#genKeyWait').one('shown', generateKeyWelcome);
      $('#genKeyWait').modal('show');
    });
    return false;
  }

  function onClear() {
    $('#infoForm').find('input').val('');
    return false;
  }

  function validateEmail(next) {
    var email = $('#genKeyEmail');
    // validate email
    keyRing.viewModel('validateEmail', [email.val()], function(valid) {
      if (valid) {
        email.closest('.control-group').removeClass('error');
        email.next().addClass('hide');
        next();
      } else {
        email.closest('.control-group').addClass('error');
        email.next().removeClass('hide');
        return;
      }
    });
  }

  function generateKeyWelcome() {
    var options = {};
    var result;
    var error;
    options.algorithm = 'RSA/RSA';
    options.numBits = '2048';
    options.user = $('#genKeyName').val();
    options.email = $('#genKeyEmail').val();
    options.passphrase = '';
    //talk directly to controller
    data = {
      event: 'viewmodel',
      method: "generateKey",
      args: [options],
      callback: function(result, error) {
        if (!error) {
          $('#genAlert').showAlert('Success', 'New key generated and imported into key ring', 'success');
          $('#generateKey').find('input, select').prop('disabled', true);
          $('#genKeySubmit, #genKeyClear').prop('disabled', true);
          // refresh grid
          keyRing.event.triggerHandler('keygrid-reload');
        } else {
          $('#genAlert').showAlert('Generation Error', error.type === 'error' ? error.message : '', 'error');
        }
        $('body').removeClass('busy');
        $('#genKeyWait').modal('hide');
      }
    };
    alert('welcome: sendingMessageEvent');
    mvelo.extension.sendMessage(data, function(response) {
        if (data.callback) {
          var respObj = {
            event: "viewmodel-response",
            result: response.result,
            error: response.error,
            //id: data.id
          };
          event.source.postMessage(JSON.stringify(respObj), '*');
        }
      });
  }

  $(document).ready(init);

}());
