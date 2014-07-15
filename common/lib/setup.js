define(function (require, exports, module) {

  var mvelo = require('../lib-mvelo').mvelo;
  var model = require('./pgpViewModel');

  var windowPopup = null;

  init();

  function init() {
    var prefs = model.getPreferences();
    if (!prefs) {
     // First time being run --- show welcome popup
      mvelo.windows.openPopup('common/ui/modal/welcome.html?id=' + name, {width: 742, height: 450, modal: true}, function(window) {
        windowPopup = window;
      });
      //alert('Welcome to mailvelope!');
    }
  }

  function closeWelcomeWindow() {
    windowPopup.close();
    windowPopup = null;
  }

  exports.closeWelcomeWindow = closeWelcomeWindow;
});
