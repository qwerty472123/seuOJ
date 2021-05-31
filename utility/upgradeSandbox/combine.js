const fs = require('fs');
let upg = JSON.parse(fs.readFileSync('version.json', 'utf-8'));
let old = fs.readFileSync('../../language-config.json', 'utf-8');
fs.writeFileSync('../../language-config.json.bak', old);
let json = JSON.parse(old);
for (let name in upg) {
    if (!(name in json)) {
        console.log(`${name} does not exist in config!`);
        continue;
    }
    json[name].version = upg[name];
}
fs.writeFileSync('../../language-config.json', JSON.stringify(json, null, 2));