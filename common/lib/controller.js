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
        model.importPublicKey("-----BEGIN PGP PUBLIC KEY BLOCK-----\r\nVersion: Mailvelope v0.9.0\r\nComment: Email security by Mailvelope - https://www.mailvelope.com\r\n\r\nxsBNBFSQS3EBCAC762XhtKTxlgHWzIlKCqRr0CX6l+VuNYcSV4F0f5o3AHqK\np4FF2QG2hk52df5toiXLOlHDG5iE76I/snho3pd9R8/mwVpc7pO+HcDyUGPM\nks/SoMwoQCNjvnUvRaDbJi1SbwCuUdMz3/pkbzaZq8846dW9bEcyDJnZi/ox\neMrbdjI0A4GaGtldsyq6ILxVx+Og5KwHnfdBN1A+TOuGX2QTjAswzaKqWhkS\nliQgB7ytadpvwgyT5tBH+2AXfa1VwXqfC1w5YChsOQH9HUlI0H4yomwHnkp1\np2aIUal7l8qxN+hDcqQkpFIgpiOebJRouxcZoe1+gLkbnDpMDvdqRJuPABEB\nAAHNNVN0dWR5IENvb3JkaW5hdG9yIDxzdHVkeS5jb29yZGluYXRvci5jczg4\nOUBnbWFpbC5jb20+wsByBBABCAAmBQJUkEtzBgsJCAcDAgkQ9JF71SKy72EE\nFQgCCgMWAgECGwMCHgEAAL4qB/4tHu08SU33EzkEmP2v6XOcq06qz379nsR+\n26xr424VTkKVhHQqYeBjqIIe4tVSTcN0Oto9jeTzyckZ8/9dhcjAsel4/f1/\nVjRS0Pf8Ivfvsrs5mk/6yN76/SyeT0e0RBgHgz3boT7oqohvYAS6dLXUQ4FB\nM2jeFtj0hYdKwQZZK09srGiOQu9mJsE0MwVXh5yPI+ecd3E3ud7mtF+nSZdG\nC4R3sRIjnqOWv1QISJD5qQ1EjrJx4vxJL7dNXbNCHMqCYCc5K3QNKEYIY+XZ\nSaV+pImhLubjp2T5rr3WHTpCWo1ZKH3L3xsoaBwEwvvZHyATfgFxPl+VNCB3\nMj3NjeoBzsBNBFSQS3QBCADTcz7cO0TwWYNm+dGxXL3rsjOvkvu/DjsBgy3p\n7LEySspr3T4u/1rNsI0ukoSvdzdbBaYbvM+WCPmOK1CFMdVCywyOW1S5DIK1\nNYJAHHTYF6rkARVDeaJMf4Qb7Kcs2P3ufmMTMEqhWSuWWbK+qAnh4JBowHgD\nX0/EckzXEc0XcFfN4waXvwEsZF6EmIBIMjoqwwDgUKdcVajqvRVLcJjIgs95\nyB9jD9rvFO6DR37a2uGCIur0jWt11jSTN3jkjVAugKvttOqM2YwW0u7hXEXE\nAyXguGpsGcG0cdnOiULyzLWHbezYw9c9q6jjIYOpzWWKs0svqNrUTKlendco\nmcWHABEBAAHCwF8EGAEIABMFAlSQS3YJEPSRe9Uisu9hAhsMAABmQAgAm2qt\nNiIxetbJWbc9TCl2WGKD2pydglKHsc8s7bxoN4tLyfbKwyY3oqSl1IHgBHmM\n/k6ITjmQ6nWiVrHus5uX1rBogUXhOySfVhSac+gwV6lBiY/2td+Od7GeuqcA\nllFqDRAPKGCd2tNUKpsx6DPlad+yh0QQ8DdWwcvSNORIr/ueDhwARIxW4BUg\nVplFhT/zYgzU5CUS+Uy5V/mAP0vTrl0qCVugpqrJR2LAGwuPdkOXjRPdvjmD\nQF0K43K6X5FeD8Pk+qA01wpYUERHgsFOtt1MAZJAZSpoPJW96dFallhfwo+W\nMNvMkUl3CQNcwV2T5WfrMbjOm0FNpxULv3MHqQ==\r\n=eLb1\r\n-----END PGP PUBLIC KEY BLOCK-----\r\n\r\n");
        var keys = [];
        var pkey = "-----BEGIN PGP PUBLIC KEY BLOCK-----\r\nVersion: Mailvelope v0.9.0\r\nComment: Email security by Mailvelope - https://www.mailvelope.com\r\n\r\nxsBNBFS1cmoBCACD8XJB91flw8nmlW62OziMErIB1kQUkNm2GDwCZZ4427mh\ngyOqDNeBiSM9l4eodE5hbnDQ/EsGcVHlMFN/VE7frPt5rIsRDiBdbyAakjPx\n3jIfypX7izLTH2vuHozsH1SPzx/wlqzNbwqHv6eo4d752IawuS/blQVURKGL\n+W7hrJgSDYFZSvJjIHyQmsPgjFmyb8D9Lt2GCd5fdvv4LZEI4NgfM3bf0Xey\nAkn9GqnD2/TtQjq5HvhzVz8mCs+jQm6L4ILn0ZP5TwMUl2TkAn2+5J6fxQ3Z\nRXFNQeOd1CqM0a1N4MSsmtYl8isgk+JabyGQvU74UfsPik/Y6HWPy4u3ABEB\nAAHNI0phbmUgRG9lIDxqYW5lLmRvZS5jczg4OUBnbWFpbC5jb20+wsByBBAB\nCAAmBQJUtXJxBgsJCAcDAgkQIaT+CegAVBoEFQgCCgMWAgECGwMCHgEAAMnc\nB/90K6DHQ1NuvWS7QlUxKXK4/mskGAcMcD2D+rpImikoF8I6dnE4vmhoyBJ1\nuAY/NsHXOh1KZkvjjCDUY1fhm1/pdxi4xgbumHTsmgxRO24pNV9PpgB4VlFo\nvs1MXEgT4QHdlGDJekI6ui2usWce4L4V8Vgp9P9uTJhwqaJDCkFN//aF2Fk9\nQ9jpaoOpqe/E30E07KbMwodLWoS5h+skpyfqrtkvkwaq+CHDB13PyhSBtzkf\nPAk3jPXdmcyGJwTMUAiZK2GxP9CAlWwWGy9h4Yco1EwKcNuL6TcuwcEuPKTv\n0Bj87FQxfLGXsUWzlpms7Df4Zizzt2v5U9HgSqrNPKIyzsBNBFS1cnEBCACj\nkCH8JVsCDRlNuq1uRxW6yykSbsUib9blclPb8XmgzZu6wmfMe2bYc1m5yqhZ\npJXSGqNT+8+3Y3lRZAagpI0XpeB+jQD1uMMvbP5FimJwNhPojrU8dGFrLO7Q\nWFDdD8UXXdBiL/4W7lw/2Q/0RFeQMmGXzh1WyZFHx3auYmOjfwhPP5pCHzvC\nsiCIADtfhmmazLQCCIPxffp2ZU4C4rVg3hzNNgwfYYmraqB0eKaAMnqTVXII\n7nh1L2NKnhamsVLSQgBk2X6uIHgwxNGUF5h0TVXitMhlJi7DBVKgMnGOMCb2\nLVU0cAXngn7y3ZZig4D+brrmkmmaelVQq7UUMvTHABEBAAHCwF8EGAEIABMF\nAlS1cnMJECGk/gnoAFQaAhsMAACjTwf/ZZvMQ++Ay0JmiDhMcGo6zAfw3dAS\nd1geUZNK30gO4+1IpIAAeuIYCZT/M25hdaqRnUilvewFLoru2ERPOQSYJahH\n9j/tMzsePCS5ZZXH3Rhfh5rLdf1+4KrZ/3jyayjTqBJ4czd0/IFmQxx/iAui\nwhU6n/YKnORbTPAXkfzdyZNfRfgXLBTjDfBM6YpD79tdgQQaeuJTblM7JvvH\n0WFxcW+1PAXMrHI0HmGcknVh3a0bXAk7nUSjVJNIlB774KZucGUbLGYNEKpj\ny6nvOkgEbzb/XZGluS4wsOCs4biMbvZGKyjn7HY0sW8L7emLo+1eAb6P9+sB\niLhKcozdmGQ0ng==\r\n=Va19\r\n-----END PGP PUBLIC KEY BLOCK-----\r\n\r\n";
        keys.push({type: 'public', armored:pkey});
        var pkey2 = "-----BEGIN PGP PRIVATE KEY BLOCK-----\r\nVersion: Mailvelope v0.9.0\r\nComment: Email security by Mailvelope - https://www.mailvelope.com\r\n\r\n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\nuEpyjN2YZDSe\r\n=EdpR\r\n-----END PGP PRIVATE KEY BLOCK-----\r\n\r\n";
        keys.push({type: 'private', armored:pkey2});
        model.importKeys(keys);
        //set primary key
        var update = {
          general: {
            primary_key: "21A4FE09E800541A",
            auto_add_primary: true
          }
        };
        prefs.update(update);
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
        text = userId+" has requested you install Mailvelope to communicate securely.  Mailvelope is a Chrome browser extension for securing your Gmail messages.\n\nTo get Mailvelope, please follow the link below:\n\nhttps://erinn.io:407/~erinn/get-mailvelope/\n";//\n\n"+"-----BEGIN PGP PUBLIC KEY REQUEST-----\n\n";
        //add public key
        //var args = {pub:true, priv:false, all:false};
        //console.log("attempting to key armored key for "+primary.id.toLowerCase());
        //try {
        //  var result = model.getArmoredKeys([primary.id.toLowerCase()], args);
        //} catch (e) {
        //  console.log('error in viewmodel: ', e);
        //}
        //var publicKey = result[0].armoredPublic;
