#!/bin/bash -e

cd $(dirname $0)
CUR_PATH=`pwd`
SANDBOX_ROOT="/opt/syzoj/sandbox/rootfs/"
BIN_CACHE_ROOT="/opt/syzoj/sandbox/bin/"
cp versionDetector.js $SANDBOX_ROOT
cd $SANDBOX_ROOT
cat $CUR_PATH/innerUpgrade.sh | chroot ./
mv version.json $CUR_PATH
rm versionDetector.js
cd $CUR_PATH
node combine.js
rm version.json
echo flushall | redis-cli
rm -r $BIN_CACHE_ROOT/*
echo "Upgrade done."
echo "Please commit the language-config.json change."