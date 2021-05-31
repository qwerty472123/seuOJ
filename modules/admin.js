const Problem = syzoj.model('problem');
const JudgeState = syzoj.model('judge_state');
const Article = syzoj.model('article');
const Contest = syzoj.model('contest');
const Secret = syzoj.model('secret');
const User = syzoj.model('user');
const UserPrivilege = syzoj.model('user_privilege');
const RatingCalculation = syzoj.model('rating_calculation');
const RatingHistory = syzoj.model('rating_history');
const ContestPlayer = syzoj.model('contest_player');
const calcRating = require('../libs/rating');

const xlsx = require('xlsx');
const sim = require('@4qwerty7/sim-node');

let db = syzoj.db;

app.get('/admin/info', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let allSubmissionsCount = await JudgeState.count();
    let todaySubmissionsCount = await JudgeState.count({ submit_time: { $gte: syzoj.utils.getCurrentDate(true) } });
    let problemsCount = await Problem.count();
    let articlesCount = await Article.count();
    let contestsCount = await Contest.count();
    let usersCount = await User.count();

    res.render('admin_info', {
      allSubmissionsCount: allSubmissionsCount,
      todaySubmissionsCount: todaySubmissionsCount,
      problemsCount: problemsCount,
      articlesCount: articlesCount,
      contestsCount: contestsCount,
      usersCount: usersCount
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

let configItems = {
  'title': { name: '站点标题', type: String },
  'gravatar_url': { name: 'Gravatar 代理地址', type: String },
  'local_gravatar_url': { name: 'Gravatar 局域网内代理地址（<code>inner</code> 表示使用内置代理）', type: String },
  '默认参数': null,
  'default.problem.time_limit': { name: '时间限制（单位：ms）', type: Number },
  'default.problem.memory_limit': { name: '空间限制（单位：MiB）', type: Number },
  '限制': null,
  'limit.time_limit': { name: '最大时间限制（单位：ms）', type: Number },
  'limit.memory_limit': { name: '最大空间限制（单位：MiB）', type: Number },
  'limit.data_size': { name: '所有数据包大小（单位：byte）', type: Number },
  'limit.testdata': { name: '测试数据大小（单位：byte）', type: Number },
  'limit.submit_code': { name: '代码长度（单位：byte）', type: Number },
  'limit.submit_answer': { name: '提交答案题目答案大小（单位：byte）', type: Number },
  'limit.testdata_filecount': { name: '测试数据文件数量（单位：byte）', type: Number },
  '每页显示数量': null,
  'page.problem': { name: '题库', type: Number },
  'page.judge_state': { name: '提交记录', type: Number },
  'page.problem_statistics': { name: '题目统计', type: Number },
  'page.ranklist': { name: '排行榜', type: Number },
  'page.discussion': { name: '讨论', type: Number },
  'page.article_comment': { name: '评论', type: Number },
  'page.contest': { name: '比赛', type: Number }
};

app.get('/admin/config', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    for (let i in configItems) {
      if (!configItems[i]) continue;
      configItems[i].val = eval(`syzoj.config.${i}`);
    }

    res.render('admin_config', {
      items: configItems
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/config', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    for (let i in configItems) {
      if (!configItems[i]) continue;
      if (req.body[i]) {
        let val;
        if (configItems[i].type === Boolean) {
          val = req.body[i] === 'on';
        } else if (configItems[i].type === Number) {
          val = Number(req.body[i]);
        } else {
          val = req.body[i];
        }

        let f = new Function('val', `syzoj.config.${i} = val`);
        f(val);
      }
    }

    await syzoj.utils.saveConfig();

    res.redirect(syzoj.utils.makeUrl(['admin', 'config']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/privilege', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let a = await UserPrivilege.query();
    let users = {};
    for (let p of a) {
      if (!users[p.user_id]) {
        users[p.user_id] = {
          user: await User.fromID(p.user_id),
          privileges: []
        };
      }

      users[p.user_id].privileges.push(p.privilege);
    }

    res.render('admin_privilege', {
      users: Object.values(users)
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/privilege', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let data = JSON.parse(req.body.data);
    for (let id in data) {
      let user = await User.fromID(id);
      if (!user) throw new ErrorMessage(`不存在 ID 为 ${id} 的用户。`);
      await user.setPrivileges(data[id]);
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'privilege']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/rating', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const contests = await Contest.query(null, {}, [['start_time', 'desc']]);
    const calcs = await RatingCalculation.query(null, {}, [['id', 'desc']]);
    for (const calc of calcs) await calc.loadRelationships();

    res.render('admin_rating', {
      contests: contests,
      calcs: calcs
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/rating/add', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const contest = await Contest.fromID(req.body.contest);
    if (!contest) throw new ErrorMessage('无此比赛');

    await contest.loadRelationships();
    const newcalc = await RatingCalculation.create(contest.id);
    await newcalc.save();

    if (!contest.ranklist || contest.ranklist.ranklist.player_num <= 1) {
      throw new ErrorMessage("比赛人数太少。");
    }

    const players = [];
    for (let i = 1; i <= contest.ranklist.ranklist.player_num; i++) {
      const user = await User.fromID((await ContestPlayer.fromID(contest.ranklist.ranklist[i])).user_id);
      players.push({
        user: user,
        rank: i,
        currentRating: user.rating
      });
    }
    const newRating = calcRating(players);
    for (let i = 0; i < newRating.length; i++) {
      const user = newRating[i].user;
      user.rating = newRating[i].currentRating;
      await user.save();
      const newHistory = await RatingHistory.create(newcalc.id, user.id, newRating[i].currentRating, newRating[i].rank);
      await newHistory.save();
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'rating']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/admin/rating/delete', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const calcList = await RatingCalculation.query(null, { id: { $gte: req.body.calc_id } }, [['id', 'desc']]);
    if (calcList.length === 0) throw new ErrorMessage('ID 不正确');

    for (let i = 0; i < calcList.length; i++) {
      await calcList[i].delete();
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'rating']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/admin/other', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_other');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/rejudge', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    const contests = await Contest.query(null, {}, [['start_time', 'desc']]);
    const simTypes = sim.supportedTypes;

    res.render('admin_rejudge', {
      form: {},
      count: null,
      contests,
      simTypes
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/other', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    if (req.body.type === 'reset_count') {
      const problems = await Problem.query();
      for (const p of problems) {
        await p.resetSubmissionCount();
      }
    } else if (req.body.type === 'reset_discussion') {
      const articles = await Article.query();
      for (const a of articles) {
        await a.resetReplyCountAndTime();
      }
    } else if (req.body.type === 'reset_codelen') {
      const problems = await Problem.query();
      let typeMap = [];
      for (const p of problems) {
        typeMap[p.id] = p.type;
      }
      
      const submissions = await JudgeState.query();
      await Promise.all(submissions.map(async s => {
        if (typeMap[s.problem_id] !== 'submit-answer') {
          s.code_length = Buffer.from(s.code).length;
          await s.save();
        }
      }));
    } else {
      throw new ErrorMessage("操作类型不正确");
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'other']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});
app.post('/admin/rejudge', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let user = await User.fromName(req.body.submitter || '');
    let where = {};
    if (user) where.user_id = user.id;
    else if (req.body.submitter) where.user_id = -1;

    let minID = parseInt(req.body.min_id);
    if (isNaN(minID)) minID = 0;
    let maxID = parseInt(req.body.max_id);
    if (isNaN(maxID)) maxID = 2147483647;

    where.id = {
      $and: {
        $gte: parseInt(minID),
        $lte: parseInt(maxID)
      }
    };

    let minScore = parseInt(req.body.min_score);
    if (isNaN(minScore)) minScore = 0;
    let maxScore = parseInt(req.body.max_score);
    if (isNaN(maxScore)) maxScore = 100;

    if (!(minScore === 0 && maxScore === 100)) {
      where.score = {
        $and: {
          $gte: parseInt(minScore),
          $lte: parseInt(maxScore)
        }
      };
    }

    let minTime = syzoj.utils.parseDate(req.body.min_time);
    if (isNaN(minTime)) minTime = 0;
    let maxTime = syzoj.utils.parseDate(req.body.max_time);
    if (isNaN(maxTime)) maxTime = 2147483647;

    where.submit_time = {
      $and: {
        $gte: parseInt(minTime),
        $lte: parseInt(maxTime)
      }
    };

    if (req.body.language) {
      if (req.body.language === 'submit-answer') where.language = { $or: [{ $eq: '',  }, { $eq: null }] };
      else if (req.body.language === 'non-submit-answer') where.language = { $not: '' };
      else where.language = req.body.language;
    }
    if (req.body.contest) {
      let val = parseInt(req.body.contest);
      if (val === -1) where.type = 0;
      else if (val === -2) where.type = 1;
      else {
        where.type = 1;
        where.type_info = val;
      }
    }
    if (req.body.status) where.status = { $like: req.body.status + '%' };
    if (req.body.problem_id) where.problem_id = parseInt(req.body.problem_id) || -1;

    let count = await JudgeState.count(where);
    if (req.body.type === 'rejudge') {
      let submissions = await JudgeState.query(null, where);
      for (let submission of submissions) {
        await submission.rejudge();
      }
    } else if (req.body.type === 'sim') {
      if (!sim.supportedTypes.includes(req.body.lex_type)) throw new ErrorMessage('请选择查重词法分析方式。');
      let submissions = await JudgeState.query(null, where);
      let wb = xlsx.utils.book_new();
      let codes = new Map();
      let submissionMap = new Map();
      for (let submission of submissions) {
        submissionMap.set(submission.id, submission);
        codes.set(submission.id, submission.code);
      }
      const diffs = await sim(req.body.lex_type, codes);
      let contest = null;
      if (req.body.contest) {
        let val = parseInt(req.body.contest);
        if (val > 0) {
          contest = await Contest.fromID(val);
        }
      }

      let table = [['A 的提交ID', 'A 的题目ID', 'A 的用户ID', 'A 的用户名', 'A 的绑定信息', 'B 的提交ID', 'B 的题目ID', 'B 的用户ID', 'B 的用户名', 'B 的绑定信息', '相似度', '比较网址', '相同用户', '相同题目']];

      let secret = contest && contest.need_secret;
      if (!secret) {
        table[0] = table[0].filter(x => !x.includes('绑定信息'));
      }

      let lineno = 1;
      const currentProto = req.get("X-Forwarded-Proto") || req.protocol;
      const host = currentProto + '://' + req.get('host');
      const extraInfoMap = new Map();
      async function getExtraInfo(userId) {
        if (extraInfoMap.has(userId)) return extraInfoMap.get(userId);
        const secret = await Secret.find({ type: 0, type_id: contest.id, user_id: userId });
        const info = secret ? secret.extra_info : '(空)';
        extraInfoMap.set(userId, info);
        return info;
      }
      const usernameMap = new Map();
      async function getUsername(userId) {
        if (usernameMap.has(userId)) return usernameMap.get(userId);
        const user = await User.fromID(userId);
        const name = user ? user.username : '(空)';
        usernameMap.set(userId, name);
        return name;
      }
      for (let [a_id, b_id, rate] of diffs) {
        lineno++;
        let a = submissionMap.get(a_id);
        let b = submissionMap.get(b_id);
        let row = [];
        row.push(a.id, a.problem_id, a.user_id);
        row.push(await getUsername(a.user_id));
        if (secret) row.push(await getExtraInfo(a.user_id));
        row.push(b.id, b.problem_id, b.user_id);
        row.push(await getUsername(b.user_id));
        if (secret) row.push(await getExtraInfo(b.user_id));
        row.push(rate);
        const url = host + syzoj.utils.makeUrl(['submissions', 'diff', a.id, b.id]);
        row.push({ t: 's', l: { Target: url, Tooltip: "比较具体内容" }, v: url });
        if (secret) {
          row.push({ t: 's', f: `C${lineno}=H${lineno}`, toString: () => (a.user_id === b.user_id).toString().toUpperCase() });
          row.push({ t: 's', f: `B${lineno}=G${lineno}`, toString: () => (a.user_id === b.user_id).toString().toUpperCase() });
        } else {
          row.push({ t: 's', f: `C${lineno}=G${lineno}`, toString: () => (a.user_id === b.user_id).toString().toUpperCase() });
          row.push({ t: 's', f: `B${lineno}=F${lineno}`, toString: () => (a.user_id === b.user_id).toString().toUpperCase() });
        }
        table.push(row);
      }

      let ws = xlsx.utils.aoa_to_sheet(table);
      ws['!autofilter'] = { ref: 'A1:' + (secret ? 'N' : 'L') + (1 + diffs.length) };
      ws['!cols'] = [];
      for(let i = 0; i < table[0].length; i++) {
        let maxCh = syzoj.utils.countTextWCH(table[0][i].toString(), 2) + 2;
        for (let row of table) if (row[i]) maxCh = Math.max(maxCh, syzoj.utils.countTextWCH(row[i].toString(), 2));
        ws['!cols'].push({ wch: maxCh });
      }
      xlsx.utils.book_append_sheet(wb, ws, '查重结果');
      res.writeHead(200, [['Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['Content-Disposition', require('content-disposition')((contest ? contest.title + '_' : '') + '查重结果.xlsx')]]);
      res.end(xlsx.write(wb, { bookType: 'xlsx', bookSST: false, type: 'buffer' }));
      return;
    }

    const contests = await Contest.query(null, {}, [['start_time', 'desc']]);
    const simTypes = sim.supportedTypes;

    res.render('admin_rejudge', {
      form: req.body,
      count: count,
      contests,
      simTypes
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/links', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_links', {
      links: syzoj.config.links || []
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/links', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    syzoj.config.links = JSON.parse(req.body.data);
    await syzoj.utils.saveConfig();

    res.redirect(syzoj.utils.makeUrl(['admin', 'links']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/raw', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_raw', {
      data: JSON.stringify(syzoj.config, null, 2)
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/raw', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    syzoj.config = JSON.parse(req.body.data);
    await syzoj.utils.saveConfig();

    res.redirect(syzoj.utils.makeUrl(['admin', 'raw']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/restart', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    syzoj.restart();

    res.render('admin_restart', {
      data: JSON.stringify(syzoj.config, null, 2)
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/serviceID', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.send({
        serviceID: syzoj.serviceID
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});