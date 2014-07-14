/**This file contains code that should be run when the application is first installed. It
	will prompt new users to generate or import their keys.**/

define(function (require, exports, module) {

  var mvelo = require('../lib-mvelo').mvelo;
  var openpgp = require('openpgp');
  var model = require('./pgpViewModel');

  var newUser = false;

  init();
  
  function init() {

    //Check to see if user has already generated keys
    var keys = model.getPrivateKeys();
    if(keys.length === 0){
      newUser = true;
      alert('Welcome!');
    }
    
  //  this._port.postMessage({
  //    event: 'wframe-display-welcome',
  //    sender: 'eFrame-' + this.id,
  //  });
  }

});
