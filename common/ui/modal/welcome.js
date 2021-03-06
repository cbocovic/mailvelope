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

  var advShown = false;

  function init() {
    var qs = jQuery.parseQuerystring();
    parentID = qs.parent;
    id = qs.id;

    port = mvelo.extension.connect({name: 'welcome-'+id});
    port.onMessage.addListener(messageListener);
    //port.postMessage({event: 'welcome-popup-init', sender: 'welcome'+id});

    //$('#advancedBtn').click(onAdvanced);
    $('#getStartedBtn').click(onGetStarted);
    $('#genKeySubmit').click(onGenerateKey);
    $('#genKeyClear').click(onClear);
    $('#finishBtn').click(onFinish);
    $('#genKeyAdv').click(onKeyAdvanced);

    $('#infoForm').hide();
    $('#finalBtns').hide();
    
  }

  function onGetStarted() {
  //Ask user for information necessary to generate keys
    $('.info-text').hide();
    $('#initialBtns').hide();
    $('#infoForm').show();
  }

  function onKeyAdvanced() {
    if (advShown) {
      $('#genKeyAdvSection').slideUp();
      $('#genKeyAdv').text('Advanced >>');
      advShown = false;
    } else {
      $('#genKeyAdvSection').slideDown();
      $('#genKeyAdv').text('<< Advanced');
      advShown = true;
    }
    return false;
  }

  //function onAdvanced() {
  //send user to mailvelope generate key page
  //  port.postMessage({event: 'options-page', sender: name});
  //}

  function onGenerateKey() {
    validateEmail();
    return false;
  }

  function onClear() {
    $('#infoForm').find('input').val('');
    return false;
  }

  function onFinish() {
    port.postMessage({event: 'close-welcome', sender:name});
  }

  function validateEmail() {
    var email = $('#genKeyEmail');
    // validate email --- send directly to controller.
    var method = 'validateEmail';
    var args = [email.val()];
    var data = {
      event: "viewmodel-welcome",
      method: method,
      args: args,
    };
    mvelo.extension.sendMessage(data, function(response) {});
  }

  function generateKeyWelcome() {
    var options = {};
    var result;
    var error;
    options.algorithm = 'RSA/RSA';
    options.numBits = '2048';
    options.user = $('#genKeyName').val();
    options.email = $('#genKeyEmail').val();
    options.passphrase = 'woo';
    //talk directly to controller
    data = {
      event: 'viewmodel-welcome',
      method: "generateKey",
      args: [options],
    };

    mvelo.extension.sendMessage(data, function(response) {});
  }

  function validated(valid) {
    var email = $('#genKeyEmail');
    if (valid) {
      email.closest('.control-group').removeClass('error');
      email.next().addClass('hide');
      $('body').addClass('busy');
      $('#genKeyWait').one('shown', generateKeyWelcome);
      $('#genKeyWait').modal('show');
    } else {
      email.closest('.control-group').addClass('error');
      email.next().removeClass('hide');
      return;
    }
  }

  function generated(result, error) {
    if (!error) {
      $('#genAlert').showAlert('Success', 'Setup complete.', 'success');
      $('#formBtns').hide();
      keyRing.event.triggerHandler('keygrid-reload');
      $('#finalBtns').show();
      //load generated key as primary key into preferences
      data = {
        event: 'viewmodel-welcome',
        method: "getPrivateKeys"
      };
      mvelo.extension.sendMessage(data, function(response) {});
    } else {
      $('#genAlert').showAlert('Generation Error', error.type === 'error' ? error.message : '', 'error');
    }
    $('body').removeClass('busy');
    $('#genKeyWait').modal('hide');
  }

  function keyed(result) {
    console.log('genKeyResult: '+result[result.length-1].id);
    var update = {
      general: {
        primary_key: result[result.length-1].id,
        auto_add_primary: true
      }
    };
    mvelo.extension.sendMessage({ event: 'set-prefs', message: {data: update} }, function() {
      //normalize();
    });
    //reload gmail tab
    chrome.tabs.query({
      url: "https://mail.google.com/*"
    }, function(tabs) {
      tabs.forEach(function(tab){
        chrome.tabs.update(tab.id, {active:true});
        chrome.tabs.reload(tab.id);
      });
    });
  }
    

  function messageListener(data) {
    switch (data.event) {
      case 'viewmodel-response':
        switch (data.method) {
          case 'validateEmail':
            validated(data.result);
            break;
          case 'generateKey':
            generated(data.result, data.error);
            break;
          case 'getPrivateKeys':
            keyed(data.result);
            break;
        }
        break;
    }

  }

  $(document).ready(init);

}());
