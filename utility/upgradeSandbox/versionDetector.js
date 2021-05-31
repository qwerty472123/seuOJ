const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

async function execRed(command) {
    return (await exec(command + ' 2>&1')).stdout;
}

async function getVersions() {
    const NOILinuxVersion = '1.4.1';
    const result = {};
    async function getGCCVersion(cmd) {
        let gcc = await execRed(cmd + ' --version');
        gcc = gcc.replace(/\n/g, ' ').replace(/\([^\)]*\)/g, ' ').split(' ').filter(x => x.length > 0);
        return gcc.slice(0, 2).join(' ').trim().replace('gcc', 'GCC').replace('g++', 'G++');
    }
    async function getClangVersion(cmd) {
        let clang = await execRed(cmd + ' --version');
        clang = clang.replace(/\n/g, ' ').split(' ').filter(x => x.length > 0);
        let name = clang[0].replace('clang', 'Clang'), version = clang.includes("version") ? clang[clang.indexOf("version") + 1] : (clang.length >= 3 ? clang[2] : '');
        version = version.split('-')[0];
        return [name, version].join(' ').trim();
    }
    async function getPypyVersion(cmd) {
        let out = await execRed(cmd + ' --version');
        out = out.replace(/[\n\[\]]/g, ' ').toLowerCase().split(' ').filter(x => x.length > 0);
        let python = out.includes("python") ? out[out.indexOf("python") + 1] : (out.length >= 2 ? out[1] : '');
        let pypy = out.includes("pypy") ? ` (PyPy ${out[out.indexOf("pypy") + 1]})` : '';
        return `Python ${python}${pypy}`;
    }
    let preWork = {
        async jdk() {
            let java = await execRed('java -version');
            java = java.replace(/\n/g, ' ').split(' ').map(x => x.replace(/[\"\']/g, '').trim()).filter(x => x.length > 0);
            let name = java[0].replace('jdk', 'JDK').replace('open', 'Open').replace('java', 'Java'), version = java.includes("version") ? java[java.indexOf("version") + 1] : (java.length >= 3 ? java[2] : '');
            result.java = [name, version].join(' ').trim();
            return ` (${result.java})`;
        },
        async mono() {
            let mono = await execRed('mono -V');
            mono = mono.replace(/\n/g, ' ').split(' ').filter(x => x.length > 0);
            mono = mono.includes('version') ? ` (Mono ${mono[mono.indexOf('version') + 1]})` : '';
            return mono;
        },
        async clang() {
            return result['c'] = await getClangVersion('clang');
        }
    };
    let preResult = {};
    for (let name in preWork) preResult[name] = preWork[name]();
    await Promise.all([
        async () => {
            let fpc = await execRed('fpc -iV');
            result.pascal = `Free Pascal ${fpc.trim()}`;
        },
        async () => {
            let kotlin = await execRed('kotlinc -version');
            kotlin = kotlin.replace('info:', '').replace('-jvm', '').replace('kotlin', 'Kotlin').trim();
            if (kotlin.includes('(')) kotlin = kotlin.slice(0, kotlin.indexOf('(')).trim();
            result.kotlin = kotlin + await preResult.jdk;
        },
        async () => {
            result.cpp = result.cpp11 = result.cpp17 = await getGCCVersion('g++');
        },
        async () => {
            result['c-noilinux'] = await getGCCVersion('/usr/bin/compile-c-noilinux') + ` (NOILinux ${NOILinuxVersion})`;
        },
        async () => {
            result['cpp-noilinux'] = result['cpp11-noilinux'] = await getGCCVersion('/usr/bin/compile-cpp-noilinux') + ` (NOILinux ${NOILinuxVersion})`;
        },
        async () => {
            result['cpp11-clang'] = result['cpp17-clang'] = await getClangVersion('clang++');
        },
        async () => {
            let csc = await execRed('csc -version');
            result.csharp = 'CSC ' + csc.split('-')[0] + await preResult.mono;
        },
        async () => {
            let vbc = await execRed('vbc -version');
            result.vbnet = 'VBC ' + vbc.split('-')[0] + await preResult.mono;
        },
        async () => {
            let fsharp = await execRed('fsharpc --help');
            fsharp = fsharp.replace(/\n/g, ' ').split(' ').filter(x => x.length > 0);
            result.fsharp = 'FSharpc ' + (fsharp.includes('version') ? fsharp[fsharp.indexOf('version') + 1] : '') + await preResult.mono;
        },
        async () => {
            let go = await execRed('go version');
            go = go.replace(/\n/g, ' ').split(' ').filter(x => x.length > 0);
            let name = go[0].replace('go', 'Go'), version = go.includes("version") ? go[go.indexOf("version") + 1] : (go.length >= 3 ? go[2] : '');
            version = version.replace('go', '');
            result.go = [name, version].join(' ').trim();
        },
        async () => {
            result['python2'] = await getPypyVersion('pypy');
        },
        async () => {
            result['python3'] = await getPypyVersion('pypy3');
        },
        async () => {
            let node = await execRed('node -v');
            node = node.toLowerCase().replace('v', '').trim();
            result['nodejs'] = 'Node.js ' + node;
        },
        async () => {
            let rust = await execRed('rustc -V');
            result['rust'] = rust.replace('rust', 'Rust').trim();
        },
        async () => {
            let lua = await execRed('lua -v');
            lua = lua.replace(/\n/g, ' ').split(' ').filter(x => x.length > 0);
            result['lua'] = lua.slice(0, 2).join(' ').trim();
        },
        async () => {
            let lua = await execRed('luajit -v');
            lua = lua.replace(/\n/g, ' ').split(' ').filter(x => x.length > 0);
            result['luajit'] = lua.slice(0, 2).join(' ').trim();
        },
        async () => {
            let [ocaml, ocamlbuild] = await Promise.all([execRed('ocaml -version'), execRed('ocamlbuild -version')]);
            ocamls = ocaml.replace(/\n/g, ' ').split(' ').filter(x => x.length > 0);
            let ver = ocamls.includes("version") ? ocamls[ocamls.indexOf("version") + 1].trim() : ocaml.split(',').pop().trim();
            ocamlbuild = ocamlbuild.trim().replace('ocamlbuild', 'OCamlBuild');
            result['ocaml'] = `OCaml ${ver} (${ocamlbuild})`;
        },
        async () => {
            let ruby = await execRed('ruby -v');
            ruby = ruby.replace(/\n/g, ' ').split(' ').filter(x => x.length > 0);
            result['ruby'] = ruby.slice(0, 2).join(' ').trim().replace('ruby', 'Ruby');
        },
        async () => {
            let vala = await execRed('valac --version');
            result['vala'] = `${vala.trim()} (${await preResult.clang})`;
        },
        async () => {
            let haskell = await execRed('ghc --version');
            let ver = haskell.includes('version') ? haskell.split('version').pop().split(',')[0] : haskell.split(',').pop();
            result['haskell'] = 'GHC ' + ver.trim();
        }
    ].map(func => func()));
    return result;
}

module.exports = getVersions;

if (require.main === module) {
    getVersions().then(version => console.log(JSON.stringify(version, null, 2)));
}
