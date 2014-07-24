/**
 * Mailvelope - secure email with OpenPGP encryption for Webmail
 * Copyright (C) 2013  Thomas Oberndörfer
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

var RequestFrame = RequestFrame || (function() {

  var requestFrame = function(prefs) {
    ExtractFrame.call(this, prefs);
    this._ctrlName = 'reqFrame-' + this.id;
    this._typeRegex = /-----BEGIN PGP PUBLIC KEY REQUEST-----[\s\S]+?-----END PGP PUBLIC KEY REQUEST-----/;
  };

  requestFrame.prototype = Object.create(ExtractFrame.prototype);
  requestFrame.prototype.parent = ExtractFrame.prototype;

  requestFrame.prototype._renderFrame = function() {
    this.parent._renderFrame.call(this);
    var text = $('<div/>', {
      'class': 'centered',
      html: '<h3>Mailvelope Request</h3><br> This contact wants to communicate with you securely. Click to accept this request.'
    });
    text.width(this._eFrame.width()*0.5);
    text.height(this._eFrame.height()*0.5);
    text.css('marginLeft', -text.width()/2);
    text.css('marginTop', -text.height()/2);
    this._eFrame.append(text);
    //this._eFrame.addClass('m-request');
  };

  requestFrame.prototype._clickHandler = function() {
    var that = this;
    var msg = that._getArmoredMessage();
    
    //find out who sent it
    var email = msg.match(/<[\s\S]+?>/)[0];
    email = email.replace(/[<|>]/g, "");

    //import key
    var pKey = msg.match(/Version[\s\S]+?-----END PGP PUBLIC KEY REQUEST-----/)[0];
    pKey = "-----BEGIN PGP PUBLIC KEY BLOCK-----\n"+pKey.replace("REQUEST", "BLOCK");

    var keys = [];

    keys.push({type: 'public', armored: pKey});
    that._port.postMessage({event: 'import-key-request', sender: 'reqFrame'+that.id, data:keys});
    that._port.postMessage({event: 'key-request-response', sender: 'reqFrame'+that.id, to:email});

    alert("Congratulations! You can now send encrypted messages to "+email+".\n\nYour key has been sent back to them, so they will be able to respond as well.");
    
    //importKey.importKey(pKey,function(){});
    //that._port.postMessage({
    //  event: 'imframe-armored-key',
    //  data: pKey,
    //  sender: that._ctrlName
    //});
    //reply to request
    //document.location.href = '#compose';
    //setTimeout(function(){
    //  if ($('textarea[name="to"]:last').val() !== "") {
    //    console.log("non-empty compose window. aborting.");
    //    return;
    //  }
    //  $('textarea[name="to"]:last').val(email);
    //  $('input[name="subjectbox"]:last').val('[Ezee] Public Key');
    //  that._port.postMessage({
    //    event: 'public-key-text',
    //    sender: 'reqFrame-'+that.id,
    //  });
    //}, 1000);

    return false;
  };

  requestFrame.prototype._registerEventListener = function() {
    this.parent._registerEventListener.call(this);
    var that = this;
    this._port.onMessage.addListener(function(msg) {
      //console.log('received message'+ msg.event);
      switch (msg.event) {
        case 'public-key-result':
          $('div.editable[role="textbox"]:last').html(msg.text);
          break;
      }
    });
  };

  return requestFrame;

}());

