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

var EncryptFrame = EncryptFrame || (function() {

  var encryptFrame = function(prefs) {
    this.id = mvelo.getHash();
    this._editElement = null;
    this._eFrame = null;
    this._eDialog = null;
    this._port = null;
    this._isToolbar = false;
    this._refreshPosIntervalID = 0;
    this._emailTextElement = null;
    this._emailUndoText = null;
    this._editorMode = prefs.security.editor_mode;
    this._myKey = prefs.general.primary_key;
    // type of external editor
    this._editorType = prefs.general.editor_type;
    this._options = {expanded: false, closeBtn: true};
    this._keyCounter = 0;
    this._sendBtn = null;
  };

  encryptFrame.prototype = {

    attachTo: function(element, options) {
      $.extend(this._options, options);
      this._init(element);
      this._establishConnection();
      this._renderFrame(this._options.expanded);
      this._registerEventListener();
      // set status to attached
      this._editElement.data(mvelo.FRAME_STATUS, mvelo.FRAME_ATTACHED);
      // store frame obj in element tag
      this._editElement.data(mvelo.FRAME_OBJ, this);
    },

    getID: function() {
      return this.id;
    },

    _init: function(element) {
      this._editElement = element;
      this._emailTextElement = this._options.editor || (this._editElement.is('iframe') ? this._editElement.contents().find('body') : this._editElement);
      // inject style if we have a non-body editable element inside a dynamic iframe
      if (!this._editElement.is('body') && this._editElement.closest('body').data(mvelo.DYN_IFRAME)) {
        var html = this._editElement.closest('html');
        if (!html.data('M-STYLE')) {
          var style = $('<link/>', {
            rel: 'stylesheet',
            href: mvelo.extension.getURL('common/ui/inline/framestyles.css')
          });
          // add style
          html.find('head').append(style);
          // set marker
          html.data('M-STYLE', true);
        }
      }
    },

    _renderFrame: function(expanded) {
      console.log("in _renderFrame()");
      var that = this;
      // create frame
      var toolbar = '';
      if (this._options.closeBtn) {
        //toolbar = toolbar + '<a class="m-frame-close">×</a>';
      } else {
        toolbar = toolbar + '<span class="m-frame-fill-right"></span>';
      }
      /* jshint multistr: true */
      toolbar = toolbar + '\
		<label class="showText"><input type="checkbox" id="signCheckbox"> Sign this email</label><br> \
		<label class="showText"><input type="checkbox" id="encryptCheckbox"> Encrypt this email</label> \
                ';
// Original mailvelope toolbar buttons; leaving here temporarily for reference
//                <button id="signBtn" class="m-btn m-encrypt-button" type="button"><i class="m-icon m-icon-sign"></i></button> \
//                <button id="encryptBtn" class="m-btn m-encrypt-button" type="button"><i class="m-icon m-icon-encrypt"></i></button> \
//                <button id="undoBtn" class="m-btn m-encrypt-button" type="button"><i class="m-icon m-icon-undo"></i></button> \
//                <button id="editorBtn" class="m-btn m-encrypt-button" type="button"><i class="m-icon m-icon-editor"></i></button> \

      this._eFrame = $('<div/>', {
        id: 'eFrame-' + that.id,
        'class': 'm-encrypt-frame',
        html: toolbar
      });

      // TODO: put this in init
      this._port.postMessage({event: 'pwd-dialog-bypass', sender: 'eFrame-' + this.id, password: "woo", cache: true});

      //this._eFrame.insertAfter(this._editElement);
      this._sendBtn = $(":contains('Send'):last");
      this._eFrame.insertAfter(this._sendBtn);
      this._sendBtn.html("Send Unencrypted");

      $(window).on('resize', this._setFrameDim.bind(this));
      // to react on position changes of edit element, e.g. click on CC or BCC in GMail
      this._refreshPosIntervalID = window.setInterval(this._setFrameDim.bind(this), 1000);
      //this._eFrame.find('.m-frame-close').on('click', this._closeFrame.bind(this));
      //this._eFrame.find('#signBtn').on('click', this._onSignButton.bind(this));
      //this._eFrame.find('#encryptBtn').on('click', this._onEncryptButton.bind(this));
      //this._eFrame.find('#undoBtn').on('click', this._onUndoButton.bind(this));
      //this._eFrame.find('#editorBtn').on('click', this._onEditorButton.bind(this));

      var onAnyUnchecked = this._onUndoButton.bind(this);

      this._eFrame.find('#signCheckbox').on(
        'change',
        {onUnchecked:onAnyUnchecked},
        function(event) {
          if ($(this).is(':checked')) {
            that._port.postMessage({
              event: 'sign-with-default',
              sender: 'eFrame-' + that.id,
              type: 'text'
            });
          } else {
            event.data.onUnchecked();
          }
        }
      );

      this._eFrame.find('#encryptCheckbox').on(
        'change',
        {onUnchecked:onAnyUnchecked},
        function(event) {
          if ($(this).is(':checked')) {
            that._port.postMessage({
              event: 'request-public-keys-for',
              sender: 'eFrame-' + that.id,
              type: 'data',
              data: that._getEmailRecipient()
            });
          } else {
            event.data.onUnchecked();
            that._sendBtn.html("Send Unencrypted");
          }
        }
      );

      if (!expanded) {
        this._isToolbar = true;
        this._normalizeButtons();
        this._eFrame.fadeIn('slow');
      } else {
        this.showEncryptDialog();
      }
      if (this._editorMode === mvelo.EDITOR_EXTERNAL) {
        this._emailTextElement.on('keypress', function() {
          if (++that._keyCounter >= 13) {
            that._emailTextElement.off('keypress');
            that._eFrame.fadeOut('slow', function() {
              that._closeFrame();
            });
          }
        });
      }
    },

    _normalizeButtons: function() {
      //console.log('editor mode', this._editorMode);
      this._eFrame.find('.m-encrypt-button').hide();
      switch (this._editorMode) {
        case mvelo.EDITOR_WEBMAIL:
          this._eFrame.find('#encryptBtn').show();
          this._eFrame.find('#signBtn').show();
          break;
        case mvelo.EDITOR_EXTERNAL:
          this._eFrame.find('#editorBtn').show();
          break;
        case mvelo.EDITOR_BOTH:
          this._eFrame.find('#encryptBtn').show();
          this._eFrame.find('#editorBtn').show();
          break;
        default:
          throw 'Unknown editor mode';
      }
      if (this._emailUndoText) {
        this._eFrame.find('#undoBtn').show();
      }
      this._setFrameDim();
    },

    _onSignButton: function() {
      this.showSignDialog();
      return false;
    },

    _onEncryptButton: function() {
      this.showEncryptDialog();
      return false;
    },

    _onUndoButton: function() {
      this._resetEmailText();
      this._normalizeButtons();
      return false;
    },

    _onEditorButton: function() {
      this._emailTextElement.off('keypress');
      this._showMailEditor();
      return false;
    },

    showSignDialog: function() {
      this._expandFrame(this._showDialog.bind(this, 'sign'));
    },

    showEncryptDialog: function() {
      this._expandFrame(this._showDialog.bind(this, 'encrypt'));
    },

    _expandFrame: function(callback) {
      this._eFrame.hide();
      this._eFrame.find('.m-encrypt-button').hide();
      this._eFrame.addClass('m-encrypt-frame-expanded');
      this._eFrame.css('margin', this._editElement.css('margin'));
      this._isToolbar = false;
      this._setFrameDim();
      this._eFrame.fadeIn('slow', callback);
    },

    _closeFrame: function(finalClose) {
      this._eFrame.fadeOut(function() {
        window.clearInterval(this._refreshPosIntervalID);
        $(window).off('resize');
        this._eFrame.remove();
        if (finalClose === true) {
          this._port.disconnect();
          this._editElement.data(mvelo.FRAME_STATUS, null);
        } else {
          this._editElement.data(mvelo.FRAME_STATUS, mvelo.FRAME_DETACHED);
        }
        this._editElement.data(mvelo.FRAME_OBJ, null);
      }.bind(this));
      return false;
    },

    _setFrameDim: function() {
      var editElementPos = this._editElement.position();
      var editElementWidth = this._editElement.width();
      if (this._isToolbar) {
        //var toolbarWidth = this._eFrame.width();
        //this._eFrame.css('top', editElementPos.top + 3);
        //this._eFrame.css('left', editElementPos.left);//editElementPos.left + editElementWidth - toolbarWidth - 20);
      } else {
        this._eFrame.css('top', editElementPos.top + 2);
        this._eFrame.css('left', editElementPos.left + 2);
        this._eFrame.width(editElementWidth - 20);
        this._eFrame.height(this._editElement.height() - 4);
      }
    },

    _showDialog: function(type) {
      this._eDialog = $('<iframe/>', {
        id: 'eDialog-' + this.id,
        'class': 'm-frame-dialog',
        frameBorder: 0,
        scrolling: 'no'
      });
      var url, dialog;
      if (type === 'encrypt') {
        dialog = 'encryptDialog';
      } else if (type === 'sign') {
        dialog = 'signDialog';
      }
      if (mvelo.crx) {
        url = mvelo.extension.getURL('common/ui/inline/dialogs/' + dialog + '.html?id=' + this.id);
      } else if (mvelo.ffa) {
        url = 'about:blank?mvelo=' + dialog + '&id=' + this.id;
      }
      this._eDialog.attr('src', url);
      this._eFrame.append(this._eDialog);
      this._setFrameDim();
      this._eDialog.fadeIn();
    },

    _showMailEditor: function() {
      this._port.postMessage({
        event: 'eframe-display-editor',
        sender: 'eFrame-' + this.id,
        text: this._getEmailText(this._editorType == mvelo.PLAIN_TEXT ? 'text' : 'html')
      });
    },

    _establishConnection: function() {
      this._port = mvelo.extension.connect({name: 'eFrame-' + this.id});
    },

    _removeDialog: function() {
      if (!this._eDialog) return;
      this._eDialog.fadeOut();
      // removal triggers disconnect event
      this._eDialog.remove();
      this._eDialog = null;
      this._showToolbar();
    },

    _showToolbar: function() {
      this._eFrame.fadeOut(function() {
        this._eFrame.removeClass('m-encrypt-frame-expanded');
        this._eFrame.removeAttr('style');
        this._isToolbar = true;
        this._normalizeButtons();
        this._eFrame.fadeIn('slow');
      }.bind(this));
      return false;
    },

    _html2text: function(html) {
      html = $('<div/>').html(html);
      // replace anchors
      html = html.find('a').replaceWith(function() {
                                          return $(this).text() + ' (' + $(this).attr('href') + ')';
                                        })
                           .end()
                           .html();
      html = html.replace(/(<(br|ul|ol)>)/g, '\n'); // replace <br>,<ol>,<ul> with new line
      html = html.replace(/<\/(div|p|li)>/g, '\n'); // replace </div>, </p> or </li> tags with new line
      html = html.replace(/<li>/g, '- ');
      html = html.replace(/<(.+?)>/g, ''); // remove tags
      html = html.replace(/\n{3,}/g, '\n\n'); // compress new line
      return $('<div/>').html(html).text(); // decode
    },

    _getEmailText: function(type) {
      var text, html;
      if (this._emailTextElement.is('textarea')) {
        text = this._emailTextElement.val();
      } else { // html element
        if (type === 'text') {
          this._emailTextElement.focus();
          var element = this._emailTextElement.get(0);
          var sel = element.ownerDocument.defaultView.getSelection();
          sel.selectAllChildren(element);
          text = sel.toString();
          sel.removeAllRanges();
        } else {
          html = this._emailTextElement.html();
          html = html.replace(/\n/g, ''); // remove new lines
          text = html;
        }
      }
      return text;
    },

    /**
     * Save editor content for later undo
     */
    _saveEmailText: function() {
      if (this._emailTextElement.is('textarea')) {
        this._emailUndoText = this._emailTextElement.val();
      } else {
        this._emailUndoText = this._emailTextElement.html();
      }
    },

    _getEmailRecipient: function() {
      var emails = [];
      var emailRegex = /^\s*[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}\s*$/g;
      $('span').filter(':visible').each(function() {
        var valid = $(this).text().match(emailRegex);
        if (valid !== null) {
          // second filtering: only direct text nodes of span elements
          var spanClone = $(this).clone();
          spanClone.children().remove();
          valid = spanClone.text().match(emailRegex);
          if (valid !== null) {
            console.log("got recipient(1): ", $(this));
            emails = emails.concat(valid);
          }
        // this test is very gmail-specific but it works for now:
        } else if ($(this).attr('email') !== undefined && $(this).attr('name') === undefined) {
          valid = $(this).attr('email').match(emailRegex);
          if (valid !== null) {
            console.log("got recipient(2): ", $(this));
            emails = emails.concat(valid);
          }
        }
      });
      $('input, textarea').filter(':visible').each(function() {
        var valid = $(this).val().match(emailRegex);
        if (valid !== null) {
          emails = emails.concat(valid);
        }
      });
      //console.log('found emails', emails);
      return emails;
    },

    /**
     * Replace content of editor element (_emailTextElement)
     * @param {string} msg txt or html content
     */
    _setMessage: function(msg, type) {
      if (this._emailTextElement.is('textarea')) {
        // decode HTML entities for type text due to previous HTML parsing
        msg = $('<div/>').html(msg).text(); // decode
        if (this._options.set_text) {
          this._options.set_text(msg);
        } else {
          this._emailTextElement.val(msg);
        }
      } else {
        // element is contenteditable or RTE
        if (type == 'text') {
          var wrapper = $('<div/>');
          wrapper.append($('<pre/>').html(msg));
          msg = wrapper.html();
        }
        if (this._options.set_text) {
          this._options.set_text(msg);
        } else {
          this._emailTextElement.html(msg);
        }
      }
    },

    _resetEmailText: function() {
      if (this._emailTextElement.is('textarea')) {
        this._emailTextElement.val(this._emailUndoText);
      } else {
        this._emailTextElement.html(this._emailUndoText);
      }
      this._emailUndoText = null;
    },

    _registerEventListener: function() {
      var that = this;
      this._port.onMessage.addListener(function(msg) {
        //console.log('eFrame-%s event %s received', that.id, msg.event);
        switch (msg.event) {
          case 'encrypt-dialog-cancel':
            that._removeDialog();
            break;
          case 'email-text':
            that._port.postMessage({
              event: 'eframe-email-text',
              data: that._getEmailText(msg.type),
              action: msg.action,
              sender: 'eFrame-' + that.id
            });
            break;
          case 'destroy':
            that._closeFrame(true);
            break;
          case 'recipient-proposal':
            that._port.postMessage({
              event: 'eframe-recipient-proposal',
              data: that._getEmailRecipient(),
              sender: 'eFrame-' + that.id
            });
            that._port.postMessage({
              event: 'eframe-textarea-element',
              data: that._emailTextElement.is('textarea'),
              sender: 'eFrame-' + that.id
            });
            break;
          case 'encrypted-message':
          case 'signed-message':
            that._saveEmailText();
            that._removeDialog();
            that._setMessage(msg.message, 'text');
            break;
          case 'set-editor-output':
            that._saveEmailText();
            that._normalizeButtons();
            that._setMessage(msg.text, that._editorType == mvelo.PLAIN_TEXT ? 'text' : 'html');
            break;
          case 'dialog-cancel':
            that._removeDialog();
            break;
          case 'public-key-userids-for':
            var toRecips = that._getEmailRecipient();
            var realKeys = [];
            msg.keys.forEach(function(key){
              if (key.proposal) realKeys.push(key);
            });
            
            //console.log("typed recipients: ", toRecips);
            //console.log("mailvelope keys: ", realKeys);
            if (realKeys.length === 0 || toRecips.length > realKeys.length - 1) { // TODO: only -1 if encrypt-to-self is on
              var noKeyFor = [];
              for (var i = 0; i < toRecips.length; i++) {
                var haveKey = false;
                var lookingFor = "<" + toRecips[i] + ">";
                for (var j = 0; j < realKeys.length; j++) {
                  if (realKeys[j].userid.length >= lookingFor.length && realKeys[j].userid.slice(-lookingFor.length)==lookingFor) {
                    haveKey = true;
                    break;
                  }
                }
                if (!haveKey) noKeyFor = noKeyFor.concat(toRecips[i]);
              }
              if (confirm("This email cannot be encrypted because you do not have an encryption key for the following recipients:\n\n"+noKeyFor+"\n\nWould you like to send them an email requesting their encryption keys?")) {
                document.location.href = '#compose';
                setTimeout(function(){
                  if ($('textarea[name="to"]:last').val() !== "") {
                    console.log("non-empty compose window. aborting.");
                    return;
                  }
                  $('textarea[name="to"]:last').val(noKeyFor.join());
                  $('input[name="subjectbox"]:last').val('[Ezee] Request for secure communication');
                  that._port.postMessage({
                    event: 'key-request-text',
                    sender: 'eFrame-'+that.id,
                  });
                }, 1000);
              }
              $('#encryptCheckbox').attr('checked', false);
              that._sendBtn.html("Send Unencrypted");
            } else {
              that._sendBtn.html("Send");
              var recipKeyIDs = [];
              for (var i = 0; i < realKeys.length; i++) recipKeyIDs.push(realKeys[i].keyid);
              that._port.postMessage({
                event: 'encrypt-dialog-ok',
                sender: 'eFrame-' + that.id,
                recipient: recipKeyIDs,
                type:'webmail'
              });
            }
            break;
          case 'key-request-text':
            $('div.editable[role="textbox"]:last').html(msg.text);
            break;
          default:
            console.log('unknown event');
        }
      });
    }
  };

  encryptFrame.isAttached = function(element) {
    var status = element.data(mvelo.FRAME_STATUS);
    switch (status) {
      case mvelo.FRAME_ATTACHED:
      case mvelo.FRAME_DETACHED:
        return true;
      default:
        return false;
    }
  };

  return encryptFrame;

}());
