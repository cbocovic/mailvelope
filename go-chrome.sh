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
rm -rf chrome1
unzip mailvelope.chrome.zip
mv chrome chrome1
cd ..

sed -i 's|background-color: rgba(254,251,243,1); /\*version 1\*/|background-color: rgba(254,251,243,.7); /*version 1*/|g' common/ui/inline/framestyles.css

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
rm -rf chrome2
unzip mailvelope.chrome.zip
mv chrome chrome2

cd ..
sed -i 's|background-color: rgba(254,251,243,.7); /\*version 1\*/|background-color: rgba(254,251,243,1); /*version 1*/|g' common/ui/inline/framestyles.css
