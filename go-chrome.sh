#!/bin/bash

grunt dist-cr
cd dist
rm -rf chrome
unzip mailvelope.chrome.zip

