#!/bin/bash

npm install && bower install && grunt
grunt dist-cr
cd dist
rm -rf chrome
unzip mailvelope.chrome.zip

