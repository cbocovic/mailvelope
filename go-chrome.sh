#!/bin/bash

npm install && bower install && grunt

if [ $? -ne 0 ]; then
  echo "Error npm/bower/grunt, terminating."
  exit
fi

grunt dist-cr

if [ $? -ne 0 ]; then
  echo "Error building dist-cr, terminating."
  exit
fi

cd dist
rm -rf chrome
unzip mailvelope.chrome.zip