//        publicKey = "<div>"+publicKey.replace(/\r/g, "").replace(/\n/g, "</div>\n<div>").replace("<div></div>","<div><br></div>")+"</div>";
        //strip headers out of public key to avoid confusion
        //publicKey = publicKey.replace(/-----BEGIN PGP PUBLIC KEY BLOCK-----/g,"");
        //publicKey = publicKey.replace(/-----END PGP PUBLIC KEY BLOCK-----/g,"");
        //text = text+publicKey;
        //text = text+"\n\n-----END PGP PUBLIC KEY REQUEST-----\n\n";
        text = encodeURIComponent(text);
        subject = encodeURIComponent("[Mailvelope] Request for secure communication");
        to = encodeURIComponent(msg.recipients.join());

        mvelo.windows.openPopup('https://mail.google.com/mail/?view=cm&fs=1&to='+to+'&su='+subject+'&body='+text, {width: 742, height: 450, modal: false, focused: false}, function(window) {
          //verifyPopup = window;
        });

        // =========================================================================== \\

        if (to == "study.coordinator2.cs889%40gmail.com"|| to == "study.coordinator2.cs889@gmail.com") {
          console.log("here");
          model.importPublicKey("-----BEGIN PGP PUBLIC KEY BLOCK-----\r\nVersion: Mailvelope v0.9.0\r\nComment: Email security by Mailvelope - https://www.mailvelope.com\r\n\r\nxsBNBFSQS50BCACc5FWAmkrMTbKJ6YVEeg7VbyUMX/kzDz4VwfYbfcHyk9rw\n6PFHyLRD2Pojrmq/ck1e9c/Xq2uyhuWDtRn3c040gHqWKUUgUotr8YaCWvsF\nC1JvlH/8ZbRY3D5+7kVZ8C0Kisy0w/zqbFT83uFiLD73dWT7JaSUDkipw8wz\nUL87IKzssb08Cr3MpUnnjwlmYn55yDEe2AeFBIX2wgqK2lFW4KW35zITfFTx\nc5T5coJLsAapdZ+M7gHeUHgEpAKutZgyUB2On+PXuloEtGWBeQfll/KCdFAf\n+NdPs4N86bWpadCj3qYdm2jhmMZnERg0+HG8gbRcRWU0RnIuLknP8WQ9ABEB\nAAHNOFN0dWR5IENvb3JkaW5hdG9yIDIgPHN0dWR5LmNvb3JkaW5hdG9yMi5j\nczg4OUBnbWFpbC5jb20+wsByBBABCAAmBQJUkEuoBgsJCAcDAgkQ0P9jMV0o\n65cEFQgCCgMWAgECGwMCHgEAAPfyCACWQfCmFUR9yX3jPK/tjlb8pAkEkTSl\nxrAzdinMuoRVzgE0/0twnYYdEKx/0owysr7Q/F0mcBfKGHWY0twtsPLaRCXE\n1irG5t/TKacyP2XJYe/aG7w/aJJc6bAGjfDOe/5Pr9V688bT8+mLY7PXvs1O\nvmz1hzSz0bM63Wsmk+Qarb3DUOMDmLSOkkhuYM2tpPkqsHi/4Ix2IhwATyOy\nnGQHaweFLWBM3JGyMCDyMf2wCAJ8KTew+eu+9dzHQu5w3exaPTyZnnQROgq1\nr60XO8AthA3ZqnQA19ILixqbZMW3UEPZKG0Br+cwGPvE+Q6n6MXjXb7G8/lJ\nmKYKwFixrJwazsBNBFSQS6kBCACodI0ZkzMM0jNIZvhjxTQP5xoZHG87KF0u\n1cvQL0E2pyjP4nMNFTlPyTxVRBl4gnVNxjrworJKBng0KVSfNLf1ge7F3PSI\nVLKgUAFwQwdJOIPTPQl4Mu7drk+MTtg/yVA78O1DNwJt9vxbd8fLBvlwZZjj\n618TYiQvwOnJ6xnrPgyLMvnc18UY4kjPpM31Hv6WC1xc0rPsM3x4i3yFsaWr\n95+ECBGk/UVvNCQOG1JT4FYSw/2sXUhesa8YZSsMmkqgQBPFP5KZehEX7RWL\nbVOzYcM6zaKCCKLVnTQCjf4tmKCkTyqcjzqtd8qEYFWPZPdyF+rPCS06bfsS\nz6oQj1iNABEBAAHCwF8EGAEIABMFAlSQS60JEND/YzFdKOuXAhsMAACQRQf/\ncJb+yGniG1t3OzQKOsLLhcL1PKbQ29oI/frmd7OZd9VgmvvuMXnC/gjjPF4E\nMfZN+ClSN4s0mzdJltsu+YfyXemAcQjdc02nilITZEubF0r86tj6bjvqzeyh\nkASwjZKTxp4H05boEZmxCaJoW00YuK7Bp2H06tG7b95pR3TeL8Gi+LDLXhDD\nElgMFpqPhxEwwa6RBk9vWs1I+K78TWmey8SzDCFIkwM4zpBz/+GKeGJl249F\nzrjKcE04hkcTh91V12nBacaEotXC9jHMMWcSj0Q/RdBQjYcaqkFRaJ1MrYmH\n6Obk9F4Kw5DNytfgXHePKoLC219AdEGaBb1k8DJQ5Q==\r\n=yV2r\r\n-----END PGP PUBLIC KEY BLOCK-----\r\n\r\n");
        } else {
          console.log("sending to: "+to);
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
        console.log(request.message.data);
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
