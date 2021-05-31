#!/bin/bash -e

CUR_PATH=`pwd`
SANDBOX_ROOT="/opt/syzoj/sandbox/rootfs/"
cp versionDetector.js $SANDBOX_ROOT
cd $SANDBOX_ROOT
cat $CUR_PATH/innerUpgrade.sh | chroot ./
mv version.json $CUR_PATH
rm versionDetector.js
cd $CUR_PATH
node combine.js
rm version.json
echo "Upgrade done."
echo "Please commit the language-config.json change."