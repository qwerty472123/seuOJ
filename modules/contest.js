const Contest = syzoj.model('contest');
const ContestRanklist = syzoj.model('contest_ranklist');
const ContestPlayer = syzoj.model('contest_player');
const Problem = syzoj.model('problem');
const JudgeState = syzoj.model('judge_state');
const User = syzoj.model('user');
const Secret = syzoj.model('secret');
const randomstring = require('randomstring');

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
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let contest_id = parseInt(req.params.id);
    let contest = await Contest.fromID(contest_id);
    if (!contest) {
      contest = await Contest.create();
      contest.id = 0;
    } else {
      await contest.loadRelationships();
    }

    let problems = [], admins = [];
    if (contest.problems) problems = await contest.problems.split('|').mapAsync(async id => await Problem.fromID(id));
    if (contest.admins) admins = await contest.admins.split('|').mapAsync(async id => await User.fromID(id));

    res.render('contest_edit', {
      contest: contest,
      problems: problems,
      admins: admins
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
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    if (!req.body.title.trim()) throw new ErrorMessage('比赛名不能为空。');
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.fromID(contest_id);
    let ranklist = null;
    if (!contest) {
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
      await contest.loadRelationships();
      ranklist = contest.ranklist;
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
    contest.problems = fixedPids.join('|');
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
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    let paginate = null, secrets = null;
    const sort = req.query.sort || 'extra_info';
    const order = req.query.order || 'asc';
    let searchData = {};
    if (!['secret', 'extra_info', 'classify_code', 'user_id'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }
    let where = {
      type: 0,
      type_id: contest.id
    };
    searchData.secret = req.query.secret || '';
    if (req.query.secret) where.secret = req.query.secret;
    searchData.extra_info = req.query.extra_info || '';
    if (req.query.extra_info) where.extra_info = { $like: `%${req.query.extra_info}%` };
    searchData.classify_code = req.query.classify_code || '';
    if (req.query.classify_code) where.classify_code = req.query.classify_code;
    searchData.user = [];
    if (req.query.user_ids) {
      if (!Array.isArray(req.query.user_ids)) req.query.user_ids = [req.query.user_ids];
      let cond = [];
      for(let id of req.query.user_ids) {
        cond.push({ $eq: id });
        if (id == '-1') {
          searchData.user.push({ id: -1, name: '暂未绑定' });
          continue;
        }
        let user = await User.fromID(id);
        if (user) searchData.user.push({ id, name: user.username });
      }
      where.user_id = { $or: cond };
    }
    paginate = syzoj.utils.paginate(await Secret.count(where), req.query.page, syzoj.config.page.ranklist);
    secrets = await Secret.query(paginate, where, [[sort, order]]);
    await secrets.forEachAsync(async v => {
      await v.loadRelationships();
      v.user_desc = v.user ? v.user.username : '暂未绑定';
    });
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
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let contest = await Contest.fromID(parseInt(req.params.id));
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    if (Array.isArray(req.body.user_ids) || !req.body.user_ids) throw new ErrorMessage('指定的用户应为一个');
    let user_id = parseInt(req.body.user_ids);
    
    let rec = null;
    if (!req.body.secret) {
      do {
        req.body.secret = randomstring.generate(16);
      } while(await Secret.find({ type: 0, type_id: contest.id, secret: req.body.secret }));
    } else rec = await Secret.find({ type: 0, type_id: contest.id, secret: req.body.secret });
    if (user_id != -1 && await Secret.find({type: 0, type_id: contest.id, user_id, secret: { $ne: req.body.secret }}))
      throw new ErrorMessage('一个用户只能绑定一个准入码');
    if (!rec) rec = await Secret.create({ type: 0, type_id: contest.id, secret: req.body.secret });

    rec.user_id = user_id;
    rec.extra_info = req.body.extra_info;
    rec.classify_code = req.body.classify_code;
    await rec.save();

    res.send({ success: true });
  } catch (e) {
    res.send({ success: false, message: e.message });
  }
});

app.post('/contest/:id/secret/delete', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let contest = await Contest.fromID(parseInt(req.params.id));
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');
    
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
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let contest = await Contest.fromID(parseInt(req.params.id));
    if (!contest) throw new ErrorMessage('无此比赛');
    if (!contest.need_secret) throw new ErrorMessage('比赛不需要准入码');

    let where = {
      type: 0,
      type_id: contest.id
    };
    if (req.body.secret) where.secret = req.body.secret;
    if (req.body.extra_info) where.extra_info = { $like: `%${req.body.extra_info}%` };
    if (req.body.classify_code) where.classify_code = req.body.classify_code;
    if (req.body.user_ids) {
      if (!Array.isArray(req.body.user_ids)) req.body.user_ids = [req.body.user_ids];
      let cond = [];
      for(let id of req.body.user_ids) cond.push({ $eq: id });
      where.user_id = { $or: cond };
    }

    if (parseInt(req.body.number) !== await Secret.count(where)) throw new ErrorMessage('数目不匹配，请刷新重试');

    await Secret.destroy({ where });
    
    res.send({ success: true });
  } catch (e) {
    res.send({ success: false, message: e.message });
  }
});

