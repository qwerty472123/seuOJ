do-release-upgrade -c
echo "Consider do-release-upgrade manually if new LTS version exist"
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt update
apt upgrade -y
sdk selfupdate
sdk update
sdk ug kotlin
sdk ug scala
node versionDetector.js > version.json
echo "Swift need maually download from https://swift.org/download/#releases and unpack it to \$sandbox_root/opt/swift"
exit