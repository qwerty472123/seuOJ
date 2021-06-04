const Contest = syzoj.model('contest');
const ContestRanklist = syzoj.model('contest_ranklist');
const ContestPlayer = syzoj.model('contest_player');
const Problem = syzoj.model('problem');
const JudgeState = syzoj.model('judge_state');
const User = syzoj.model('user');
const Secret = syzoj.model('secret');
const ProblemTagMap = syzoj.model('problem_tag_map');
const ProblemTag = syzoj.model('problem_tag');

const Email = require('../libs/email');

const randomstring = require('randomstring');
const xlsx = require('xlsx');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const jwt = require('jsonwebtoken');

const { getSubmissionInfo, getRoughResult, processOverallResult } = require('../libs/submissions_process');

app.get('/contests', async (req, res) => {
  try {
    if (syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) {
      res.redirect(syzoj.utils.makeUrl(['contest', syzoj.config.cur_vip_contest]));
    }
    let where;
    if (res.locals.user && res.locals.user.is_admin) where = {}
    else where = { is_public: true };

    let paginate = syzoj.utils.paginate(await Contest.count(where), req.query.page, syzoj.config.page.contest);
    let contests = await Contest.query(paginate, where, [['start_time', 'desc']]);

    await contests.forEachAsync(async x => x.subtitle = await syzoj.utils.markdown(x.subtitle));

    res.render('contests', {
      contests: contests,
      paginate: paginate
    })
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/edit', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.fromID(contest_id);
    if (!contest) {
      if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

      contest = await Contest.create();
      contest.id = 0;
    } else {
      if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

      await contest.loadRelationships();
    }

    let problems = [], admins = [], tags = [];
    if (contest.problems) {
      problems = await contest.problems.split('|').mapAsync(async id => await Problem.fromID(id));
      if (problems.length > 0) {
        let problemsTags = await problems.mapAsync(async problem => (await ProblemTagMap.findAll({
          where: {
            problem_id: problem.id
          }
        })).map(map => map.tag_id));
        let comm = problemsTags[0].filter(id => !problemsTags.some(x => !x.includes(id)));
        tags = await comm.mapAsync(async id => {
          return ProblemTag.fromID(id);
        });
        tags.sort((a, b) => {
          return a.color > b.color ? 1 : -1;
        });
      }
    }
    if (contest.admins) admins = await contest.admins.split('|').mapAsync(async id => await User.fromID(id));

    if ((!contest.id || contest.type === 'scc') && !contest.scc_rule) {
      // Set latest to default
      contest.scc_rule = Array.from(syzoj.utils.sccRules.keys()).pop();
    }

    res.render('contest_edit', {
      contest,
      problems,
      admins,
      tags,
      sccRules: Array.from(syzoj.utils.sccRules.entries())
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/contest/:id/edit', async (req, res) => {
  try {
    if (!req.body.title.trim()) throw new ErrorMessage('比赛名不能为空。');
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.fromID(contest_id);
    let ranklist = null;
    if (!contest) {
      if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

      // Only new contest can be set type
      if (!['noi', 'ioi', 'acm', 'scc'].includes(req.body.type)) throw new ErrorMessage('无效的赛制。');

      contest = await Contest.create();

      contest.holder_id = res.locals.user.id;
      contest.type = req.body.type;
      contest.one_language = req.body.one_language === 'on';
      contest.ban_count = parseInt(req.body.ban_count);
      if (!Array.isArray(req.body.allow_languages)) req.body.allow_languages = [req.body.allow_languages];
      contest.allow_languages = req.body.allow_languages.join('|');

      ranklist = await ContestRanklist.create();
    } else {
      if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

      await contest.loadRelationships();
      ranklist = contest.ranklist;
    }

    if (contest.type === 'scc') {
      contest.scc_rule = req.body.scc_rule;
      if (!syzoj.utils.sccRules.has(contest.scc_rule)) throw new ErrorMessage('短码规则不存在。');
    } else {
      contest.scc_rule = '';
    }

    try {
      ranklist.ranking_params = JSON.parse(req.body.ranking_params);
    } catch (e) {
      ranklist.ranking_params = {};
    }
    ranklist.ranking_group_info = [];
    if (req.body.need_secret) {
      let valid = true;
      try {
        let json = JSON.parse(req.body.ranking_group_info);
        if (json instanceof Array && json.length == 2 && json[0] instanceof Object && json[1] instanceof Array) {
          for (let code in json[0]) {
            if ( !(/^(0|[1-9]\d*)$/.test(code)) || !(json[0][code] instanceof Array) || json[0][code].length != 2
              || typeof json[0][code][0] != 'string' || typeof json[0][code][1] != 'string') {
                valid = false;
                break;
              }
          }
          if (valid) {
            for (let rank_cfg of json[1]) {
              if (!(rank_cfg instanceof Array) || rank_cfg.length != 3 || typeof rank_cfg[0] != 'string'
               || !(rank_cfg[1] instanceof Array) || !(rank_cfg[2] instanceof Array)) {
                valid = false;
                break;
               }
               for (let code of rank_cfg[1]) if (typeof code != 'number') {
                 valid = false;
                 break;
               }
               if (valid) {
                 for (let line_cfg of rank_cfg[2]) if (!(line_cfg instanceof Array) || line_cfg.length != 4
                  || typeof line_cfg[0] != 'string' || typeof line_cfg[1] != 'boolean' || typeof line_cfg[2] != 'number'
                  || typeof line_cfg[3] != 'string') {
                    valid = false;
                    break;
                  }
               }
               if (!valid) break;
            }
          }
          if (valid) ranklist.ranking_group_info = json;
        }
      } catch (e) {
        valid = false;
      }
      if (!valid) throw new ErrorMessage('排行方式非法。');
    }
    await ranklist.save();
    contest.ranklist_id = ranklist.id;

    contest.title = req.body.title;
    contest.subtitle = req.body.subtitle;
    if (!Array.isArray(req.body.problems)) {
      if (typeof req.body.problems != "string" && typeof req.body.problems != "number")
        req.body.problems = [];
      else req.body.problems = [req.body.problems];
    }
    if (!Array.isArray(req.body.admins)) req.body.admins = [req.body.admins];
    let fixedPids = [];
    for (let pid of req.body.problems) fixedPids.push(pid.startsWith('P') ? pid.slice(1) : pid);
    let problems = await fixedPids.mapAsync(async x => Problem.fromID(parseInt(x)));
    problems = problems.filter(x => !!x);
    contest.problems = problems.map(x => x.id).join('|');
    contest.admins = req.body.admins.join('|');
    contest.information = req.body.information;
    contest.start_time = syzoj.utils.parseDate(req.body.start_time);
    contest.end_time = syzoj.utils.parseDate(req.body.end_time);
    if (contest.start_time > contest.end_time) throw new ErrorMessage('开始时间不能超过结束时间！');
    contest.is_public = req.body.is_public === 'on';
    contest.hide_statistics = req.body.hide_statistics === 'on';
    contest.need_secret = req.body.need_secret === 'on';
    if (['acm', 'scc'].includes(contest.type) && req.body.enable_freeze) {
      let freeze_time = syzoj.utils.parseDate(req.body.freeze_time);
      if (contest.start_time > freeze_time || contest.end_time < freeze_time) throw new ErrorMessage('封榜时间应在比赛时间内！');
      if (freeze_time !== contest.freeze_time) {
        let now = syzoj.utils.getCurrentDate();
        if (now >= freeze_time) throw new ErrorMessage('新设定封榜时间不能小于当前时间！');
        if (contest.freeze_time && now >= contest.freeze_time) {
          contest.freeze_time = freeze_time;
          await ranklist.updatePlayer(contest, null, null);
          await ranklist.save();
        } else contest.freeze_time = freeze_time;
      }
    } else if (req.body.enable_freeze) throw new ErrorMessage('该比赛的赛制无法进行封榜！');
    else {
      if (contest.freeze_time) {
        ranklist.freeze_ranking = [];
        await ranklist.save();
      }
      contest.freeze_time = 0;
    }

    if (req.body.enable_rank_open) {
      let rank_open_time = syzoj.utils.parseDate(req.body.rank_open_time);
      if (contest.start_time > rank_open_time || contest.end_time < rank_open_time) throw new ErrorMessage('开榜时间应在比赛时间内！');
      if (contest.freeze_time && rank_open_time > contest.freeze_time) throw new ErrorMessage('开榜时间应在封榜时间前！');
      contest.rank_open_time = rank_open_time;
    } else {
      contest.rank_open_time = 0;
    }

    await contest.save();

    let prevTags = [], newTags = [];
    if (req.body.common_tags) {
      if (Array.isArray(req.body.common_tags)) {
        newTags = req.body.common_tags;
      } else {
        newTags = [req.body.common_tags];
      }
      newTags = newTags.map(x => parseInt(x));
    }
    if (req.body.previous_common_tags && req.body.previous_common_tags.length > 0) {
      prevTags = req.body.previous_common_tags.split('|').map(x => x.trim()).filter(x => x.length > 0).map(x => parseInt(x));
    }
    let removeIds = prevTags.filter(x => !newTags.includes(x));
    let addIds = newTags.filter(x => !prevTags.includes(x));
    if (removeIds.length > 0 || addIds.length > 0) {
      for (let problem of problems) {
        let newTagIDs = Array.from(new Set((await ProblemTagMap.findAll({
          where: {
            problem_id: problem.id
          }
        })).map(map => map.tag_id).filter(id => !removeIds.includes(id)).concat(addIds)));
        await problem.setTags(newTagIDs);
      }
    }

    res.redirect(syzoj.utils.makeUrl(['contest', contest.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/secret', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');

    let paginate = null, secrets = null;
    const sort = req.query.sort || syzoj.config.sorting.secret.field;
    const order = req.query.order || syzoj.config.sorting.secret.order;
    let searchData = {};
    if (!['secret', 'extra_info', 'classify_code', 'user_id', 'email'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }
    let where = {
      type: 0,
      type_id: contest.id
    };
    searchData.secret = req.query.secret || '';
    if (req.query.secret) where.secret = req.query.secret;
    searchData.extra_info = req.query.extra_info || '';
    if (req.query.extra_info) where.extra_info = { [syzoj.db.Op.like]: `%${req.query.extra_info}%` };
    searchData.classify_code = req.query.classify_code || '';
    if (req.query.classify_code) where.classify_code = req.query.classify_code;
    searchData.email = req.query.email || '';
    if (req.query.email) where.email = req.query.email;
    searchData.user = [];
    if (req.query.user_ids) {
      if (!Array.isArray(req.query.user_ids)) req.query.user_ids = [req.query.user_ids];
      let cond = [];
      for(let id of req.query.user_ids) {
        cond.push({ [syzoj.db.Op.eq]: id });
        if (id == '-1') {
          searchData.user.push({ id: -1, name: '暂未绑定' });
          continue;
        }
        let user = await User.fromID(id);
        if (user) searchData.user.push({ id, name: user.username });
      }
      where.user_id = { [syzoj.db.Op.or]: cond };
    }
    paginate = syzoj.utils.paginate(await Secret.count(where), req.query.page, syzoj.config.page.secret);
    secrets = await Secret.query(paginate, where, [[sort, order]]);
    await secrets.forEachAsync(async v => await v.loadRelationships());
    res.render('secret_manager', {
      paginate,
      secrets,
      curSort: sort,
      curOrder: order === 'asc',
      curType: 'contest',
      curTitle: contest.title,
      curTypeDesc: '比赛',
      curTypeId: contest.id,
      searchData
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/contest/:id/secret/apply', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');
    if (Array.isArray(req.body.user_ids) || !req.body.user_ids) throw new ErrorMessage('指定的用户应为一个');
    let user_id = parseInt(req.body.user_ids);
    
    let rec = null;
    if (!req.body.secret) {
      do {
        req.body.secret = randomstring.generate(16);
      } while(await Secret.find({ type: 0, type_id: contest.id, secret: req.body.secret }));
    } else rec = await Secret.find({ type: 0, type_id: contest.id, secret: req.body.secret });
    if (user_id != -1 && await Secret.find({type: 0, type_id: contest.id, user_id, secret: { [syzoj.db.Op.ne]: req.body.secret }}))
      throw new ErrorMessage('一个用户只能绑定一个准入码');
    if (!rec) rec = await Secret.create({ type: 0, type_id: contest.id, secret: req.body.secret });

    rec.user_id = user_id;
    rec.extra_info = req.body.extra_info;
    rec.classify_code = req.body.classify_code;
    rec.email = req.body.email;
    await rec.save();

    res.send({ success: true });
  } catch (e) {
    res.send({ success: false, message: e.message });
  }
});

app.post('/contest/:id/secret/delete', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');
    
    let secret = await Secret.find({
      type: 0,
      type_id: contest.id,
      secret: req.body.secret
    });

    if (!secret) throw new ErrorMessage('找不到记录');

    await secret.destroy();

    res.send({ success: true });
  } catch (e) {
    res.send({ success: false, message: e.message });
  }
});

app.post('/contest/:id/secret/delete_all', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');

    let where = {
      type: 0,
      type_id: contest.id
    };
    if (req.body.secret) where.secret = req.body.secret;
    if (req.body.extra_info) where.extra_info = { [syzoj.db.Op.like]: `%${req.body.extra_info}%` };
    if (req.body.classify_code) where.classify_code = req.body.classify_code;
    if (req.body.email) where.email = req.body.email;
    if (req.body.user_ids) {
      if (!Array.isArray(req.body.user_ids)) req.body.user_ids = [req.body.user_ids];
      let cond = [];
      for(let id of req.body.user_ids) cond.push({ [syzoj.db.Op.eq]: id });
      where.user_id = { [syzoj.db.Op.or]: cond };
    }

    if (parseInt(req.body.number) !== await Secret.count(where)) throw new ErrorMessage('数目不匹配，请刷新重试');

    await Secret.destroy({ where });
    
    res.send({ success: true });
  } catch (e) {
    res.send({ success: false, message: e.message });
  }
});

app.get('/contest/:id/secret/export', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');

    let wb = xlsx.utils.book_new();

    await contest.loadRelationships();
    let players = await contest.ranklist.getPlayers();
    let secrets = await Secret.findAll({ where: { type: 0, type_id: contest.id } });

    let playersMap = {}, playersRank = {}, curRank = 0, lastScore = Number.MIN_VALUE, lastSecondary = Number.MIN_VALUE, rankDelta = 1;
    for (let player of players) {
      await player.getSecondaryScore(contest);
      if (lastScore != player.score || lastSecondary != player.secondary) {
        curRank += rankDelta;
        lastScore = player.score;
        lastSecondary = player.secondary;
        rankDelta = 0;
      }
      rankDelta++;
      playersRank[player.user_id] = curRank;
      playersMap[player.user_id] = player;
    }

    await secrets.forEachAsync(async v => await v.loadRelationships());

    let table = [['准入码', '绑定信息', '分类码', '用户 ID', '用户名', '邮箱', '排名', '得分']];

    if (contest.type !== 'scc') table[0].push(contest.type === 'acm' ? '罚时' : '最后一次提交时间');
    
    for (let secret of secrets) {
      let player = playersMap[secret.user_id];
      let row = [secret.secret, secret.extra_info, secret.classify_code, secret.user_id, secret.user_desc, secret.email];
      if (player) {
        if (contest.type !== 'scc') {
          row.push(playersRank[secret.user_id], player.score);
          let v = player.secondary / 24 / 3600;
          row.push({ t: 'n', v, z: 'h:mm:ss', toString: () => xlsx.SSF.format('h:mm:ss', v) });
        } else row.push(playersRank[secret.user_id], player.score / 100);
      }
      table.push(row);
    }

    let ws = xlsx.utils.aoa_to_sheet(table);
    ws['!autofilter'] = { ref: 'A1:' + (contest.type !== 'scc' ? 'I' : 'H') + (1 + secrets.length) };
    ws['!cols'] = [];
    for(let i = 0; i < table[0].length; i++) {
      let maxCh = syzoj.utils.countTextWCH(table[0][i].toString(), 2) + 2;
      for (let row of table) if (row[i]) maxCh = Math.max(maxCh, syzoj.utils.countTextWCH(row[i].toString(), 2));
      ws['!cols'].push({ wch: maxCh });
    }
    xlsx.utils.book_append_sheet(wb, ws, '准入码信息');

    res.writeHead(200, [['Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['Content-Disposition', require('content-disposition')(`${contest.title}_准入码信息.xlsx`)]]);
    res.end(xlsx.write(wb, { bookType: 'xlsx', bookSST: false, type: 'buffer' }));
  } catch (e) {
    console.log(e);
    res.render('error', {
      err: e
    });
  }
});

const importColumn = {
  0: { desc: '分类码', column: 'classify_code', selected: true, default: () => '0', parse: parseInt, match: /^\-?\d+$/ },
  1: { desc: '绑定信息', column: 'extra_info', selected: true, required: true },
  2: { desc: '准入码', column: 'secret', default: () => randomstring.generate(16) },
  3: { desc: '用户 ID', column: 'user_id', default: () => '-1', parse: parseInt, match: /^\-?\d+$/ },
  4: { desc: '邮箱', column: 'email', default: () => '', match: /^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$|^$/ },
};

app.get('/contest/:id/secret/import', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');

    res.render('secret_import', {
      curType: 'contest',
      curTitle: contest.title,
      curTypeDesc: '比赛',
      curTypeId: contest.id,
      importColumn
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/contest/:id/secret/import', app.multer.fields([{ name: 'file', maxCount: 1 }]), async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');

    let data = [];

    if (req.files['file']) {
      let fs = Promise.promisifyAll(require('fs'));
      let wb = xlsx.read(await fs.readFileAsync(req.files['file'][0].path));
      let activeTab = 0;
      if (wb.Workbook && wb.Workbook.WBView && wb.Workbook.WBView.length > 0 && wb.Workbook.WBView[0].activeTab) activeTab = wb.Workbook.WBView[0].activeTab;
      let ws = wb.Sheets[wb.SheetNames[activeTab]];
      let aoa = xlsx.utils.sheet_to_json(ws, { header: 1 });

      let descMap = {};
      for (let id in importColumn) descMap[importColumn[id].desc] = id;
      
      let header = aoa.shift(), format = [];
      for (let txt of header) if (txt in descMap){
        if (descMap[txt] == -1) throw new ErrorMessage('格式内容重复');
        format.push(descMap[txt]);
        descMap[txt] = -1;
      } else format.push(-1);

      for (let arr of aoa) {
        let row = [];
        for (let idx of format) row[idx] = arr.shift();
        delete row[-1];
        data.push(row);
      }
    } else {
      if (!req.body.format) throw new ErrorMessage('格式为空');
      if (!Array.isArray(req.body.format)) req.body.format = [req.body.format];
      let ref = {}, format = req.body.format;
      for (let idx of format) {
        if (ref[idx]) throw new ErrorMessage('格式内容重复');
        ref[idx] = true;
      }
      let lines = req.body.text.replace(/\r/g,'').split('\n');
      for(let line of lines) {
        if (!line.trim().length) continue;
        let text = line.split('\t');
        console.log(text)
        if (text.length < format.length) throw new ErrorMessage('内容缺失');
        text.push(text.splice(format.length - 1).join('\t'));
        let row = [];
        for (let idx of format) row[idx] = text.shift();
        data.push(row);
      }
    }

    let records = [];

    for (let row of data) {
      let info = {}, rec;
      for (let id in importColumn) {
        let item = importColumn[id];
        if (!row[id]) {
          if (item.required) throw new ErrorMessage('必选项缺失');
          row[id] = item.default();
          info[item.column + 'Gen'] = true;
        }
        let val = row[id];
        if (item.match && !item.match.test(val)) throw new ErrorMessage('格式错误');
        if (item.parse) val = item.parse(val);
        info[item.column] = val;
      }
      if (!info.secretGen)
        rec = await Secret.find({ type: 0, type_id: contest.id, secret: info.secret })
      if (!rec) {
        rec = await Secret.create({ type: 0, type_id: contest.id });
        rec.secretNew = true;
      }
      for (let name in info) rec[name] = info[name];
      records.push(rec);
    }

    await syzoj.db.transaction(async trans => {
      for (let rec of records) {
        if (rec.user_id != -1 && await Secret.find({type: 0, type_id: contest.id, user_id: rec.user_id, secret: { [syzoj.db.Op.ne]: rec.secret }}))
          throw new ErrorMessage('用户 ID 冲突');
        if (rec.secretNew && await Secret.find({type: 0, type_id: contest.id, secret: rec.secret })) {
          if (!rec.secretGen) throw new ErrorMessage('准入码冲突');
          do {
            rec.secret = randomstring.generate(16);
          } while(await Secret.find({ type: 0, type_id: contest.id, secret: rec.secret }));
        }
        await rec.save();
      }
    });

    res.redirect(syzoj.utils.makeUrl(['contest', contest.id, 'secret']));
  } catch (e) {
    console.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id', async (req, res) => {
  try {
    const curUser = res.locals.user;
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');

    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    const isSupervisior = await contest.isSupervisior(curUser);
    if (!contest.is_public && !isSupervisior) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');

    contest.running = contest.isRunning();
    contest.ended = contest.isEnded();
    contest.subtitle = await syzoj.utils.markdown(contest.subtitle);
    contest.information = await syzoj.utils.markdown(contest.information);

    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.fromID(id));

    let player = null;

    if (res.locals.user) {
      player = await ContestPlayer.findInContest({
        contest_id: contest.id,
        user_id: res.locals.user.id
      });
    }

    problems = problems.map(x => ({ problem: x, status: null, judge_id: null, statistics: null }));
    if (player) {
      for (let problem of problems) {
        if (contest.type === 'noi') {
          if (player.score_details[problem.problem.id]) {
            let judge_state = await JudgeState.fromID(player.score_details[problem.problem.id].judge_id);
            problem.status = judge_state.status;
            if (!contest.ended && !await problem.problem.isAllowedEditBy(res.locals.user) && !['Compile Error', 'Waiting', 'Compiling'].includes(problem.status)) {
              problem.status = 'Submitted';
            }
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
          }
        } else if (contest.type === 'ioi') {
          if (player.score_details[problem.problem.id]) {
            let judge_state = await JudgeState.fromID(player.score_details[problem.problem.id].judge_id);
            problem.status = judge_state.status;
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
            await contest.loadRelationships();
            let multiplier = (contest.ranklist.ranking_params || {})[problem.problem.id] || 1.0;
            problem.feedback = (judge_state.score * multiplier).toString() + ' / ' + (100 * multiplier).toString();
          }
        } else if (contest.type === 'acm') {
          if (player.score_details[problem.problem.id]) {
            problem.status = {
              accepted: player.score_details[problem.problem.id].accepted,
              unacceptedCount: player.score_details[problem.problem.id].unacceptedCount
            };
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
          } else {
            problem.status = null;
          }
        }
      }
    }

    let hasStatistics = false;
    let now = syzoj.utils.getCurrentDate();
    if ((!contest.hide_statistics && (!contest.rank_open_time || contest.rank_open_time <= now)) || (contest.ended) || (isSupervisior)) {
      hasStatistics = true;

      await contest.loadRelationships();
      let players = await contest.ranklist.getPlayers();
      let isFrozen = (!isSupervisior) && contest.freeze_time && contest.freeze_time <= now
      && (contest.isRunning() || (contest.isEnded() && contest.ranklist.freeze_ranking && contest.ranklist.freeze_ranking.length == 1));
      for (let problem of problems) {
        problem.statistics = { attempt: 0, accepted: 0 };

        if (contest.type === 'ioi' || contest.type === 'noi') {
          problem.statistics.partially = 0;
        }

        for (let player of players) {
          if (player.score_details[problem.problem.id]) {
            problem.statistics.attempt++;
            if (!isFrozen) {
              if (((contest.type === 'acm' || contest.type === 'scc') && player.score_details[problem.problem.id].accepted) || ((contest.type === 'noi' || contest.type === 'ioi') && player.score_details[problem.problem.id].score === 100)) {
                problem.statistics.accepted++;
              }
  
              if ((contest.type === 'noi' || contest.type === 'ioi') && player.score_details[problem.problem.id].score > 0) {
                problem.statistics.partially++;
              }
            }
          }
        }
        
        if (isFrozen && contest.ranklist.freeze_ranking && contest.ranklist.freeze_ranking.length == 1) 
          for (let player of contest.ranklist.freeze_ranking[0]) if (player.score_details[problem.problem.id]) {
            if ((contest.type === 'acm' || contest.type === 'scc') && player.score_details[problem.problem.id].accepted) {
              problem.statistics.accepted++;
            }
          }
      }
    }
    let allowReleaseRank = false;
    let havingUnpublicProblems = false;
    if (isSupervisior && contest.ended) {
      if (contest.freeze_time && contest.ranklist.freeze_ranking && contest.ranklist.freeze_ranking.length == 1) allowReleaseRank = true;
      if (!allowReleaseRank && problems.some(x => !x.problem.is_public)) havingUnpublicProblems = true;
    }
    
    let scc = null;
    if (contest.type === 'scc') {
      let detail = syzoj.utils.getSccRule(contest.scc_rule);
      scc = { ruleName: detail[0], codeHTML: detail[3] };
    }

    res.render('contest', {
      contest,
      problems,
      hasStatistics,
      isSupervisior,
      needSecret: !await contest.allowedSecret(req, res),
      isLogin: !!curUser,
      needBan: contest.ban_count && !!curUser && contest.isRunning() && (!player || !player.ban_problems_id || player.ban_problems_id.split('|').length < contest.ban_count),
      banIds: (contest.ban_count && !!curUser && !!player && !!player.ban_problems_id && player.ban_problems_id.split('|').length === contest.ban_count) 
              ? player.ban_problems_id.split('|').map(x => parseInt(x)) : null,
      allowReleaseRank,
      havingUnpublicProblems,
      scc
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/ranklist', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    const curUser = res.locals.user;

    if (!contest) throw new ErrorMessage('无此比赛。');
    if (!contest.is_public && !(await contest.isSupervisior(curUser))) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');
    if ([contest.allowedSeeingResult() && contest.allowedSeeingOthers(),
    contest.isEnded(),
    await contest.isSupervisior(curUser)].every(x => !x))
      throw new ErrorMessage('您没有权限进行此操作。');
    if (!await contest.allowedSecret(req, res)) throw new ErrorMessage('您尚未输入准入码。');

    let now = syzoj.utils.getCurrentDate();
    if (!(await contest.isSupervisior(curUser)) && contest.rank_open_time && contest.rank_open_time > now)
      throw new ErrorMessage('榜单将会在 ' + syzoj.utils.formatDate(contest.rank_open_time) + ' 后可以访问，请先自行做题！ (´∀ `)');

    await contest.loadRelationships();

    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.fromID(id));

    if (!(await contest.isSupervisior(curUser)) && contest.freeze_time && contest.freeze_time <= now 
    && (contest.isRunning() || (contest.isEnded() && contest.ranklist.freeze_ranking && contest.ranklist.freeze_ranking.length == 1))) {
      let ranklist = [];
      if (contest.ranklist.freeze_ranking && contest.ranklist.freeze_ranking.length == 1) {
        for(let info of contest.ranklist.freeze_ranking[0]) {
          if (contest.type === 'scc') info.totalLength = 0;
          for (let i in info.score_details) {
            info.score_details[i].judge_state = await JudgeState.fromID(info.score_details[i].judge_id);
            if (contest.type === 'scc') {
              if (info.score_details[i].accepted) info.totalLength += info.score_details[i].minLength;
            }
          }

          let user = await User.fromID(info.user_id);
          if (contest.need_secret) {
            let secret = await Secret.find({ type: 0, type_id: contest_id, user_id: info.user_id });
            if (secret) {
              user.extra_info = secret.extra_info;
              user.classify_code = secret.classify_code;
            }
          }
          ranklist.push({
            user: user,
            player: info
          });
        }
      }

      res.render('contest_ranklist', {
        contest: contest,
        ranklist: ranklist,
        problems: problems,
        is_freeze: true
      });
      return;
    }

    let players_id = [];
    for (let i = 1; i <= contest.ranklist.ranklist.player_num; i++) players_id.push(contest.ranklist.ranklist[i]);

    let ranklist = await players_id.mapAsync(async player_id => {
      let player = await ContestPlayer.fromID(player_id);

      if (contest.type === 'noi' || contest.type === 'ioi') {
        player.score = 0;
      }

      if (contest.type === 'scc') player.totalLength = 0;

      for (let i in player.score_details) {
        player.score_details[i].judge_state = player.score_details[i].judge_id ? await JudgeState.fromID(player.score_details[i].judge_id) : { submit_time: contest.start_time };

        /*** XXX: Clumsy duplication, see ContestRanklist::updatePlayer() ***/
        if (contest.type === 'noi' || contest.type === 'ioi') {
          let multiplier = (contest.ranklist.ranking_params || {})[i] || 1.0;
          player.score_details[i].weighted_score = player.score_details[i].score == null ? null : Math.round(player.score_details[i].score * multiplier);
          player.score += player.score_details[i].weighted_score;
        } else if (contest.type === 'scc') {
          if (player.score_details[i].accepted) player.totalLength += player.score_details[i].minLength;
        }
      }

      let user = await User.fromID(player.user_id);
      if (contest.need_secret) {
        let secret = await Secret.find({ type: 0, type_id: contest_id, user_id: player.user_id });
        if (secret) {
          user.extra_info = secret.extra_info;
          user.classify_code = secret.classify_code;
        }
      }

      return {
        user: user,
        player: player
      };
    });

    res.render('contest_ranklist', {
      contest: contest,
      ranklist: ranklist,
      problems: problems,
      is_freeze: false
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

function getDisplayConfig(contest) {
  return {
    showScore: contest.allowedSeeingScore(),
    showUsage: false,
    showCode: false,
    showResult: contest.allowedSeeingResult(),
    showOthers: contest.allowedSeeingOthers(),
    showDetailResult: contest.allowedSeeingTestcase(),
    showTestdata: false,
    inContest: true,
    showRejudge: false
  };
}

app.get('/contest/:id/submissions', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest.is_public && !(await contest.isSupervisior(res.locals.user))) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');
    if (!await contest.allowedSecret(req, res)) throw new ErrorMessage('您尚未输入准入码。');

    if (contest.isEnded()) {
      res.redirect(syzoj.utils.makeUrl(['submissions'], { contest: contest_id }));
      return;
    }

    let allowLangs = null;
    if (contest.allow_languages) allowLangs = contest.allow_languages.split('|'); 

    const displayConfig = getDisplayConfig(contest);
    let problems_id = await contest.getProblems();
    const curUser = res.locals.user;

    if (contest.freeze_time) displayConfig.showOthers = false;

    let user = req.query.submitter && await User.fromName(req.query.submitter);
    let where = {
      submit_time: { [syzoj.db.Op.gte]: contest.start_time, [syzoj.db.Op.lte]: contest.end_time }
    };
    if (displayConfig.showOthers) {
      if (user) {
        where.user_id = user.id;
      }
    } else {
      if (curUser == null || // Not logined
        (user && user.id !== curUser.id)) { // Not querying himself
        throw new ErrorMessage("您没有权限执行此操作");
      }
      where.user_id = curUser.id;
    }

    if (displayConfig.showScore) {
      let minScore = parseInt(req.query.min_score);
      let maxScore = parseInt(req.query.max_score);

      if (!isNaN(minScore) || !isNaN(maxScore)) {
        if (isNaN(minScore)) minScore = 0;
        if (isNaN(maxScore)) maxScore = 100;
        if (!(minScore === 0 && maxScore === 100)) {
          where.score = {
            [syzoj.db.Op.and]: {
              [syzoj.db.Op.gte]: parseInt(minScore),
              [syzoj.db.Op.lte]: parseInt(maxScore)
            }
          };
        }
      }
    }

    if (req.query.language) {
      if (req.query.language === 'submit-answer') where.language = '';
      else where.language = req.query.language;
    }

    if (displayConfig.showResult) {
      if (req.query.status) where.status = { [syzoj.db.Op.like]: req.query.status + '%' };
    }

    if (req.query.problem_id) {
      where.problem_id = problems_id[syzoj.utils.alphaIdParse(req.query.problem_id) - 1];
    }
    where.type = 1;
    where.type_info = contest_id;

    let paginate = syzoj.utils.paginate(await JudgeState.count(where), req.query.page, syzoj.config.page.judge_state);
    let judge_state = await JudgeState.query(paginate, where, [['submit_time', 'desc']]);

    await judge_state.forEachAsync(async obj => {
      await obj.loadRelationships();
      await obj.loadSecret(contest);
      obj.problem_id = problems_id.indexOf(obj.problem_id) + 1;
      obj.problem.title = syzoj.utils.removeTitleTag(obj.problem.title);
    });

    const pushType = displayConfig.showResult ? 'rough' : 'compile';
    res.render('submissions', {
      contest: contest,
      items: judge_state.map(x => ({
        info: getSubmissionInfo(x, displayConfig),
        token: (x.pending && x.task_id != null) ? jwt.sign({
          taskId: x.task_id,
          type: pushType,
          displayConfig: displayConfig
        }, syzoj.config.session_secret) : null,
        result: getRoughResult(x, displayConfig),
        running: false,
      })),
      paginate: paginate,
      form: req.query,
      displayConfig: displayConfig,
      pushType: pushType,
      isFiltered: !!(where.problem_id || where.user_id || where.score || where.language || where.status),
      allowLangs: allowLangs
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});


app.get('/contest/submission/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const judge = await JudgeState.fromID(id);
    if (!judge) throw new ErrorMessage("提交记录 ID 不正确。");
    const curUser = res.locals.user;
    if ((!curUser) || judge.user_id !== curUser.id) throw new ErrorMessage("您没有权限执行此操作。");

    if (judge.type !== 1) {
      return res.redirect(syzoj.utils.makeUrl(['submission', id]));
    }

    const contest = await Contest.fromID(judge.type_info);
    if (syzoj.config.cur_vip_contest && judge.type_info !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    if (!await contest.allowedSecret(req, res)) throw new ErrorMessage('您尚未输入准入码。');
    contest.ended = contest.isEnded();

    const displayConfig = getDisplayConfig(contest);
    displayConfig.showCode = true;

    await judge.loadRelationships();
    await judge.loadSecret(contest);
    const problems_id = await contest.getProblems();
    judge.problem_id = problems_id.indexOf(judge.problem_id) + 1;
    judge.problem.title = syzoj.utils.removeTitleTag(judge.problem.title);

    if (judge.problem.type !== 'submit-answer') {
      judge.codeLength = judge.code.length;
      judge.code = await syzoj.utils.highlight(judge.code, syzoj.languages[judge.language].highlight);
    }

    res.render('submission', {
      info: getSubmissionInfo(judge, displayConfig),
      roughResult: getRoughResult(judge, displayConfig),
      code: (displayConfig.showCode && judge.problem.type !== 'submit-answer') ? judge.code.toString("utf8") : '',
      formattedCode: judge.formattedCode ? judge.formattedCode.toString("utf8") : null,
      preferFormattedCode: res.locals.user ? res.locals.user.prefer_formatted_code : true,
      detailResult: processOverallResult(judge.result, displayConfig),
      socketToken: (displayConfig.showDetailResult && judge.pending && judge.task_id != null) ? jwt.sign({
        taskId: judge.task_id,
        displayConfig: displayConfig,
        type: 'detail'
      }, syzoj.config.session_secret) : null,
      displayConfig: displayConfig,
      contest: contest,
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/problem/:pid', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    if (!await contest.allowedSecret(req, res)) throw new ErrorMessage('您尚未输入准入码。');
    const curUser = res.locals.user;

    let problems_id = await contest.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
    let problem = await Problem.fromID(problem_id);
    await problem.loadRelationships();

    contest.ended = contest.isEnded();
    if (!await contest.isSupervisior(curUser) && !(contest.isRunning() || contest.isEnded())) {
      if (await problem.isAllowedUseBy(res.locals.user)) {
        return res.redirect(syzoj.utils.makeUrl(['problem', problem_id]));
      }
      throw new ErrorMessage('比赛尚未开始。');
    }

    problem.specialJudge = await problem.hasSpecialJudge();

    await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);

    let judgeStateLimit = { type: 1, type_info: contest.id };

    let state = await problem.getJudgeState(res.locals.user, false, judgeStateLimit);
    let bestState = await problem.getJudgeState(res.locals.user, true, judgeStateLimit);

    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    await problem.loadRelationships();

    let language_limit = null, player = null, forceNoSubmit = !curUser;
    if (curUser && contest.one_language) {
      if (!player) player = await ContestPlayer.findInContest({
        contest_id: contest.id,
        user_id: curUser.id
      });
      language_limit = !player || player.language_limit === '' ? 'Undetermined' : player.language_limit;
    }
    if (curUser && contest.ban_count) {
      if (!player) player = await ContestPlayer.findInContest({
        contest_id: contest.id,
        user_id: curUser.id
      });
      forceNoSubmit = !player || !player.ban_problems_id || player.ban_problems_id.split('|').length < contest.ban_count || player.ban_problems_id.split('|').map(x => parseInt(x)).includes(problem_id);
    }

    res.render('problem', {
      pid: pid,
      contest: contest,
      problem: problem,
      state: state,
      lastLanguage: res.locals.user ? await res.locals.user.getLastSubmitLanguage() : null,
      testcases: testcases,
      language_limit: language_limit,
      forceNoSubmit: forceNoSubmit,
      bestState
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/:pid/download/additional_file', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    if (!await contest.allowedSecret(req, res)) throw new ErrorMessage('您尚未输入准入码。');

    let problems_id = await contest.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
    let problem = await Problem.fromID(problem_id);

    contest.ended = contest.isEnded();
    if (!(contest.isRunning() || contest.isEnded())) {
      if (await problem.isAllowedUseBy(res.locals.user)) {
        return res.redirect(syzoj.utils.makeUrl(['problem', problem_id, 'download', 'additional_file']));
      }
      throw new ErrorMessage('比赛尚未开始。');
    }

    await problem.loadRelationships();

    if (!problem.additional_file) throw new ErrorMessage('无附加文件。');

    res.download(problem.additional_file.getPath(), `additional_file_${id}_${pid}.zip`);
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});

app.post('/contest/:id/submit_ban_problems_id', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    if (!contest.is_public && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');
    if (!res.locals.user) throw new ErrorMessage('请先登陆。');
    if (!contest.isRunning()) throw new ErrorMessage('比赛不在进行中！');
    if (!await contest.allowedSecret(req, res)) throw new ErrorMessage('您尚未输入准入码。');
    if (!contest.ban_count) throw new ErrorMessage('本次比赛不需要声明。');

    let problems_id = await contest.getProblems(), real_problem_ids = [], visited_ids = {};
    if (!Array.isArray(req.body.ban_ids)) req.body.ban_ids = [req.body.ban_ids];
    for(let pid of req.body.ban_ids) {
      if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('您声明的部分题目不存在。');
      pid --;
      if (visited_ids[pid]) throw new ErrorMessage('您声明的部分题目重复。');
      visited_ids[pid] = true;
      real_problem_ids.push(problems_id[pid]);
    }
    if (real_problem_ids.length !== contest.ban_count) throw new ErrorMessage('声明题目数目不符合要求。');

    let player = await ContestPlayer.findInContest({
      contest_id: contest.id,
      user_id: res.locals.user.id
    });
    if (!player) {
      player = await ContestPlayer.create({
        contest_id: contest.id,
        user_id: res.locals.user.id
      });
    }
    player.ban_problems_id = real_problem_ids.join('|');
    await player.save();
    res.send({ success: true });
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false, reason: e.message });
  }
});

app.post('/contest/:id/release_ranklist', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');
    if (!contest.isEnded()) throw new ErrorMessage('比赛未结束！');
    if (!contest.freeze_time) throw new ErrorMessage('比赛无封榜！');

    await contest.loadRelationships();
    contest.ranklist.freeze_ranking = [];
    await contest.ranklist.save();

    res.redirect(syzoj.utils.makeUrl(['contest', id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/contest/:id/public_problems', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');
    if (!contest.isEnded()) throw new ErrorMessage('比赛未结束！');
    
    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.fromID(id));

    for (let problem of problems.filter(x => !x.is_public)) {
      await problem.setPublic(true, res.locals.user);
    }

    res.redirect(syzoj.utils.makeUrl(['contest', id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/contest/:id/generate_resolve_json', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');
    if (!contest.isEnded()) throw new ErrorMessage('比赛未结束！');
    if (!contest.freeze_time) throw new ErrorMessage('比赛无封榜！');

    await contest.loadRelationships();

    let result = [], cdsId = 0;

    function createEvent(type, data, op) {
      if (!op) op = 'create';
      cdsId++;
      result.push(JSON.stringify({type, id: 'cds' + cdsId, op, data}));
    }

    let contestInfo = {
      id: 'contest-' + contest.id,
      name: contest.title,
      formal_name: contest.title,
      start_time: (new Date(contest.start_time * 1000)).toISOString(),
      duration: syzoj.utils.formatTime(contest.end_time - contest.start_time) + '.000',
      scoreboard_freeze_duration: syzoj.utils.formatTime(contest.end_time - contest.freeze_time) + '.000'
    };
    if (req.body.hasOwnProperty('main_logo')) contestInfo.logo = [{
      href: req.body.main_logo,
      mime: 'image/png'
    }];
    createEvent('contests', contestInfo);

    let languagesList = syzoj.config.enabled_languages, revLang = {}, i = 0;
    if (contest && contest.allow_languages) languagesList = contest.allow_languages.split('|');
    for (let lang of languagesList){
      i++;
      revLang[lang] = i;
      createEvent('languages', {
        id: i,
        name: lang
      });
    }

    let status = {
      'Accepted': 'AC',
      'Wrong Answer': 'WA',
      'Runtime Error': 'RE',
      'Invalid Interaction': 'II',
      'Time Limit Exceeded': 'TLE',
      'Memory Limit Exceeded': 'MLE',
      'Output Limit Exceeded': 'OLE',
      'File Error': 'FE',
      'Compile Error': 'CE',
      'System Error': 'SE',
      'No Testdata': 'NT',
      'Partially Correct': 'PE',
      'Judgement Failed': 'JF'
    };

    for (let type in status){
      createEvent('judgement-types', {
        id: status[type],
        name: type,
        penalty: status[type] !== 'CE' && status[type] !== 'AC',
        solved: status[type] === 'AC'
      });
    }

    let problems_id = await contest.getProblems(), revProblem = {};
    let problems = await problems_id.mapAsync(async id => await Problem.fromID(id));
    i = 1;
    for (let problem of problems) {
      i++;
      let alphaId = syzoj.utils.idToAlpha(i);
      revProblem[problem.id] = alphaId;
      createEvent('problems', {
        id: alphaId,
        label: alphaId,
        name: problem.title,
        ordinal: i,
        test_data_count: 1
      });
    }
    
    let players = await contest.ranklist.getPlayers(), revUser = {};

    let classify = null;
    if (contest.need_secret && req.body.hasOwnProperty('classify')) {
      classify = req.body.classify.split(',');
    }

    let hasOrg = false, revOrg = {};
    if (contest.need_secret && req.body.hasOwnProperty('org')) {
      let orgInfo = null;
      try {
        orgInfo = JSON.parse(req.body.org);
      } catch (e) {
        throw new ErrorMessage('JSON 解析失败');
      }
      let haveLogo = false, idx = 0;
      if (req.body.hasOwnProperty('have_logo') && req.body.have_logo.toLowerCase() === 'true') haveLogo = true;
      hasOrg = true;
      for (let name in orgInfo) {
        idx++;
        let codes = orgInfo[name];
        for (let code of codes) revOrg[code] = idx.toString();
        let info = {
          id: idx.toString(),
          name,
          formal_name: name
        };
        if (haveLogo) info.logo = [{href: 'logo/' + codes[0] + '.png',mime: 'image/png'}];
        createEvent('organizations', info);
      }
    }

    let hasPhoto = false, photoInfo = null;
    if (contest.need_secret && req.body.hasOwnProperty('photo_info')) {
      try {
        photoInfo = JSON.parse(req.body.photo_info);
      } catch (e) {
        throw new ErrorMessage('JSON 解析失败');
      }
      hasPhoto = true;
    }

    i = 0;
    let teamCnt = 0;
    for (let player of players) {
      if (classify) {
        player.secret = await Secret.find({ type: 0, type_id: contest.id, user_id: player.user_id });
        if (!classify.includes(player.secret.classify_code.toString())) continue;
      }
      i++;
      revUser[player.user_id] = i;
      teamCnt++;
      if (contest.need_secret) {
        if (!player.secret) player.secret = await Secret.find({ type: 0, type_id: contest.id, user_id: player.user_id });
        let info = {
          id: i,
          name: player.secret.extra_info
        };
        if (hasOrg && revOrg[player.secret.classify_code]) info.organization_id = revOrg[player.secret.classify_code];
        if (hasPhoto && photoInfo[player.secret.extra_info]) {
          info.photo = [{
            href: 'photo/' + photoInfo[player.secret.extra_info],
            mime: 'image/png'
          }];
        }
        createEvent('teams', info);
      } else {
        player.user = await User.fromID(player.user_id);
        createEvent('team', {
          id: i,
          name: player.user.name
        });
      }
    }

    createEvent('state', {
      started: (new Date(contest.start_time * 1000)).toISOString(),
      ended: null,
      finalized: null
    });

    let judge_states = await JudgeState.query(null, { type: 1, type_info: contest.id }, [['submit_time', 'asc']]);
    i = 0;
    let haveFrozen = false;
    for (let state of judge_states) if (status.hasOwnProperty(state.status)) if (revUser[state.user_id]) {
      i++;
      if (!haveFrozen && state.submit_time >= contest.freeze_time) {
        createEvent('state', {
          started: (new Date(contest.start_time * 1000)).toISOString(),
          ended: null,
          frozen: (new Date(contest.freeze_time * 1000)).toISOString(),
          finalized: null
        }, 'update');
        haveFrozen = true;
      }
      createEvent('submissions', {
        id: i,
        problem_id: revProblem[state.problem_id],
        team_id: revUser[state.user_id],
        language_id: revLang[state.language],
        files: [],
        contest_time: syzoj.utils.formatTime(state.submit_time - contest.start_time) + '.020',
        time: (new Date(state.submit_time * 1000 + 20)).toISOString()
      });
      createEvent('judgements', {
        id: i,
        submission_id: i,
        judgement_type_id: status[state.status],
        start_contest_time: syzoj.utils.formatTime(state.submit_time - contest.start_time) + '.020',
        end_contest_time: syzoj.utils.formatTime(state.submit_time - contest.start_time) + '.020',
        start_time: (new Date(state.submit_time * 1000 + 20)).toISOString(),
        end_time: (new Date(state.submit_time * 1000 + 20)).toISOString()
      });
    }

    if (!haveFrozen) {
      createEvent('state', {
        started: (new Date(contest.start_time * 1000)).toISOString(),
        ended: null,
        frozen: (new Date(contest.freeze_time * 1000)).toISOString(),
        finalized: null
      }, 'update');
      haveFrozen = true;
    }

    createEvent('state', {
      started: (new Date(contest.start_time * 1000)).toISOString(),
      ended: (new Date(contest.end_time * 1000)).toISOString(),
      frozen: (new Date(contest.freeze_time * 1000)).toISOString(),
      finalized: (new Date(contest.end_time * 1000)).toISOString(),
      thawed: (new Date(contest.end_time * 1000)).toISOString()
    }, 'update');

    createEvent('finalized', {
      last_gold: 1,
      last_silver: 3,
      last_bronze: 6
    });
    
    if (req.body.hasOwnProperty('awards')) {
      let cfg = null;
      try {
        cfg = JSON.parse(req.body.awards);
      } catch (e) {
        throw new ErrorMessage('JSON 解析失败');
      }
      let cur = 0;
      for (let award of cfg) {
          let team = [];
          while (teamCnt > 0 && award[2] > 0) {
            cur++;
            teamCnt--;
            award[2]--;
            team.push(cur.toString());
          }
          createEvent('awards',{
            id: award[1],
            citation: award[0],
            team_ids: team
          });
      }
    }

    result.push('');
    res.setHeader('Content-Type', 'application/json');
    res.send(result.join('\n'));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

const mailTemplate = `<!DOCTYPE html>
<html>

<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <title>{contest_name} - 准入码发放</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, Helvetica Neue, PingFang SC, Microsoft YaHei, Source Han Sans SC, Noto Sans CJK SC, WenQuanYi Micro Hei, sans-serif
        }
    </style>
</head>

<body>

    <style>
        .awl a {
            color: #FFFFFF;
            text-decoration: none;
        }

        .abml a {
            color: #000000;
            font-family: Roboto-Medium, Helvetica, Arial, sans-serif;
            font-weight: bold;
            text-decoration: none;
        }

        .adgl a {
            color: rgba(0, 0, 0, 0.87);
            text-decoration: none;
        }

        .afal a {
            color: #b0b0b0;
            text-decoration: none;
        }

        _media screen and (min-width: 600px) {
            .v2sp {
                padding: 6px 30px 0px;
            }

            .v2rsp {
                padding: 0px 10px;
            }
        }

        _media screen and (min-width: 600px) {
            .mdv2rw {
                padding: 40px 40px;
            }
        }
    </style>
    <table width="100%" height="100%" style="min-width: 348px;" border="0" cellspacing="0" cellpadding="0" lang="en">
        <tr height="32" style="height: 32px;">
            <td></td>
        </tr>
        <tr align="center">
            <td>
                <table border="0" cellspacing="0" cellpadding="0"
                    style="padding-bottom: 20px; max-width: 516px; min-width: 220px;">
                    <tr>
                        <td width="8" style="width: 8px;"></td>
                        <td>
                            <div style="border-style: solid; border-width: thin; border-color:#dadce0; border-radius: 8px; padding: 40px 20px;"
                                align="center" class="mdv2rw"><img src="{logo_url}" width="{logo_width}"
                                    height="{logo_height}" aria-hidden="true" style="margin-bottom: 16px;">
                                <div
                                    style="font-family: 'Google Sans',Roboto,RobotoDraft,Helvetica,Arial,sans-serif;border-bottom: thin solid #dadce0; color: rgba(0,0,0,0.87); line-height: 32px; padding-bottom: 24px;text-align: center; word-break: break-word;">
                                    <div style="font-size: 24px;">{contest_name}</div>
                                </div>
                                <div
                                    style="font-family: Roboto-Regular,Helvetica,Arial,sans-serif; font-size: 14px; color: rgba(0,0,0,0.87); line-height: 20px;padding-top: 20px; text-align: left;">
                                    <p>您收到本邮件是因为您报名参加了 <b>{contest_name}</b>。</p>
                                    <p>您的参赛信息为 <b>{extra_info}</b>，请核对，如有误请向赛事组织人员提出。</p>
                                    <p>您的准入码为：</p>
                                    <p style="font-size: 32px; text-align: center; user-select: all;">{secret}</p>
                                    <p>在参赛前，您将被要求提供此准入码以认证身份，请牢记。</p>
                                    <p>现在，请点击下面的按钮获取比赛的详细信息并按时参赛：</p>
                                    <div style="text-align: center;"><a href="{contest_url}" target="_blank"
                                            link-id="main-button-link"
                                            style="font-family: 'Google Sans',Roboto,RobotoDraft,Helvetica,Arial,sans-serif; line-height: 16px; color: #ffffff; font-weight: 400; text-decoration: none;font-size: 14px;display:inline-block;padding: 10px 24px;background-color: #4184F3; border-radius: 5px; min-width: 90px;">参加比赛</a>
                                    </div>
                                </div>
                                <div
                                    style="padding-top: 20px; font-size: 12px; line-height: 16px; color: #5f6368; letter-spacing: 0.3px; text-align: center">
                                    您也可以手动通过以下网址参加比赛：<br><a
                                        style="color: rgba(0, 0, 0, 0.87);text-decoration: inherit;">{contest_url}</a>
                                </div>
                            </div>
                            <div style="text-align: left;">
                                <div
                                    style="font-family: Roboto-Regular,Helvetica,Arial,sans-serif;color: rgba(0,0,0,0.54); font-size: 11px; line-height: 18px; padding-top: 12px; text-align: center;">
                                    <div>如果您并未参加上述比赛，请忽略这封邮件。由此造成的不便敬请谅解。</div>
                                    <div>{agency_name} {cur_date}</div>
                                </div>
                            </div>
                        </td>
                        <td width="8" style="width: 8px;"></td>
                    </tr>
                </table>
            </td>
        </tr>
        <tr height="32" style="height: 32px;">
            <td></td>
        </tr>
    </table>

</body>

</html>`;

function templateReplace(template, replacers) {
  for (let [name, value] of replacers) {
    name = '{' + name + '}';
    while (template.includes(name)) {
      template = template.replace(name, value);
    }
  }
  return template;
}

app.get('/contest/:id/secret/send_mail', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');

    const currentProto = req.get("X-Forwarded-Proto") || req.protocol;
    const host = currentProto + '://' + req.get('host');
    const contestUrl = host + syzoj.utils.makeUrl(['contest', contest_id]);
    let logo = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NTkuMjEgNzgxLjY4MiIgaGVpZ2h0PSI4MzMuNzk1IiB3aWR0aD0iNzAzLjE1NyI+PGcgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjQuNDQiPjxwYXRoIGQ9Ik00MzUuNDEgMTM1LjAwNmwtMTM4LjYwMiA5Ny4wNDktODMuOTUgNTguNzcxLTQxLjk4NSAyOS40MDggNDEuOTg1IDI5LjQwN0w0MzUuNDEgNTA1LjQ4M3YtMzEuMzM3TDI1Ny42NDIgMzQ5LjY2M2wtNDIuMDA4LTI5LjQwNyA0Mi4wMDgtMjkuNDA4IDgzLjk1LTU4Ljc3MSA5My44MTctNjUuNzEyeiIvPjxwYXRoIGQ9Ik0zNDYuMjczIDI3Ni4xOTlsMTM4LjYwMSA5Ny4wNDkgODMuOTUgNTguNzcxIDQxLjk4NiAyOS40MDgtNDEuOTg2IDI5LjQwNy0yMjIuNTUgMTU1Ljg0MlY2MTUuMzRMNTI0LjA0IDQ5MC44NTZsNDIuMDA4LTI5LjQwOC00Mi4wMDgtMjkuNDA3LTgzLjk1LTU4Ljc3Mi05My44MTctNjUuNzF6Ii8+PC9nPjwvc3ZnPg';
    let logoWidth = 72, logoHeight = 72;
    if (syzoj.config.logo.file) {
      logoWidth = syzoj.config.logo.width * 3;
      logoHeight = syzoj.config.logo.height * 3;
      let logoExt = path.extname(syzoj.config.logo.file).slice(1).toLowerCase();
      if (logoExt === 'jpg') logoExt = 'jpeg'; else if (logoExt === 'svg') logoExt = 'svg+xml';
      logo = 'data:image/' + logoExt + ';base64,' + await fsp.readFile(syzoj.config.logo.file, 'base64');
    }

    res.render('secret_send_mail', {
      curType: 'contest',
      curTitle: contest.title,
      curTypeDesc: '比赛',
      curTypeId: contest.id,
      contentTemplate: templateReplace(mailTemplate, [
        ['contest_name', contest.title],
        ['contest_url', contestUrl],
        ['agency_name', syzoj.config.agency_name],
        ['cur_date', require('moment')().format('YYYY-MM-DD')],
        ['logo_url', logo],
        ['logo_width', logoWidth],
        ['logo_height', logoHeight]
      ]),
      titleTemplate: '{extra_info} 的 ' + contest.title + '准入码发放邮件'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/contest/:id/secret/send_mail', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    if (!await contest.isSupervisior(res.locals.user)) throw new ErrorMessage('权限不足！');

    let where = {
      type: 0,
      type_id: contest.id
    };
    if (req.query.secret) where.secret = req.query.secret;
    if (req.query.extra_info) where.extra_info = { [syzoj.db.Op.like]: `%${req.query.extra_info}%` };
    if (req.query.classify_code) where.classify_code = req.query.classify_code;
    if (req.query.email) where.email = req.query.email;
    if (req.query.user_ids) {
      if (!Array.isArray(req.query.user_ids)) req.query.user_ids = [req.query.user_ids];
      let cond = [];
      for(let id of req.query.user_ids) cond.push({ [syzoj.db.Op.eq]: id });
      where.user_id = { [syzoj.db.Op.or]: cond };
    }

    if (parseInt(req.query.number) !== await Secret.count(where)) throw new ErrorMessage('数目不匹配，请刷新重试');

    const errMails = [];

    const secrets = await Secret.findAll({ where });
    for (const secret of secrets) {
      if (!secret.email) continue;
      const replacers = [
        ['extra_info', secret.extra_info],
        ['secret', secret.secret]
      ];
      try {
        await Email.send(secret.email,
          templateReplace(req.body.title, replacers),
          templateReplace(req.body.content, replacers),
          syzoj.config.agency_name
        );
      } catch (e) {
        errMails.push([secret.secret, secret.extra_info, secret.email, e.message].join('|'));
      }
    }

    if (errMails.length !== 0) {
      res.render('error', {
        err: new ErrorMessage('部分发信失败，列表如下：', {}, errMails.join(';'))
      });
      return;
    }
    
    res.redirect(syzoj.utils.makeUrl(['contest', contest.id, 'secret']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});