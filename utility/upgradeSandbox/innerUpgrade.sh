do-release-upgrade -c
echo "Consider do-release-upgrade manually if new LTS version exist"
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt update
apt upgrade -y
sdk selfupdate
sdk update
sdk ug kotlin
node versionDetector.js > version.json
exit