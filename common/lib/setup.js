define(function (require, exports, module) {

  var mvelo = require('../lib-mvelo').mvelo;
  var model = require('./pgpViewModel');

  var windowPopup = null;

  init();

  function init() {
    console.log("in init()");
    var prefs = model.getPreferences();
    console.log("preferences: ", prefs);
    if (!prefs || !prefs.general || !prefs.general.primary_key) {
     // First time being run --- show welcome popup
      console.log("opening popup...");
      mvelo.windows.openPopup('common/ui/modal/welcome.html?id=' + name, {width: 742, height: 650, modal: true}, function(window) {
        windowPopup = window;
      });
      //alert('Welcome to mailvelope!');
    } else {
      console.log("not opening popups because prefs found");
    }
  }

  function closeWelcomeWindow() {
    windowPopup.close();
    windowPopup = null;
  }

  exports.closeWelcomeWindow = closeWelcomeWindow;
});
