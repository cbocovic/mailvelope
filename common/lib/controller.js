/**
 * Mailvelope - secure email with OpenPGP encryption for Webmail
 * Copyright (C) 2012  Thomas Oberndörfer
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License version 3
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

define(function (require, exports, module) {

  var mvelo = require('../lib-mvelo').mvelo;
  var model = require('./pgpViewModel');
  var setup = require('./setup');
  var defaults = require('./defaults');
  var prefs = require('./prefs');
  var pwdCache = require('./pwdCache');
  var mailreader = require('mailreader-parser');

  // ports to main content scripts
  var mainCsPorts = {};
  // ports to decrypt frames
  var dFramePorts = {};
  // ports to decrypt dialogs
  var dDialogPorts = {};
  // ports for verification
  var vFramePorts = {};
  var vDialogPorts = {};
  // decrypt message buffer
  var messageBuffer = {};
  // ports to encrypt frames
  var eFramePorts = {};
  // ports to encrypt dialogs
  var eDialogPorts = {};
  // port to password dialog
  var pwdPort = null;
  // port to import key frames
  var imFramePorts = {};
  // port to request key frames
  var reqFramePorts = {};
  //port to welcome window
  var welcomePort = null;
  // editor window
  var editor = null;
  // decrypt popup window
  var decryptPopup = null;
  // verify popup window
  var verifyPopup = null;
  // password popup window
  var pwdPopup = null;
  // welcome popup window
  var welcomePopup = null;
  // recipients of encrypted mail
  var keyidBuffer = {};
  var scannedHosts = [];

  var specific = {};

  function extend(obj) {
    specific.initScriptInjection = obj.initScriptInjection;
    specific.activate = obj.activate;
    specific.deactivate = obj.deactivate;
  }

  function addPort(port) {
    var sender = parseName(port.name);
    switch (sender.name) {
      case 'mainCS':
        mainCsPorts[sender.id] = port;
        break;
      case 'dFrame':
        dFramePorts[sender.id] = port;
        break;
      case 'dDialog':
        if (dFramePorts[sender.id] && !dDialogPorts[sender.id]) {
          dDialogPorts[sender.id] = port;
        } else {
          // invalid
          port.disconnect();
        }
        break;
      case 'vFrame':
        vFramePorts[sender.id] = port;
        break;
      case 'vDialog':
        if (vFramePorts[sender.id] && !vDialogPorts[sender.id]) {
          vDialogPorts[sender.id] = port;
        } else {
          // invalid
          port.disconnect();
        }
        break;
      case 'eFrame':
        eFramePorts[sender.id] = port;
        break;
      case 'eDialog':
        if (eFramePorts[sender.id] && !eDialogPorts[sender.id]) {
          eDialogPorts[sender.id] =  port;
        } else {
          // invalid
          port.disconnect();
        }
        break;
      case 'pwdDialog':
        pwdPort = port;
        break;
      case 'editor':
        editor.port = port;
        break;
      case 'imFrame':
        imFramePorts[sender.id] = port;
        break;
      case 'reqFrame':
        reqFramePorts[sender.id] = port;
        break;
      case 'welcome':
        welcomePort = port;
        break;
      default:
        console.log('unknown port');
    }
  }

  function removePort(port) {
    var sender = parseName(port.name);
    switch (sender.name) {
      case 'mainCS':
        delete mainCsPorts[sender.id];
        break;
      case 'dFrame':
        delete dFramePorts[sender.id];
        messageBuffer[sender.id];
        break;
      case 'dDialog':
        delete dDialogPorts[sender.id];
        break;
      case 'vFrame':
        delete vFramePorts[sender.id];
        break;
      case 'vDialog':
        delete vDialogPorts[sender.id];
        break;
      case 'eFrame':
        delete eFramePorts[sender.id];
        messageBuffer[sender.id];
        break;
      case 'eDialog':
        delete eDialogPorts[sender.id];
        break;
      case 'pwdDialog':
        pwdPort = null;
        break;
      case 'editor':
        editor = null;
        break;
      case 'imFrame':
        delete imFramePorts[sender.id];
        break;
      case 'reqFrame':
        delete reqFramePorts[sender.id];
        break;
      case 'welcome':
        welcomePort = null;
        break;
      default:
        console.log('unknown port');
    }
  }

  function handlePortMessage(msg) {
    var id = parseName(msg.sender).id;
    switch (msg.event) {
      case 'pwd-dialog-cancel':
      case 'decrypt-dialog-cancel':
        // forward event to decrypt frame
        if (dFramePorts[id]) {
          dFramePorts[id].postMessage({event: 'dialog-cancel'});
        } else if (eFramePorts[id]) {
          editor && editor.port.postMessage({event: 'hide-pwd-dialog'});
          eFramePorts[id].postMessage({event: 'dialog-cancel'});
        }
        if (decryptPopup) {
          decryptPopup.close();
          decryptPopup = null;
        }
        if (pwdPopup) {
          pwdPopup.close();
          pwdPopup = null;
        }
        break;
      case 'encrypt-dialog-cancel':
        // forward event to encrypt frame
        eFramePorts[id].postMessage(msg);
        break;
      case 'decrypt-inline-init':
        if (pwdPort || mvelo.windows.modalActive) {
          // password dialog or modal dialog already open
          dFramePorts[id].postMessage({event: 'remove-dialog'});
        } else {
          // get armored message from dFrame
          dFramePorts[id].postMessage({event: 'armored-message'});
        }
        break;
      case 'verify-inline-init':
        // get armored message from vFrame
        vFramePorts[id].postMessage({event: 'armored-message'});
        break;
      case 'verify-popup-init':
        vFramePorts[id].postMessage({event: 'armored-message'});
        break;
      case 'decrypt-popup-init':
        // get armored message from dFrame
        dFramePorts[id].postMessage({event: 'armored-message'});
        break;
      //case 'welcome-popup-init':
        // get armored message from dFrame
        //welcomePort.postMessage({event: 'message-port-ref', port:welcomePort});
        //break;
      case 'pwd-dialog-init':
        // pass over keyid and userid to dialog
        pwdPort.postMessage({event: 'message-userid', userid: messageBuffer[id].userid, keyid: messageBuffer[id].key.primaryKey.getKeyId().toHex(), cache: prefs.data.security.password_cache});
        break;
      case 'vframe-display-popup':
        // prevent two open modal dialogs
        if (pwdPort || mvelo.windows.modalActive) {
          // password dialog or modal dialog already open
          vFramePorts[id].postMessage({event: 'remove-dialog'});
        } else {
          mvelo.windows.openPopup('common/ui/modal/verifyPopup.html?id=' + id, {width: 742, height: 450, modal: true}, function(window) {
            verifyPopup = window;
          });
        }
        break;
      case 'dframe-display-popup':
        // decrypt popup potentially needs pwd dialog
        if (pwdPort || mvelo.windows.modalActive) {
          // password dialog or modal dialog already open
          dFramePorts[id].postMessage({event: 'remove-dialog'});
        } else {
          mvelo.windows.openPopup('common/ui/modal/decryptPopup.html?id=' + id, {width: 742, height: 450, modal: true}, function(window) {
            decryptPopup = window;
          });
        }
        break;
      case 'dframe-armored-message':
        try {
          var message = model.readMessage(msg.data);
          // password or unlocked key in cache?
          var cache = pwdCache.get(message.key.primaryKey.getKeyId().toHex(), message.keyid);
          if (!cache) {
            // add message in buffer
            messageBuffer[id] = message;
            messageBuffer[id].callback = decryptMessage;
            // open password dialog
            if (prefs.data.security.display_decrypted == mvelo.DISPLAY_INLINE) {
              mvelo.windows.openPopup('common/ui/modal/pwdDialog.html?id=' + id, {width: 462, height: 377, modal: true}, function(window) {
                pwdPopup = window;
              });
            } else if (prefs.data.security.display_decrypted == mvelo.DISPLAY_POPUP) {
              dDialogPorts[id].postMessage({event: 'show-pwd-dialog'});
            }
          } else {
            checkCacheResult(cache, message, function() {
              decryptMessage(message, id);
            });
          }
        } catch (e) {
          // display error message in decrypt dialog
          dDialogPorts[id].postMessage({event: 'error-message', error: e.message});
        }
        break;
      case 'vframe-armored-message':
        var result;
        try {
          result = model.readCleartextMessage(msg.data);
        } catch (e) {
          vDialogPorts[id].postMessage({
            event: 'error-message',
            error: e.message
          });
          return;
        }
        model.verifyMessage(result.message, result.signers, function (err, verified) {
          if (err) {
            vDialogPorts[id].postMessage({
              event: 'error-message',
              error: err.message
            });
          } else {
            vDialogPorts[id].postMessage({
              event: 'verified-message',
              message: result.message.getText(),
              signers: verified
            });
          }
        });
        break;
      case 'verify-dialog-cancel':
        if (vFramePorts[id]) {
          vFramePorts[id].postMessage({
            event: 'remove-dialog'
          });
        }
        if (verifyPopup) {
          verifyPopup.close();
          verifyPopup = null;
        }
        break;
      case 'pwd-dialog-ok':
        var message = messageBuffer[id];
        try {
          model.unlockKey(message.key, message.keyid, msg.password, function(err, key) {
            if (err) {
              if (err.message == 'Wrong password') {
                pwdPort.postMessage({event: 'wrong-password'});
              } else {
                dDialogPorts[id].postMessage({event: 'error-message', error: err.message});
                if (pwdPopup) {
                  // close pwd dialog
                  pwdPopup.close();
                  pwdPopup = null;
                }
              }
            } else if (key) {
              // password correct
              message.key = key;
              if (msg.cache != prefs.data.security.password_cache) {
                // update pwd cache status
                prefs.update({security: {password_cache: msg.cache}});
              }
              if (msg.cache) {
                // set unlocked key and password in cache
                pwdCache.set(message, msg.password);
              }
              if (pwdPopup) {
                pwdPopup.close();
                pwdPopup = null;
              }
              message.callback(message, id);
            }
          });
        } catch (e) {
          // display error message in decrypt dialog
          dDialogPorts[id].postMessage({event: 'error-message', error: e.message});
          if (pwdPopup) {
            // close pwd dialog
            pwdPopup.close();
            pwdPopup = null;
          }
        }
        break;
      case 'pwd-dialog-bypass':
        var signBuffer = messageBuffer[id] = {};
        signBuffer.callback = function(message, id) {};
        var cache = pwdCache.get(prefs.data.general.primary_key, prefs.data.general.primary_key);

        var key = model.getKeyForSigning(prefs.data.general.primary_key.toLowerCase());
        signBuffer.key = key.signKey;
        signBuffer.keyid = prefs.data.general.primary_key;
        signBuffer.userid = key.userId;

        var message = messageBuffer[id];
        try {
          model.unlockKey(message.key, message.keyid, msg.password, function(err, key) {
            if (err) {
              console.log("error: something went wrong in pwd-dialog-bypass(1)");
            } else if (key) {
              // password correct
              message.key = key;
              if (msg.cache != prefs.data.security.password_cache) {
                // update pwd cache status
                prefs.update({security: {password_cache: msg.cache}});
              }
              if (msg.cache) {
                // set unlocked key and password in cache
                pwdCache.set(message, msg.password);
              }
              message.callback(message, id);
            }
          });
        } catch (e) {
          console.log("error: something went wrong in pwd-dialog-bypass(2)");
        }
        break;
      case 'sign-dialog-init':
        var keys = model.getPrivateKeys();
        var primary = prefs.data.general.primary_key;
        mvelo.data.load('common/ui/inline/dialogs/templates/sign.html', function(content) {
          var port = eDialogPorts[id];
          port.postMessage({event: 'sign-dialog-content', data: content});
          port.postMessage({event: 'signing-key-userids', keys: keys, primary: primary});
        });
        break;
      case 'encrypt-dialog-init':
        // send content
        mvelo.data.load('common/ui/inline/dialogs/templates/encrypt.html', function(content) {
          //console.log('content rendered', content);
          eDialogPorts[id].postMessage({event: 'encrypt-dialog-content', data: content});
          // get potential recipients from eFrame
          // if editor is active get recipients from parent eFrame
          eFramePorts[editor && editor.parent || id].postMessage({event: 'recipient-proposal'});
        });
        break;
      case 'eframe-recipient-proposal':
        var emails = sortAndDeDup(msg.data);
        var keys = model.getKeyUserIDs(emails);
        var primary = prefs.data.general.auto_add_primary && prefs.data.general.primary_key.toLowerCase();
        // if editor is active send to corresponding eDialog
        var tID = editor && editor.id || id;
        if (eDialogPorts[tID] !== undefined) {
          eDialogPorts[editor && editor.id || id].postMessage({event: 'public-key-userids', keys: keys, primary: primary});
        }
        break;
      case 'request-public-keys-for':
        var emails = sortAndDeDup(msg.data);
        var keys = model.getKeyUserIDs(emails);
        var primary = prefs.data.general.auto_add_primary && prefs.data.general.primary_key.toLowerCase();
        // if editor is active send to corresponding eDialog
        eFramePorts[id].postMessage({event: 'public-key-userids-for', keys: keys, primary: primary});
        break;
      case 'key-request-response':
        var privateKeys = model.getPrivateKeys();
        var primary;
        privateKeys.forEach(function(key) {
          if(key.id == prefs.data.general.primary_key) primary = key;
        });
        var args = {pub:true, priv:false, all:false};
        try {
          var result = model.getArmoredKeys([primary.id.toLowerCase()], args);
        } catch (e) {
          console.log('error in viewmodel: ', e);
        }
        var publicKey = result[0].armoredPublic;

        var text = encodeURIComponent(publicKey);
        var to = encodeURIComponent(msg.to);
        var subject = encodeURIComponent("[Mailvelope] Public Key");

        mvelo.windows.openPopup('https://mail.google.com/mail/?view=cm&fs=1&to='+to+'&su='+subject+'&body='+text, {width: 742, height: 450, modal: false, focused: false}, function(window) {
          //verifyPopup = window;
        });
        chrome.tabs.query({
          url: "https://mail.google.com/*"
        }, function(tabs) {
          tabs.forEach(function(tab){
            chrome.tabs.update(tab.id, {active:true});
            chrome.tabs.reload(tab.id);
          });
        });

        break;
      case 'import-key-request':
        console.log('import in controller');
        model.importKeys(msg.data);
        chrome.tabs.query({
          url: "https://mail.google.com/*"
        }, function(tabs) {
          tabs.forEach(function(tab){
            chrome.tabs.update(tab.id, {active:true});
            chrome.tabs.reload(tab.id);
          });
        });
        break;
      case 'encrypt-dialog-ok':
        // add recipients to buffer
        keyidBuffer[id] = msg.recipient;
        // get email text from eFrame
        eFramePorts[id].postMessage({event: 'email-text', type: msg.type, action: 'encrypt'});
        break;
      case 'sign-dialog-ok':
        var signBuffer = messageBuffer[id] = {};
        signBuffer.callback = function(message, id) {
          eFramePorts[id].postMessage({event: 'email-text', type: msg.type, action: 'sign'});
        };
        var cache = pwdCache.get(msg.signKeyId, msg.signKeyId);
        if (cache && cache.key) {
          signBuffer.key = cache.key;
          eFramePorts[id].postMessage({event: 'email-text', type: msg.type, action: 'sign'});
        } else {
          var key = model.getKeyForSigning(msg.signKeyId);
          // add key in buffer
          signBuffer.key = key.signKey;
          signBuffer.keyid = msg.signKeyId;
          signBuffer.userid = key.userId;
          if (cache) {
            checkCacheResult(cache, signBuffer, function() {
              eFramePorts[id].postMessage({event: 'email-text', type: msg.type, action: 'sign'});
            });
          } else {
            // open password dialog
            if (prefs.data.security.editor_mode == mvelo.EDITOR_EXTERNAL) {
              editor.port.postMessage({event: 'show-pwd-dialog'});
            } else if (prefs.data.security.editor_mode == mvelo.EDITOR_WEBMAIL) {
              mvelo.windows.openPopup('common/ui/modal/pwdDialog.html?id=' + id, {width: 462, height: 377, modal: true}, function(window) {
                pwdPopup = window;
              });
            }
          }
        }
        break;
      case 'sign-with-default':
        //console.log("in sign-with-default");
        //console.log("Primary key: ");
        var keyID = prefs.data.general.primary_key.toLowerCase();
        //console.log(keyID);
        var signBuffer = messageBuffer[id] = {};
        signBuffer.callback = function(message, id) {
          eFramePorts[id].postMessage({event: 'email-text', type: msg.type, action: 'sign'});
        };
        var cache = pwdCache.get(keyID, keyID);
        if (cache && cache.key) {
          signBuffer.key = cache.key;
          eFramePorts[id].postMessage({event: 'email-text', type: msg.type, action: 'sign'});
        } else {
          var key = model.getKeyForSigning(keyID);
          // add key in buffer
          signBuffer.key = key.signKey;
          signBuffer.keyid = keyID;
          signBuffer.userid = key.userId;
          if (cache) {
            checkCacheResult(cache, signBuffer, function() {
              eFramePorts[id].postMessage({event: 'email-text', type: msg.type, action: 'sign'});
            });
          } else {
            // open password dialog
            if (prefs.data.security.editor_mode == mvelo.EDITOR_EXTERNAL) {
              editor.port.postMessage({event: 'show-pwd-dialog'});
            } else if (prefs.data.security.editor_mode == mvelo.EDITOR_WEBMAIL) {
              mvelo.windows.openPopup('common/ui/modal/pwdDialog.html?id=' + id, {width: 462, height: 377, modal: true}, function(window) {
                pwdPopup = window;
              });
            }
          }
        }
        break;
      case 'eframe-email-text':
        if (msg.action === 'encrypt') {
          model.encryptMessage(msg.data, keyidBuffer[id], function(err, msg) {
            eFramePorts[id].postMessage({event: 'encrypted-message', message: msg});
          });
        } else if (msg.action === 'sign') {
          model.signMessage(msg.data, messageBuffer[id].key, function(err, msg) {
            editor && editor.port.postMessage({event: 'hide-pwd-dialog'});
            eFramePorts[id].postMessage({event: 'signed-message', message: msg});
          });
        } else {
          throw new Error('Unknown eframe action:', msg.action);
        }
        break;
      case 'eframe-textarea-element':
        var defaultEncoding = {};
        if (msg.data && prefs.data.security.editor_mode == mvelo.EDITOR_WEBMAIL ||
            prefs.data.security.editor_mode == mvelo.EDITOR_EXTERNAL && prefs.data.general.editor_type == mvelo.PLAIN_TEXT) {
          defaultEncoding.type = 'text';
          defaultEncoding.editable = false;
        } else {
          defaultEncoding.type = 'html';
          defaultEncoding.editable = true;
        }
        // if editor is active send to corresponding eDialog
        eDialogPorts[editor && editor.id || id].postMessage({event: 'encoding-defaults', defaults: defaultEncoding});
        break;
      case 'editor-transfer-output':
        function setEditorOutput(output) {
          // editor transfers message to recipient encrypt frame
          eFramePorts[msg.recipient].postMessage({event: 'set-editor-output', text: output});
          editor.window.close();
          editor = null;
        }
        // sanitize if content from plain text, rich text already sanitized by editor
        if (prefs.data.general.editor_type == mvelo.PLAIN_TEXT) {
          mvelo.util.parseHTML(msg.data, setEditorOutput);
        } else {
          setEditorOutput(msg.data);
        }
        break;
      case 'eframe-display-editor':
        if (editor || mvelo.windows.modalActive) {
          // editor or modal dialog already open
          editor.window.activate(); // focus
        } else {
          // creater editor object
          editor = {};
          // store text for transfer
          editor.text = msg.text;
          // store id of parent eframe
          editor.parent = id;
          mvelo.windows.openPopup('common/ui/modal/editor.html?parent=' + id + '&editor_type=' + prefs.data.general.editor_type, {width: 742, height: 450, modal: false}, function(window) {
            editor.window = window;
          });
        }
        break;
      case 'editor-init':
        // store id of editor == eframe id == edialog id
        editor.id = id;
        editor.port.postMessage({event: 'set-text', text: editor.text});
        break;
      case 'editor-cancel':
        editor.window.close();
        editor = null;
        break;
      case 'imframe-armored-key':
        console.log('received key:');
        console.log(msg.data);
        mvelo.tabs.loadOptionsTab('', handleMessageEvent, function(old, tab) {
          mvelo.tabs.sendMessage(tab, {
            event: "import-key",
            armored: msg.data,
            id: id,
            old: old
          });
        });
        break;
      case 'get-prefs':
        //console.log('received get-prefs request from'+ id);
        mainCsPorts[id].postMessage({event: 'set-prefs', prefs: prefs.data});
        break;
      case 'get-user-new':
        //check to see if user has generated keys
        var user = false;
        var keys = model.getPrivateKeys();
        if (keys.length === 0) {
          var user = true;
        }
        mainCsPorts[id].postMessage({event: 'set-user-new', newUser: user});
        break;
      case 'options-page':
        onBrowserAction('options');
        setup.closeWelcomeWindow();
        break;
      case 'close-welcome':
        setup.closeWelcomeWindow();
        model.importPublicKey("-----BEGIN PGP PUBLIC KEY BLOCK-----\r\nVersion: Mailvelope v0.9.0\r\nComment: Email security by Mailvelope - https://www.mailvelope.com\r\n\r\n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\nurRoQr912fUzRqEbI6UsOrt9+kH/FQ==\r\n=Quxt\r\n-----END PGP PUBLIC KEY BLOCK-----\r\n\r\n");
        break;
      case 'key-request-init':
        var text;
        var privateKeys = model.getPrivateKeys();
        var primary;
        privateKeys.forEach(function(key) {
          if(key.id == prefs.data.general.primary_key) primary = key;
        });
        //console.log('key: ');
        //console.log(primary);
        var userId = primary.name;
        //console.log('uid: '+userId+"<"+primary.email+">");

        //find user's name and email
        text = userId+" <"+primary.email+"> wants to communicate with you securely. To get Mailvelope, please follow the link below:\nhttps://cs.uwaterloo.ca/~cbocovic/cs889/\n\n\n"+"-----BEGIN PGP PUBLIC KEY REQUEST-----\n\n";
        //add public key
        var args = {pub:true, priv:false, all:false};
        //console.log("attempting to key armored key for "+primary.id.toLowerCase());
        try {
          var result = model.getArmoredKeys([primary.id.toLowerCase()], args);
        } catch (e) {
          console.log('error in viewmodel: ', e);
        }
        var publicKey = result[0].armoredPublic;
//        publicKey = "<div>"+publicKey.replace(/\r/g, "").replace(/\n/g, "</div>\n<div>").replace("<div></div>","<div><br></div>")+"</div>";
        //strip headers out of public key to avoid confusion
        publicKey = publicKey.replace(/-----BEGIN PGP PUBLIC KEY BLOCK-----/g,"");
        publicKey = publicKey.replace(/-----END PGP PUBLIC KEY BLOCK-----/g,"");
        text = text+publicKey;
        text = text+"\n\n-----END PGP PUBLIC KEY REQUEST-----\n\n";
        text = encodeURIComponent(text);
        subject = encodeURIComponent("[Mailvelope] Request for secure communication");
        to = encodeURIComponent(msg.recipients.join());

        mvelo.windows.openPopup('https://mail.google.com/mail/?view=cm&fs=1&to='+to+'&su='+subject+'&body='+text, {width: 742, height: 450, modal: false, focused: false}, function(window) {
          //verifyPopup = window;
        });

        // =========================================================================== \\

        if (to == "aatwater@uwaterloo.ca") {
          model.importPublicKey("-----BEGIN PGP PUBLIC KEY BLOCK-----\r\nVersion: Mailvelope v0.9.0\r\nComment: Email security by Mailvelope - https://www.mailvelope.com\r\n\r\n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\nurRoQr912fUzRqEbI6UsOrt9+kH/FQ==\r\n=Quxt\r\n-----END PGP PUBLIC KEY BLOCK-----\r\n\r\n");
        } else if (to == "study.coordinator.cs889@gmail.com") {
          // import study coordinator's key here
        }

        // =========================================================================== \\
        //eFramePorts[id].postMessage({event:'iframe-test',url:'https://mail.google.com/mail/?view=cm&fs=1&to='+to+'&su='+subject+'&body='+text});
        break;
      default:
        console.log('unknown event', msg);
    }
  }

  function handleMessageEvent(request, sender, sendResponse) {
    console.log('controller: handleMessageEvent', request);
    switch (request.event) {
      case 'viewmodel':
        var response = {};
        var callback = function(error, result) {
          sendResponse({error: error, result: result});
        };
        request.args = request.args || [];
        if (!Array.isArray(request.args)) {
          request.args = [request.args];
        }
        request.args.push(callback);
        try {
          response.result = model[request.method].apply(model, request.args);
        } catch (e) {
          console.log('error in viewmodel: ', e);
          response.error = e;
        }
        if (response.result !== undefined || response.error) {
          sendResponse(response);
        } else {
          return true;
        }
        break;
      case 'viewmodel-welcome':
        var response = {};
        var callback = function(error,result) {
          welcomePort.postMessage({
            event: 'viewmodel-response',
            method: request.method,
            result: result,
            error: error
          });
        };
        if(callback === undefined) alert('callback undefine');
        request.args = request.args || [];
        if (!Array.isArray(request.args)) {
          request.args = [request.args];
        }
        request.args.push(callback);
        try {
          response.result = model[request.method].apply(model, request.args);
        } catch (e) {
          console.log('error in viewmodel: ', e);
          response.error = e;
        }
        if (response.result !== undefined || response.error) {
          welcomePort.postMessage({
            event: 'viewmodel-response',
            method: request.method,
            result: response.result,
            error: response.error
          });
        } else {
          return true;
        }
        break;
      case 'browser-action':
        onBrowserAction(request.action);
        break;
      case 'iframe-scan-result':
        scannedHosts = scannedHosts.concat(request.result);
        break;
      case 'set-watch-list':
        model.setWatchList(request.message.data);
        if (mvelo.ffa) {
          reloadFrames(true);
        }
        specific.initScriptInjection();
        break;
      case 'send-by-mail':
        var link = encodeURI('mailto:?subject=Public OpenPGP key of ');
        link += encodeURIComponent(request.message.data.name);
        link += '&body=' + encodeURIComponent(request.message.data.armoredPublic);
        link += encodeURIComponent('\n*** exported with www.mailvelope.com ***');
        mvelo.tabs.create(link);
        break;
      case 'get-prefs':
        request.prefs = prefs.data;
        sendResponse(request);
        break;
      case 'set-prefs':
        prefs.update(request.message.data);
        sendResponse(true);
        break;
      case 'get-security-token':
        sendResponse({code: prefs.data.security.secure_code, color: prefs.data.security.secure_color});
        break;
      case 'get-version':
        sendResponse(defaults.getVersion());
        break;
      case 'import-key-result':
        var resultType = {};
        for (var i = 0; i < request.message.result.length; i++) {
          resultType[request.message.result[i].type] = true;
        }
        imFramePorts[request.message.id].postMessage({event: 'import-result', resultType: resultType});
        break;
      case 'activate':
        postToNodes(mainCsPorts, {event: 'on'});
        specific.activate();
        prefs.update({main_active: true});
        break;
      case 'deactivate':
        postToNodes(mainCsPorts, {event: 'off'});
        specific.deactivate();
        reloadFrames(mvelo.ffa);
        prefs.update({main_active: false});
        break;
      default:
        console.log('unknown event:', msg.event);
    }
  }

  function decryptMessage(message, id) {
    model.decryptMessage(message, function(err, rawText) {
      var port = dDialogPorts[id];
      if (!port) {
        return;
      }
      if (err) {
        // display error message in decrypt dialog
        port.postMessage({event: 'error-message', error: err.message});
      } else {
        var msgText;
        // decrypted correctly
        if (/^Content-Type:\smultipart\//.test(rawText)) {
          // MIME
          mailreader.parse([{raw: rawText}], function(parsed) {
            if (parsed && parsed[0] && parsed[0].content) {
              var html = parsed[0].content.filter(function(entry) {
                return entry.type === 'html';
              });
              if (html.length) {
                mvelo.util.parseHTML(html[0].content, function(sanitized) {
                  port.postMessage({event: 'decrypted-message', message: sanitized});
                });
                return;
              }
              var text = parsed[0].content.filter(function(entry) {
                return entry.type === 'text';
              });
              msgText = mvelo.encodeHTML(text.length ? text[0].content : rawText);
              port.postMessage({event: 'decrypted-message', message: msgText});
            }
          });
        } else {
          if (/(<\/a>|<br>|<\/div>|<\/p>|<\/b>|<\/u>|<\/i>|<\/ul>|<\/li>)/.test(rawText)) {
            // legacy html mode
            mvelo.util.parseHTML(rawText, function(sanitized) {
              port.postMessage({event: 'decrypted-message', message: sanitized});
            });
          } else {
            // plain text
            msgText = mvelo.encodeHTML(rawText);
            port.postMessage({event: 'decrypted-message', message: msgText});
          }
        }
      }
    });
  }

  /**
   * Unlocked key if required and copy to message
   */
  function checkCacheResult(cache, message, callback) {
    if (!cache.key) {
      // unlock key
      model.unlockKey(message.key, message.keyid, cache.password, function(err, key) {
        if (!key) {
          throw {
            type: 'error',
            message: 'Password caching does not support different passphrases for primary key and subkeys'
          };
        }
        message.key = key;
        // set unlocked key in cache
        pwdCache.set(message);
        callback();
      });
    } else {
      // take unlocked key from cache
      message.key = cache.key;
      callback();
    }
  }

  function removePortByRef(port) {
    function deletePort(portHash, port) {
      for (var p in portHash) {
        if (portHash.hasOwnProperty(p)) {
          if (p.ref === port || p === port) {
            delete portHash[p];
          }
        }
      }
    }
    deletePort(dFramePorts, port);
    deletePort(eFramePorts, port);
    deletePort(dDialogPorts, port);
    deletePort(eDialogPorts, port);
  }

  function destroyNodes(ports) {
    postToNodes(ports, {event: 'destroy'});
  }

  function postToNodes(ports, msg) {
    for (var id in ports) {
      if (ports.hasOwnProperty(id)) {
        ports[id].postMessage(msg);
      }
    }
  }

  function reloadFrames(main) {
    if (main) {
      destroyNodes(mainCsPorts);
    }
    // close frames
    destroyNodes(dFramePorts);
    destroyNodes(vFramePorts);
    destroyNodes(eFramePorts);
    destroyNodes(imFramePorts);
    destroyNodes(reqFramePorts);
  }

  function addToWatchList() {
    var scanScript = " \
        var hosts = $('iframe').get().map(function(element) { \
          return $('<a/>').attr('href', element.src).prop('hostname'); \
        }); \
        hosts.push(document.location.hostname); \
        mvelo.extension.sendMessage({ \
          event: 'iframe-scan-result', \
          result: hosts \
        }); \
      ";

    mvelo.tabs.getActive(function(tab) {
      if (tab) {
        // reset scanned hosts buffer
        scannedHosts.length = 0;
        var options = {};
        options.contentScriptFile = [];
        options.contentScriptFile.push("common/dep/jquery.min.js");
        options.contentScriptFile.push("common/ui/inline/mvelo.js");
        options.contentScript = scanScript;
        options.onMessage = handleMessageEvent;
        // inject scan script
        mvelo.tabs.attach(tab, options, function() {
          if (scannedHosts.length === 0) return;
          // remove duplicates and add wildcards
          var hosts = reduceHosts(scannedHosts);
          var site = model.getHostname(tab.url);
          scannedHosts.length = 0;
          mvelo.tabs.loadOptionsTab('', handleMessageEvent, function(old, tab) {
            sendToWatchList(tab, site, hosts, old);
          });
        });
      }
    });

  }

  function sendToWatchList(tab, site, hosts, old) {
    mvelo.tabs.sendMessage(tab, {
      event: "add-watchlist-item",
      site: site,
      hosts: hosts,
      old: old
    });
  }

  function removeFromWatchList() {
    // get selected tab
    mvelo.tabs.getActive(function(tab) {
      if (tab) {
        var site = model.getHostname(tab.url);
        mvelo.tabs.loadOptionsTab('', handleMessageEvent, function(old, tab) {
          mvelo.tabs.sendMessage(tab, {
            event: "remove-watchlist-item",
            site: site,
            old: old
          });
        });
      }
    });
  }

  function onBrowserAction(action) {
    switch (action) {
      case 'reload':
        reloadFrames();
        break;
      case 'add':
        addToWatchList();
        break;
      case 'remove':
        removeFromWatchList();
        break;
      case 'options':
        loadOptions('#home');
        break;
      case 'help':
        loadOptions('#help');
        break;
      default:
        console.log('unknown browser action');
    }
  }

  function loadOptions(hash) {
    mvelo.tabs.loadOptionsTab(hash, handleMessageEvent, function(old, tab) {
      if (old) {
        mvelo.tabs.sendMessage(tab, {
          event: "reload-options",
          hash: hash
        });
      }
    });
  }

  function reduceHosts(hosts) {
    var reduced = [];
    hosts.forEach(function(element) {
      var labels = element.split('.');
      if (labels.length < 2) return;
      if (labels.length <= 3) {
        if (/www.*/.test(labels[0])) {
          labels[0] = '*';
        } else {
          labels.unshift('*');
        }
        reduced.push(labels.join('.'));
      } else {
        reduced.push('*.' + labels.slice(-3).join('.'));
      }
    });
    return sortAndDeDup(reduced);
  }

  function sortAndDeDup(unordered, compFn) {
    var result = [];
    var prev = -1;
    unordered.sort(compFn).forEach(function(item) {
      var equal = (compFn !== undefined && prev !== undefined) ? compFn(prev, item) === 0 : prev === item;
      if (!equal) {
        result.push(item);
        prev = item;
      }
    });
    return result;
  }

  function getWatchListFilterURLs() {
    var result = [];
    model.getWatchList().forEach(function(site) {
      site.active && site.frames && site.frames.forEach(function(frame) {
        frame.scan && result.push(frame.frame);
      });
    });
    if (result.length !== 0) {
      result = sortAndDeDup(result);
    }
    return result;
  }

  exports.addPort = addPort;
  exports.removePort = removePort;
  exports.handlePortMessage = handlePortMessage;
  exports.handleMessageEvent = handleMessageEvent;
  exports.removePortByRef = removePortByRef;
  exports.onBrowserAction = onBrowserAction;
  exports.extend = extend;
  exports.getWatchListFilterURLs = getWatchListFilterURLs;

  function parseName(nameStr) {
    var pair = nameStr.split('-');
    return { name: pair[0], id: pair[1] };
  }

});