app.get('/contest/:id', async (req, res) => {
  try {
    const curUser = res.locals.user;
    let contest_id = parseInt(req.params.id);
    if (syzoj.config.cur_vip_contest && contest_id !== syzoj.config.cur_vip_contest && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛中！');

    let contest = await Contest.fromID(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    if (!contest.is_public && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');

    const isSupervisior = await contest.isSupervisior(curUser);
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
    if (isSupervisior && contest.ended && contest.freeze_time) {
      if (contest.ranklist.freeze_ranking && contest.ranklist.freeze_ranking.length == 1) allowReleaseRank = true;
    }
    res.render('contest', {
      contest: contest,
      problems: problems,
      hasStatistics: hasStatistics,
      isSupervisior: isSupervisior,
      needSecret: !await contest.allowedSecret(req, res),
      isLogin: !!curUser,
      needBan: contest.ban_count && !!curUser && contest.isRunning() && (!player || !player.ban_problems_id || player.ban_problems_id.split('|').length < contest.ban_count),
      banIds: (contest.ban_count && !!curUser && !!player && !!player.ban_problems_id && player.ban_problems_id.split('|').length === contest.ban_count) 
              ? player.ban_problems_id.split('|').map(x => parseInt(x)) : null,
      allowReleaseRank: allowReleaseRank
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
    if (!contest.is_public && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');
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
    if (!contest.is_public && (!res.locals.user || !res.locals.user.is_admin)) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');
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
      submit_time: { $gte: contest.start_time, $lte: contest.end_time }
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
            $and: {
              $gte: parseInt(minScore),
              $lte: parseInt(maxScore)
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
      if (req.query.status) where.status = { $like: req.query.status + '%' };
    }

    if (req.query.problem_id) where.problem_id = problems_id[parseInt(req.query.problem_id) - 1];
    where.type = 1;
    where.type_info = contest_id;

    let paginate = syzoj.utils.paginate(await JudgeState.count(where), req.query.page, syzoj.config.page.judge_state);
    let judge_state = await JudgeState.query(paginate, where, [['submit_time', 'desc']]);

    await judge_state.forEachAsync(async obj => {
      await obj.loadRelationships();
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

    let state = await problem.getJudgeState(res.locals.user, false);
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
      forceNoSubmit: forceNoSubmit
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
      revProblem[problem.id] = String.fromCharCode('A'.charCodeAt(0) + parseInt(i) - 1);
      createEvent('problems', {
        id: String.fromCharCode('A'.charCodeAt(0) + parseInt(i) - 1),
        label: String.fromCharCode('A'.charCodeAt(0) + parseInt(i) - 1),
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