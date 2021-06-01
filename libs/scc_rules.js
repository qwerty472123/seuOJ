module.exports = [
    ['seuscc2014oj', ['东南短码14(OJ)', function calcCodeLength(code, lang) {
      return code.replace(/\s/g,'').length;
    }, function calcCodeScore(len, minLen) { 
      return Math.pow(100, minLen / len);
    }]],
    ['seuscc2014rule', ['东南短码14(章程)', function calcCodeLength(code, lang) {
      return code.replace(/\s/g,'').length;
    }, function calcCodeScore(len, minLen) { 
      return Math.pow(100, Math.sqrt(minLen / len));
    }]],
    ['seuscc2019', ['东南短码19', function calcCodeLength(code, lang) { // Only support Java/C/Python/Kotlin/Nodejs
        lang = lang.toLowerCase();
        let isC = lang.startsWith('c');
        let isJava = lang.startsWith('j');
        code = code.replace(/\r\n/g,'\n');
        if (isC) {
          return code.split('\n').map(x => {
            let y = x.trim();
            if (y.startsWith('#')) y += '\n';
            return y;
          }).join('').length; 
        } else if (isJava) return code.split('\n').map(x => x.trim()).join('').length;
        else return code.length; // Like Python/Kotlin/Nodejs
      }, function calcCodeScore(len, minLen) { 
        return Math.pow(100, Math.sqrt(minLen / len));
      }]],
      ['seuscc2021', ['东南短码21', function calcCodeLength(code, lang) { // Only support Java/C/Python/Kotlin/Nodejs
        lang = lang.toLowerCase();
        let isC = lang.startsWith('c');
        let isJava = lang.startsWith('j');
        code = code.replace(/\r\n/g,'\n');
        if (isC) {
          return code.split('\n').map(x => {
            let y = x.trim();
            if (y.startsWith('#')) y += '\n';
            return y;
          }).join('').length; 
        } else if (isJava) return code.split('\n').map(x => x.trim()).join('').length;
        else if (lang.startsWith('py')) return code.length * 2; // 2021 Python special rule
        else return code.length; // Like Kotlin/Nodejs
      }, function calcCodeScore(len, minLen) { 
        return Math.pow(100, Math.sqrt(minLen / len));
      }]],
      /**
       * Append new rules here.
       * Format like ['Internal name(stability required)', ['Show name', function calcCodeLength(code, lang) { return len; }, function calcCodeScore(len, minLen) { return float_score_0_to_100; }]],
       */
];